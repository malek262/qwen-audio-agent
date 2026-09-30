#!/usr/bin/env node
// Prepares a hosted ElevenLabs Agent for use as this runtime's voice frontend.
//
// The hosted agent owns STT, LLM and TTS on ElevenLabs infrastructure. This
// script installs the runtime's frontend tools as ElevenLabs *client* tools
// (the Gateway executes them and returns results over the conversation
// WebSocket), writes the frontend instructions into the agent prompt, locks
// both audio formats to pcm_16000, and allowlists the per-conversation
// overrides the Gateway may send.
//
// Usage:
//   ELEVENLABS_API_KEY=... node scripts/elevenlabs-agent-setup.mjs --create "My Assistant"
//   ELEVENLABS_API_KEY=... ELEVENLABS_AGENT_ID=agent_... node scripts/elevenlabs-agent-setup.mjs
//
// Options:
//   --create <name>        Create a new agent instead of updating an existing one
//   --language <code>      Agent language for ASR/TTS (default: ar)
//   --llm <model>          LLM for the agent (default on --create: gemini-2.5-flash)
//   --voice <voice_id>     TTS voice id (default: keep the agent's current voice)
//   --tts-model <model>    TTS model id (default on --create: eleven_flash_v2_5)
//   --first-message <text> Spoken greeting (default on --create: none)
//   --prompt-mode <mode>   merge | replace | keep (default: merge)
//   --base-url <url>       API base (default: https://api.elevenlabs.io)
//
// Re-run after upgrading this repository to refresh the tool definitions and
// instructions on the agent. The API key is never printed or persisted.

import {
  buildFrontendInstructions,
  frontendTools,
} from '../server/src/frontend/frontend-tools.mjs'

const MANAGED_BY = 'qwen-audio-agent'

function parseArgs(argv) {
  const options = { language: 'ar', promptMode: 'merge' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = () => argv[++index]
    if (arg === '--create') options.create = next() || MANAGED_BY
    else if (arg === '--language') options.language = next()
    else if (arg === '--llm') options.llm = next()
    else if (arg === '--voice') options.voice = next()
    else if (arg === '--tts-model') options.ttsModel = next()
    else if (arg === '--first-message') options.firstMessage = next()
    else if (arg === '--prompt-mode') options.promptMode = next()
    else if (arg === '--base-url') options.baseUrl = next()
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!['merge', 'replace', 'keep'].includes(options.promptMode)) {
    throw new Error('--prompt-mode must be merge, replace or keep')
  }
  return options
}

// ElevenLabs client-tool parameters accept a conservative JSON Schema subset;
// strip anything the API rejects with 422. Every schema node must carry one
// "value source" field, so fall back to a description when none exists.
function cleanSchema(node, fallbackName = 'value') {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return node
  const allowed = ['type', 'description', 'enum', 'items', 'properties', 'required']
  const result = {}
  for (const key of allowed) {
    if (node[key] === undefined) continue
    if (key === 'properties') {
      result.properties = Object.fromEntries(
        Object.entries(node.properties).map(([name, value]) => [name, cleanSchema(value, name)]),
      )
    } else if (key === 'items') {
      result.items = cleanSchema(node.items, `${fallbackName} item`)
    } else {
      result[key] = node[key]
    }
  }
  if (result.type && !result.description) result.description = `The ${fallbackName}.`
  return result
}

function clientToolConfigs() {
  return frontendTools({}).map(tool => ({
    type: 'client',
    name: tool.function.name,
    description: String(tool.function.description || '').slice(0, 1000),
    expects_response: true,
    response_timeout_secs: 60,
    parameters: cleanSchema(tool.function.parameters) || { type: 'object', properties: {} },
  }))
}

function mergeTools(existing = [], managed = []) {
  const managedNames = new Set(managed.map(tool => tool.name))
  const kept = existing.filter(tool => !managedNames.has(tool?.name))
  return [...kept, ...managed]
}

function mergePrompt(existingPrompt, instructions) {
  const existing = String(existingPrompt || '').trim()
  if (!existing || existing === instructions) return instructions
  if (existing.includes(instructions.slice(0, 200))) return existing
  return `${instructions}\n\n---\n\n# Additional persona instructions (pre-existing agent prompt)\n\n${existing}`
}

async function api(baseUrl, apiKey, method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'xi-api-key': apiKey,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await response.text()
  let payload
  try { payload = text ? JSON.parse(text) : {} } catch { payload = { raw: text } }
  if (!response.ok) {
    const detail = payload?.detail
    const message = typeof detail === 'string' ? detail : (detail?.message || text.slice(0, 500))
    throw new Error(`${method} ${path} failed (${response.status}): ${message}`)
  }
  return payload
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log('See the header comment of this script for usage.')
    return
  }
  const apiKey = String(process.env.ELEVENLABS_API_KEY || '').trim()
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is required')
  const baseUrl = String(options.baseUrl || 'https://api.elevenlabs.io').replace(/\/+$/, '')
  const agentId = String(process.env.ELEVENLABS_AGENT_ID || '').trim()
  if (!options.create && !agentId) {
    throw new Error('Provide ELEVENLABS_AGENT_ID or pass --create <name>')
  }

  const instructions = buildFrontendInstructions({})
  const managedTools = clientToolConfigs()

  let existing = null
  if (!options.create) {
    existing = await api(baseUrl, apiKey, 'GET', `/v1/convai/agents/${agentId}`)
  }

  const existingConfig = existing?.conversation_config || {}
  const existingPrompt = existingConfig.agent?.prompt || {}

  const prompt = { ...existingPrompt }
  if (options.promptMode === 'replace') prompt.prompt = instructions
  else if (options.promptMode === 'merge') prompt.prompt = mergePrompt(existingPrompt.prompt, instructions)
  prompt.tools = mergeTools(existingPrompt.tools, managedTools)
  const llm = options.llm || (options.create ? 'gemini-2.5-flash' : undefined)
  if (llm) prompt.llm = llm

  const conversationConfig = {
    ...existingConfig,
    agent: {
      ...(existingConfig.agent || {}),
      language: options.language,
      prompt,
    },
    asr: { ...(existingConfig.asr || {}), user_input_audio_format: 'pcm_16000' },
    tts: {
      ...(existingConfig.tts || {}),
      agent_output_audio_format: 'pcm_16000',
      ...(options.voice ? { voice_id: options.voice } : {}),
      ...(options.ttsModel || options.create
        ? { model_id: options.ttsModel || 'eleven_flash_v2_5' }
        : {}),
    },
  }
  if (options.firstMessage) conversationConfig.agent.first_message = options.firstMessage

  const platformSettings = {
    ...(existing?.platform_settings || {}),
    overrides: {
      ...(existing?.platform_settings?.overrides || {}),
      conversation_config_override: {
        agent: { language: true, first_message: true },
        tts: { voice_id: true },
      },
    },
  }

  let finalAgentId = agentId
  if (options.create) {
    const created = await api(baseUrl, apiKey, 'POST', '/v1/convai/agents/create', {
      name: options.create,
      conversation_config: conversationConfig,
      platform_settings: platformSettings,
    })
    finalAgentId = created.agent_id
  } else {
    await api(baseUrl, apiKey, 'PATCH', `/v1/convai/agents/${agentId}`, {
      conversation_config: conversationConfig,
      platform_settings: platformSettings,
    })
  }

  console.log('')
  console.log(`ElevenLabs agent ready: ${finalAgentId}`)
  console.log(`Installed ${managedTools.length} client tools: ${managedTools.map(tool => tool.name).join(', ')}`)
  console.log('')
  console.log('Add these lines to your config.env (~/.config/qwaudio/config.env):')
  console.log('')
  console.log('  QWEN_AUDIO_REALTIME_PROVIDER=elevenlabs')
  console.log(`  ELEVENLABS_AGENT_ID=${finalAgentId}`)
  console.log('  ELEVENLABS_API_KEY=<your key>   # required for private agents')
  console.log(`  ELEVENLABS_AGENT_LANGUAGE=${options.language}`)
  console.log('')
  console.log('Note: tool descriptions and frontend instructions follow this')
  console.log("repository's source language; the recommended agent LLMs handle them")
  console.log('regardless of the conversation language.')
}

main().catch(error => {
  console.error(`elevenlabs-agent-setup: ${error.message}`)
  process.exit(1)
})
