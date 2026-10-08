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
  let activeTurnEventId = null
  let interrupted = false
  let lastInterruptId = -1
  let muted = false
  // True when the last conversation item written to the service already
  // prompts a reply (user_message); responseCreate must not double-trigger.
  let promptedTurn = false
  // agent_response carries the final turn TEXT, but audio may keep streaming
  // after it (v4 synthesizes while the transcript is already final). The turn
  // therefore ends on a quiet checkpoint, not on agent_response itself.
  let turnEnded = false
  let lastActivityAt = 0
  const TURN_IDLE_MS = 400

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

  const finishResponse = (events, status) => {
    // The interruption flag is single-use: consume it whether or not a
    // response is active. Leaving it set after a no-op interruption (fired,
    // for example, when a user_message pre-empts an idle agent) poisons every
    // later turn as cancelled.
    const resolved = status ?? (interrupted ? 'cancelled' : 'completed')
    interrupted = false
    if (!activeResponseId) return
    events.push({
      type: 'response.done',
      response: { id: activeResponseId, status: resolved },
    })
    responseIds.delete(activeResponseId)
    activeResponseId = ''
    activeTurnEventId = null
    turnEnded = false
  }

  // Close an open turn once the service went quiet past its final event. Pings
  // arrive every ~2s, so the worst-case lag stays bounded without timers.
  const closeIdleTurn = events => {
    if (
      activeResponseId
      && turnEnded
      && Date.now() - lastActivityAt > TURN_IDLE_MS
    ) finishResponse(events)
  }

  // A different turn event_id after the previous turn's final event means the
  // next turn started; close the old response first so its audio is never
  // re-tagged onto the new one.
  const closeStaleTurn = (events, eventId) => {
    if (
      activeResponseId
      && turnEnded
      && eventId !== null
      && eventId !== activeTurnEventId
    ) finishResponse(events)
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
      const events = []
      closeIdleTurn(events)

      if (event.type === 'conversation_initiation_metadata') {
        const meta = event.conversation_initiation_metadata_event || {}
        const formats = [meta.user_input_audio_format, meta.agent_output_audio_format]
          .filter(Boolean)
        if (formats.some(format => format !== 'pcm_16000')) {
          events.push({
            type: 'error',
            error: {
              type: 'audio_format_mismatch',
              message: `ElevenLabs agent audio formats must both be pcm_16000 (got ${formats.join(', ')}). Run scripts/elevenlabs-agent-setup.mjs or fix the agent's ASR/TTS audio formats.`,
            },
          })
          return events
        }
        events.push({
          type: 'session.created',
          session: { id: String(meta.conversation_id || id('conv')) },
        })
        return events
      }

      if (event.type === 'audio') {
        const audio = event.audio_event || {}
        const eventId = Number(audio.event_id ?? -1)
        if (eventId >= 0 && eventId <= lastInterruptId) return events.length ? events : null
        closeStaleTurn(events, eventId >= 0 ? eventId : null)
        const responseId = ensureResponse(events)
        activeTurnEventId = eventId >= 0 ? eventId : activeTurnEventId
        lastActivityAt = Date.now()
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
        const eventId = Number(event.agent_response_event?.event_id ?? -1)
        closeStaleTurn(events, eventId >= 0 ? eventId : null)
        // A post-interruption agent_response can arrive empty-handed: no audio
        // preceded it and no text rides it. Emitting a response pair for it
        // would present a phantom cancelled turn and fail announcement
        // acknowledgement, so skip contentless events entirely.
        if (!text && !activeResponseId) return events.length ? events : null
        const responseId = ensureResponse(events)
        if (eventId >= 0) activeTurnEventId = eventId
        lastActivityAt = Date.now()
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
        // The transcript is final, but trailing audio chunks still belong to
        // this turn; the turn closes on the next idle checkpoint or boundary.
        turnEnded = true
        return events
      }

      if (event.type === 'agent_chat_response_part') {
        const part = event.text_response_part || {}
        const text = String(part.text || '')
        if (!text) return events.length ? events : null
        const responseId = ensureResponse(events)
        events.push({ type: 'response.text.delta', response_id: responseId, delta: text })
        // Text-mode turns carry no trailing audio, so stop ends the turn here.
        if (part.type === 'stop') finishResponse(events)
        return events
      }

      if (event.type === 'agent_response_correction') {
        // A post-barge-in text correction for an already-closed turn; there is
        // no safe open response to attach it to.
        return events.length ? events : null
      }

      if (event.type === 'user_transcript') {
        const transcript = String(
          event.user_transcription_event?.user_transcript || '',
        ).trim()
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
        events.push({
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
        })
        return events
      }

      // ping (answered via serviceReplies), vad_score,
      // tentative_user_transcript, asr_initiation_metadata,
      // agent_response_metadata, mcp_* and other diagnostics carry no
      // normalized meaning — but they still checkpoint idle turns.
      return events.length ? events : null
    },

    connectionMessages: ({ session }) => {
      const override = {}
      const agent = {}
      if (session?.language) agent.language = session.language
      // Full-prompt override; requires the agent's Security allowlist entry
      // agent.prompt.prompt (installed by the setup script).
      if (session?.prompt) agent.prompt = { prompt: session.prompt }
      if (Object.keys(agent).length) override.agent = agent
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
