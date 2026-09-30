import { randomUUID } from 'node:crypto'

function id(prefix) {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`
}

function textFromItem(item) {
  return (Array.isArray(item?.content) ? item.content : [])
    .map(part => String(part?.text || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

// ElevenLabs Agents (Conversational AI) dialect. The hosted agent owns STT,
// LLM and TTS; the Gateway connects as its WebSocket client, streams PCM16
// microphone audio, and executes the agent's client tool calls. The service
// has no response.create/response.cancel and no conversation-item receipts:
// user_message prompts a spoken reply, contextual_update never does, and a
// client_tool_result natively resumes the agent's turn. Response lifecycle
// events are synthesized from audio chunks (turn start) and agent_response
// (turn end), mirroring how the runtime already drives Google Live.
export function createElevenLabsProtocol() {
  const responseIds = new Set()
  let activeResponseId = ''
  let interrupted = false
  let lastInterruptId = -1
  let muted = false
  // True when the last conversation item written to the service already
  // prompts a reply (user_message); responseCreate must not double-trigger.
  let promptedTurn = false

  const ensureResponse = events => {
    if (!activeResponseId) activeResponseId = id('response')
    if (!responseIds.has(activeResponseId)) {
      responseIds.add(activeResponseId)
      events.push({
        type: 'response.created',
        response: { id: activeResponseId },
      })
    }
    return activeResponseId
  }

  const finishResponse = (events, status = interrupted ? 'cancelled' : 'completed') => {
    if (!activeResponseId) return
    events.push({
      type: 'response.done',
      response: { id: activeResponseId, status },
    })
    responseIds.delete(activeResponseId)
    activeResponseId = ''
    interrupted = false
  }

  return Object.freeze({
    encodeOutgoing: payload => payload,

    // Raw frames the service expects in reply to its own events. ElevenLabs
    // measures latency with application-level ping and expects an echoed pong.
    serviceReplies: event => {
      if (event?.type !== 'ping') return null
      const eventId = event.ping_event?.event_id ?? event.event_id
      if (eventId === undefined || eventId === null) return null
      return { type: 'pong', event_id: eventId }
    },

    normalizeIncoming: event => {
      if (!event || typeof event !== 'object') return null

      if (event.type === 'conversation_initiation_metadata') {
        const meta = event.conversation_initiation_metadata_event || {}
        const formats = [meta.user_input_audio_format, meta.agent_output_audio_format]
          .filter(Boolean)
        if (formats.some(format => format !== 'pcm_16000')) {
          return {
            type: 'error',
            error: {
              type: 'audio_format_mismatch',
              message: `ElevenLabs agent audio formats must both be pcm_16000 (got ${formats.join(', ')}). Run scripts/elevenlabs-agent-setup.mjs or fix the agent's ASR/TTS audio formats.`,
            },
          }
        }
        return {
          type: 'session.created',
          session: { id: String(meta.conversation_id || id('conv')) },
        }
      }

      if (event.type === 'audio') {
        const audio = event.audio_event || {}
        const eventId = Number(audio.event_id ?? -1)
        if (eventId >= 0 && eventId <= lastInterruptId) return null
        const events = []
        const responseId = ensureResponse(events)
        if (audio.audio_base_64) {
          events.push({
            type: 'response.audio.delta',
            response_id: responseId,
            delta: audio.audio_base_64,
            sampleRate: 16000,
          })
        }
        return events
      }

      if (event.type === 'agent_response') {
        const text = String(event.agent_response_event?.agent_response || '').trim()
        const events = []
        const responseId = ensureResponse(events)
        if (text) {
          events.push({
            type: 'response.audio_transcript.delta',
            response_id: responseId,
            delta: text,
            transcript: text,
          })
          events.push({
            type: 'response.audio_transcript.done',
            response_id: responseId,
            transcript: text,
          })
        }
        // agent_response carries the finalized turn text and is the service's
        // end-of-turn signal; audio for the turn precedes it on the wire.
        finishResponse(events)
        return events
      }

      if (event.type === 'agent_chat_response_part') {
        const part = event.text_response_part || {}
        const text = String(part.text || '')
        if (!text) return null
        const events = []
        const responseId = ensureResponse(events)
        events.push({ type: 'response.text.delta', response_id: responseId, delta: text })
        if (part.type === 'stop') finishResponse(events)
        return events
      }

      if (event.type === 'agent_response_correction') {
        // A post-barge-in text correction for an already-closed turn; there is
        // no safe open response to attach it to.
        return null
      }

      if (event.type === 'user_transcript') {
        const transcript = String(
          event.user_transcription_event?.user_transcript || '',
        ).trim()
        const events = []
        // A committed user turn means any active agent turn is over, even if
        // the service skipped the interruption event.
        finishResponse(events)
        if (transcript) {
          events.push({
            type: 'conversation.item.input_audio_transcription.completed',
            item_id: id('el_input'),
            transcript,
          })
        }
        return events.length ? events : null
      }

      if (event.type === 'interruption') {
        const eventId = Number(event.interruption_event?.event_id ?? -1)
        if (eventId >= 0) lastInterruptId = eventId
        interrupted = true
        const events = []
        // Only close the response. Unlike client-VAD providers, ElevenLabs
        // reports no user-speech start, and its interruption also fires when a
        // gateway user_message pre-empts the agent — synthesizing
        // speech_started here would poison the turn state (userSpeaking stuck)
        // and cancel the very response the runtime just requested.
        finishResponse(events, 'cancelled')
        return events
      }

      if (event.type === 'client_tool_call') {
        const call = event.client_tool_call || {}
        const events = []
        const responseId = ensureResponse(events)
        events.push({
          type: 'response.function_call_arguments.done',
          response_id: responseId,
          call_id: String(call.tool_call_id || id('call')),
          name: String(call.tool_name || ''),
          arguments: JSON.stringify(call.parameters || {}),
        })
        // The turn yields to the tool; continuation audio after
        // client_tool_result opens a fresh response.
        finishResponse(events)
        return events
      }

      if (event.type === 'client_error' || event.type === 'error') {
        return {
          type: 'error',
          error: {
            type: String(event.type || 'client_error'),
            message: String(
              event.client_error_event?.message
              || event.error?.message
              || event.message
              || 'ElevenLabs conversation error',
            ),
          },
        }
      }

      // ping (answered via serviceReplies), vad_score,
      // tentative_user_transcript, asr_initiation_metadata,
      // agent_response_metadata, mcp_* and other diagnostics carry no
      // normalized meaning.
      return null
    },

    connectionMessages: ({ session }) => {
      const override = {}
      if (session?.language) override.agent = { language: session.language }
      if (session?.voice) override.tts = { voice_id: session.voice }
      return [{
        type: 'conversation_initiation_client_data',
        conversation_config_override: override,
      }]
    },

    // Prompt, tools and voice live on the hosted agent; there is no
    // session.update dialect to refresh them mid-conversation.
    sessionUpdate: () => null,

    audioAppend: audio => (muted ? null : { user_audio_chunk: audio }),

    imageAppend: () => null,

    inputMute: () => {
      muted = true
      return null
    },

    inputUnmute: () => {
      muted = false
      return null
    },

    conversationItemId: () => id('el'),

    conversationItemCreate: (item, { contextOnly = true } = {}) => {
      if (item?.type === 'function_call_output') {
        // item.output is always a JSON string (functionOutputItem); the
        // service passes it to the LLM verbatim, so keep it a string.
        return {
          type: 'client_tool_result',
          tool_call_id: String(item.call_id || ''),
          result: typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? ''),
          is_error: false,
        }
      }
      const text = textFromItem(item)
      if (!text) return null
      // elPrompt marks injections that must produce a spoken reply (permission
      // asks, speak/result triggers); plain context rides the non-interrupting
      // contextual_update channel instead.
      if (!contextOnly || item?.elPrompt) {
        promptedTurn = true
        return { type: 'user_message', text }
      }
      return { type: 'contextual_update', text }
    },

    // Providers without transient response instructions turn them into a
    // conversation item; here that item is a prompting user_message.
    responseInstructionsItem: response => {
      const text = String(response?.instructions || '').trim()
      if (!text) return null
      return {
        type: 'message',
        role: 'user',
        elPrompt: true,
        content: [{ type: 'input_text', text }],
      }
    },

    // The prompting user_message already triggers the reply; there is no
    // response.create on this service. When no prompting item preceded (a
    // bare response request), a minimal user_message nudges the agent.
    responseCreate: () => {
      if (promptedTurn) {
        promptedTurn = false
        return null
      }
      return {
        type: 'user_message',
        text: 'Continue based on the latest context update and briefly tell the user what they need to hear, in the conversation language.',
      }
    },

    correlateResponseCreate: payload => payload,
    responseCorrelationId: () => '',

    // Barge-in is detected service-side and reported as an interruption
    // event; the client cannot cancel a hosted agent's turn.
    responseCancel: () => null,

    userTextItem: text => ({
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text }],
    }),

    functionOutputItem: (callId, output) => ({
      type: 'function_call_output',
      call_id: callId,
      output: JSON.stringify(output),
    }),
  })
}
