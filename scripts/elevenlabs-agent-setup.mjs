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
//   --llm <model>          LLM for the agent (default on --create: gemini-3.8-flash)
//   --voice <voice_id>     TTS voice id (default: keep the agent's current voice)
//   --tts-model <model>    TTS model id (default on --create: eleven_v4_turbo)
//   --first-message <text> Spoken greeting (default on --create: none)
//   --prompt-file <path>   Extra persona/behavior file merged into the prompt
//                          (default: ~/.config/qwaudio/elevenlabs-agent-prompt.md
//                          when it exists; env: ELEVENLABS_AGENT_PROMPT_FILE)
//   --prompt-mode <mode>   merge | replace | keep (default: merge)
//   --reasoning <effort>   LLM reasoning effort (default on every run: low —
//                          keeps voice latency down; use medium/high for harder
//                          reasoning at the cost of response time)
//   --base-url <url>       API base (default: https://api.elevenlabs.io)
//
// Re-run after upgrading this repository to refresh the tool definitions and
// instructions on the agent. The API key is never printed or persisted.

import { frontendTools } from '../server/src/frontend/frontend-tools.mjs'
import {
  buildHostedAgentPrompt,
  defaultHostedPersonaFile,
  HOSTED_AGENT_MASTER_PROMPT,
} from '../server/src/frontend/hosted-agent-prompt.mjs'

const MANAGED_BY = 'qwen-audio-agent'

// The hosted agent must accept per-conversation overrides for every field the
// Gateway sends in the initiation handshake: language, voice, and the full
// assembled prompt (live memory/preferences/runtime context).
const OVERRIDE_ALLOWLIST = {
  agent: { language: true, first_message: true, prompt: { prompt: true } },
  tts: { voice_id: true },
}

// Install the superset of frontend tools. The Gateway re-checks capabilities
// on every call and answers with a clean "unavailable" when a feature is off,
// so installing capability-gated tools here is safe — it lets features like
// memory, recall and web search light up as soon as the Gateway config
// provides them, without re-running this script.
const SETUP_TOOL_CAPABILITIES = [
  'memory',                // voicemem provider is configured by default
  'recall',                // session digests
  'web-search',            // needs QWEN_AUDIO_WEB_SEARCH_PROVIDER at runtime
  'url-fetch',             // always available at runtime
  'permission.respond',    // PERMISSION_RESPONSE_CAPABILITY
  'backend.input.respond', // BACKEND_INPUT_RESPONSE_CAPABILITY
]

function parseArgs(argv) {
  const options = { language: 'ar', promptMode: 'merge', reasoning: 'low' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = () => argv[++index]
    if (arg === '--create') options.create = next() || MANAGED_BY
    else if (arg === '--language') options.language = next()
    else if (arg === '--llm') options.llm = next()
    else if (arg === '--voice') options.voice = next()
    else if (arg === '--tts-model') options.ttsModel = next()
    else if (arg === '--first-message') options.firstMessage = next()
    else if (arg === '--prompt-file') options.promptFile = next()
    else if (arg === '--prompt-mode') options.promptMode = next()
    else if (arg === '--reasoning') options.reasoning = next()
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

// Desktop-owned client tool (web/src/desktop/client-tools.js): the Gateway
// routes it to the connected desktop client, which hides the panel and keeps
// only the local wake word alive. The agent must see it to call it.
const DESKTOP_CLIENT_TOOLS = [{
  name: 'enter_sleep',
  description: 'Put the voice frontend to sleep. Call this IMMEDIATELY when the user dismisses you, says goodbye, or asks you to sleep — do not just reply verbally. Sleeping never cancels background work, never quits the app, and is not a mute; the user wakes you with the wake word.',
  inputSchema: { type: 'object', properties: {} },
}]

// System tools ride the tools array with params.system_tool_type — the API
// silently ignores direct built_in_tools updates but normalizes this shape
// into prompt.built_in_tools. skip_turn lets the agent stay silent on
// noise-only turns. end_call stays off on purpose: sleeping routes through
// the enter_sleep client tool so the wake word resumes the conversation.
const SYSTEM_TOOLS = [{
  type: 'system',
  name: 'skip_turn',
  description: 'Call this to stay silent for this turn: empty transcripts, punctuation-only turns (like "..."), or unintelligible background noise. No reply, no questions.',
  response_timeout_secs: 10,
  params: { system_tool_type: 'skip_turn' },
}]

function clientToolConfigs() {
  const gatewayTools = frontendTools({
    frontend: { capabilities: SETUP_TOOL_CAPABILITIES },
  }).map(tool => ({
    type: 'client',
    name: tool.function.name,
    description: String(tool.function.description || '').slice(0, 1000),
    expects_response: true,
    response_timeout_secs: 60,
    parameters: cleanSchema(tool.function.parameters) || { type: 'object', properties: {} },
  }))
  const desktopTools = DESKTOP_CLIENT_TOOLS.map(tool => ({
    type: 'client',
    name: tool.name,
    description: tool.description,
    // enter_sleep succeeds silently — the goodbye is spoken before the call.
    expects_response: false,
    response_timeout_secs: 10,
    parameters: { type: 'object', description: 'No arguments.', properties: {} },
  }))
  return [...gatewayTools, ...desktopTools, ...SYSTEM_TOOLS]
}

function mergeTools(existing = [], managed = []) {
  const managedNames = new Set(managed.map(tool => tool.name))
  const kept = existing.filter(tool => !managedNames.has(tool?.name))
  return [...kept, ...managed]
}

function mergePrompt(existingPrompt, instructions) {
  const existing = String(existingPrompt || '').trim()
  if (!existing || existing === instructions) return instructions
  // A prompt we previously installed is fully refreshed on every run — this is
  // what keeps tool instructions current after a repository upgrade.
  if (existing.startsWith(HOSTED_AGENT_MASTER_PROMPT.slice(0, 80))) return instructions
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

function defaultPromptFile() {
  return defaultHostedPersonaFile()
}

// Full prompt = master contract + optional user persona file + the
// repository's operational instructions. The same assembly runs per
// conversation on the Gateway (with live memory/runtime context) via the
// prompt override; this static copy is the agent's dashboard fallback.
function buildAgentPrompt(options) {
  const promptFile = String(
    options.promptFile || process.env.ELEVENLABS_AGENT_PROMPT_FILE || '',
  ).trim() || defaultPromptFile()
  return buildHostedAgentPrompt({}, { personaFile: promptFile })
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

  const instructions = buildAgentPrompt(options)
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
  // The API rejects payloads that carry both inline tools and tool_ids; this
  // script manages the inline tool list, so stale tool ids must go.
  delete prompt.tool_ids
  const llm = options.llm || (options.create ? 'gemini-3.8-flash' : undefined)
  if (llm) prompt.llm = llm

  const conversationConfig = {
    ...existingConfig,
    agent: {
      ...(existingConfig.agent || {}),
      language: options.language,
      prompt,
    },
    asr: { ...(existingConfig.asr || {}), quality: 'high', provider: 'scribe_realtime', user_input_audio_format: 'pcm_16000' },
    conversation: {
      ...(existingConfig.conversation || {}),
      // The service default is 600s and hard-drops longer conversations.
      max_duration_seconds: 1800,
    },
    turn: {
      ...(existingConfig.turn || {}),
      // Latest turn model; eagerness stays normal — noise suppression is the
      // prompt's job, not a slower turn detector's.
      turn_model: 'turn_v3',
      turn_eagerness: 'normal',
    },
    tts: {
      ...(existingConfig.tts || {}),
      agent_output_audio_format: 'pcm_16000',
      ...(options.voice ? { voice_id: options.voice } : {}),
      ...(options.ttsModel || options.create
        ? { model_id: options.ttsModel || 'eleven_v4_turbo' }
        : {}),
    },
  }
  // Reasoning effort keeps voice latency low; only models that support
  // configurable reasoning accept the field (gemini-3.8-flash: low/medium/high).
  if (options.reasoning) prompt.reasoning_effort = options.reasoning
  if (options.firstMessage) conversationConfig.agent.first_message = options.firstMessage

  const platformSettings = {
    ...(existing?.platform_settings || {}),
    overrides: {
      ...(existing?.platform_settings?.overrides || {}),
      conversation_config_override: OVERRIDE_ALLOWLIST,
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
  console.log('Note: the agent prompt starts with an English master contract')
  console.log('(language + capability rules). Add your own persona/house rules in')
  console.log(`  ${defaultPromptFile()}`)
  console.log('then re-run this script to apply them.')
}

main().catch(error => {
  console.error(`elevenlabs-agent-setup: ${error.message}`)
  process.exit(1)
})
