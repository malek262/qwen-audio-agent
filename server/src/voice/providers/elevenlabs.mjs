import { config } from '../../core/config.mjs'
import { PERMISSION_DECISIONS } from '../../../../shared/permission-decisions.mjs'
import {
  permissionResponseInstructions,
  resultResponseInstructions,
  speakResponseInstructions,
} from '../../frontend/frontend-tools.mjs'
import { createElevenLabsProtocol } from './elevenlabs-protocol.mjs'

export const ELEVENLABS_MODEL_PROFILE = Object.freeze({
  id: 'elevenlabs-agent',
  label: 'ElevenLabs Agent',
  family: 'elevenlabs',
  sessionDefaults: Object.freeze({
    voice: null,
    turnDetection: Object.freeze({ type: 'server_vad' }),
  }),
  modelCapabilities: Object.freeze({
    textInput: true, audioInput: true, imageInput: false, videoInput: false,
    textOutput: true, audioOutput: true, functionCalling: true,
  }),
  transportCapabilities: Object.freeze({
    textInput: true, audioInput: true, imageInput: false,
    imageBufferInput: false,
  }),
})

function elevenlabsUrl() {
  const base = String(config.elevenlabsRealtimeUrl || '').trim()
  const joiner = base.includes('?') ? '&' : '?'
  return `${base}${joiner}agent_id=${encodeURIComponent(config.elevenlabsAgentId)}`
}

// Injections that must produce a spoken reply travel as user_message, the
// only client event that prompts the hosted agent without interrupting it.
function promptItem(text) {
  return {
    type: 'message',
    role: 'user',
    elPrompt: true,
    content: [{ type: 'input_text', text }],
  }
}

// Result/permission content rides the non-interrupting contextual channel so
// context-only routes never trigger a reply; the spoken reply is prompted by
// response.instructions via the protocol's responseInstructionsItem path.
const RESULT_RESPONSE_TRIGGER = 'The context above carries a background task result and its announcement instructions. Announce that result to the user now, out loud, in the conversation language.'

export const elevenlabsProvider = {
  key: 'elevenlabs',
  label: 'ElevenLabs',
  aliases: ['elevenlabs-agent', 'elevenlabs-convai', '11labs'],
  inputSampleRate: 16000,
  outputSampleRate: 16000,
  createProtocol: createElevenLabsProtocol,
  capabilities: {
    // The initiation handshake is the whole session setup; there is no
    // session.update acknowledgement to wait for.
    acknowledgesSessionUpdate: false,
    // user_message, contextual_update and client_tool_result are fire-and-forget.
    acknowledgesConversationItems: false,
    conversationItemIdEcho: false,
    // A client_tool_result natively resumes the agent's turn.
    automaticToolResponses: true,
    // Response instructions become a prompting conversation item instead.
    perResponseInstructions: false,
    // The hosted agent owns its voice; a per-session override is only
    // applied during the initiation handshake.
    sessionOutputVoice: false,
    mutableSession: false,
  },

  model: () => config.elevenlabsAgentId || ELEVENLABS_MODEL_PROFILE.id,
  modelProfile: () => ELEVENLABS_MODEL_PROFILE,
  modelCatalog: () => [ELEVENLABS_MODEL_PROFILE],
  voice: () => config.elevenlabsVoice || null,
  isConfigured: () => Boolean(config.elevenlabsAgentId),
  missingConfigurationMessage: '请先配置 ELEVENLABS_AGENT_ID（私有 Agent 还需 ELEVENLABS_API_KEY）',
  connectTimeoutMessage: '连接 ElevenLabs 超时',
  connectTimeoutMs: 30000,
  url: elevenlabsUrl,
  // The ConvAI WebSocket accepts the API key directly on the handshake for
  // server-side clients; public agents need only their agent id.
  headers: () => (config.elevenlabsApiKey ? { 'xi-api-key': config.elevenlabsApiKey } : {}),
  classifyError: message => {
    if (/unauthorized|forbidden|invalid.*(key|token)|authentication|unexpected server response: (?:401|403)/i.test(message)) return 'fatal'
    if (/not[ _]found|no such agent|unexpected server response: 404/i.test(message)) return 'fatal'
    if (/quota|rate.?limit|insufficient|concurrency/i.test(message)) return 'fatal'
    if (/cancel|no active response/i.test(message)) return 'no_active_response'
    if (/safety|policy|blocked|guardrail/i.test(message)) return 'content_safety'
    return 'other'
  },

  // The hosted agent already carries the frontend instructions and client
  // tools (installed by scripts/elevenlabs-agent-setup.mjs). The session
  // payload only feeds the initiation handshake's allowlisted overrides.
  buildSession: ({ sessionOptions }) => ({
    voice: String(sessionOptions?.voice || config.elevenlabsVoice || '').trim(),
    language: String(config.elevenlabsLanguage || '').trim(),
  }),

  buildSpeakResponse: content => ({
    instructions: speakResponseInstructions(content),
  }),

  buildResultInjection: content => ({
    item: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: `${resultResponseInstructions}\n\n${content}` }],
    },
    response: { instructions: RESULT_RESPONSE_TRIGGER },
  }),

  buildPermissionInjection: permission => ({
    item: promptItem([
      permissionResponseInstructions,
      '<permission_request>',
      `permission_id=${permission.id}`,
      `task_id=${permission.taskId}`,
      `operation=${permission.summary}`,
      `allowed_decisions=${PERMISSION_DECISIONS.join(',')}`,
      '</permission_request>',
    ].join('\n')),
    response: {},
  }),
}
