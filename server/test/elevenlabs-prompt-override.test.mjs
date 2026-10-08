import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { config } from '../src/core/config.mjs'
import {
  buildHostedAgentPrompt,
  HOSTED_AGENT_MASTER_PROMPT,
} from '../src/frontend/hosted-agent-prompt.mjs'
import { createElevenLabsProtocol } from '../src/voice/providers/elevenlabs-protocol.mjs'
import { elevenlabsProvider } from '../src/voice/providers/elevenlabs.mjs'

test('assembles the hosted prompt from master contract, persona and live context', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qwaudio-prompt-'))
  const personaFile = join(dir, 'persona.md')
  writeFileSync(personaFile, '# Persona — test\n\nSpeak briefly.\n')
  try {
    const prompt = buildHostedAgentPrompt({
      client: { timeZone: 'Asia/Amman', locale: 'ar-JO' },
      memories: [{ scope: 'profile', content: 'The user prefers short answers.' }],
    }, { personaFile })
    assert.ok(prompt.startsWith(HOSTED_AGENT_MASTER_PROMPT))
    assert.match(prompt, /# User persona and house rules[\s\S]*Speak briefly\./)
    assert.match(prompt, /# Operational instructions/)
    assert.match(prompt, /<user_preferences>[\s\S]*The user prefers short answers\./)
    assert.match(prompt, /time_zone="Asia\/Amman"/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a missing or unreadable persona file never breaks prompt assembly', () => {
  const prompt = buildHostedAgentPrompt({}, {
    personaFile: join(tmpdir(), 'qwaudio-no-such-persona.md'),
  })
  assert.ok(prompt.startsWith(HOSTED_AGENT_MASTER_PROMPT))
  assert.doesNotMatch(prompt, /# User persona and house rules/)
  assert.match(prompt, /# Operational instructions/)
})

test('the initiation handshake carries the prompt override only when present', () => {
  const protocol = createElevenLabsProtocol()
  const withPrompt = protocol.connectionMessages({
    session: { language: 'ar', voice: 'voice_1', prompt: 'PROMPT_OVERRIDE' },
  })
  assert.deepEqual(withPrompt, [{
    type: 'conversation_initiation_client_data',
    conversation_config_override: {
      agent: { language: 'ar', prompt: { prompt: 'PROMPT_OVERRIDE' } },
      tts: { voice_id: 'voice_1' },
    },
  }])

  const withoutPrompt = protocol.connectionMessages({
    session: { language: 'ar', voice: 'voice_1' },
  })
  assert.deepEqual(withoutPrompt, [{
    type: 'conversation_initiation_client_data',
    conversation_config_override: {
      agent: { language: 'ar' },
      tts: { voice_id: 'voice_1' },
    },
  }])
})

test('buildSession includes the assembled prompt unless the override is disabled', t => {
  const original = config.elevenlabsPromptOverride
  t.after(() => { config.elevenlabsPromptOverride = original })
  config.elevenlabsPromptOverride = true
  const session = elevenlabsProvider.buildSession({
    agentContext: { client: { timeZone: 'Asia/Amman', locale: 'ar-JO' } },
    sessionOptions: {},
  })
  assert.match(session.prompt, /voice frontend of qwen-audio-agent/)
  assert.match(session.prompt, /time_zone="Asia\/Amman"/)

  config.elevenlabsPromptOverride = false
  const disabled = elevenlabsProvider.buildSession({
    agentContext: { client: { timeZone: 'Asia/Amman', locale: 'ar-JO' } },
    sessionOptions: {},
  })
  assert.equal(disabled.prompt, '')
})
