import assert from 'node:assert/strict'
import test from 'node:test'
import { createElevenLabsProtocol } from '../src/voice/providers/elevenlabs-protocol.mjs'

function userMessageItem(protocol, text) {
  return protocol.conversationItemCreate({
    type: 'message',
    role: 'user',
    elPrompt: true,
    content: [{ type: 'input_text', text }],
  })
}

function agentTurn(protocol) {
  // First audio chunk opens the synthesized response; agent_response ends it.
  const opened = protocol.normalizeIncoming({ type: 'audio', audio_event: { audio_base_64: 'AAAA', event_id: 1 } })
  const closed = protocol.normalizeIncoming({
    type: 'agent_response',
    agent_response_event: { agent_response: 'One. Two.', event_id: 2 },
  })
  return [...(opened || []), ...(closed || [])]
}

test('barge-in interruption synthesizes speech_started and the transcript closes it', () => {
  const protocol = createElevenLabsProtocol()
  agentTurn(protocol)

  const interruptEvents = protocol.normalizeIncoming({
    type: 'interruption',
    interruption_event: { event_id: 3 },
  })
  const speechStarted = interruptEvents.find(e => e.type === 'input_audio_buffer.speech_started')
  assert.ok(speechStarted, 'barge-in must open a voice turn so playback stops')
  assert.ok(speechStarted.item_id)
  assert.ok(interruptEvents.some(e => e.type === 'response.done' && e.response.status === 'cancelled'))

  const transcriptEvents = protocol.normalizeIncoming({
    type: 'user_transcript',
    user_transcription_event: { user_transcript: 'stop' },
  })
  const speechStopped = transcriptEvents.find(e => e.type === 'input_audio_buffer.speech_stopped')
  assert.ok(speechStopped, 'the following transcript closes the synthesized speech span')
  assert.equal(speechStopped.item_id, speechStarted.item_id)
  assert.ok(transcriptEvents.some(e => (
    e.type === 'conversation.item.input_audio_transcription.completed'
  )))
})

test('interruption echoing a gateway user_message does not open a voice turn', () => {
  const protocol = createElevenLabsProtocol()
  agentTurn(protocol)

  // Gateway pre-empts the agent with a prompted user_message (result delivery).
  const message = userMessageItem(protocol, 'Tell the user the result.')
  assert.equal(message.type, 'user_message')

  const events = protocol.normalizeIncoming({
    type: 'interruption',
    interruption_event: { event_id: 3 },
  }) || []
  assert.ok(events.some(e => e.type === 'response.done' && e.response.status === 'cancelled'))
  assert.equal(
    events.find(e => e.type === 'input_audio_buffer.speech_started'),
    undefined,
    'the pre-emption echo must not synthesize speech_started',
  )

  // A later, independent barge-in still opens a voice turn.
  agentTurn(protocol)
  return new Promise(resolve => setTimeout(() => {
    const later = protocol.normalizeIncoming({
      type: 'interruption',
      interruption_event: { event_id: 6 },
    })
    assert.ok(later.some(e => e.type === 'input_audio_buffer.speech_started'))
    resolve()
  }, 2600))
})
