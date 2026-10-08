import {
  buildFrontendContext,
  loadFrontendPrompt,
  resolveAssistantProfile,
} from '../conversation/frontend-agent-context.mjs'
import { FrontendToolRegistry } from './tools/frontend-tool-registry.mjs'
import { optionalFrontendFeatures } from './optional-features.mjs'
import {
  spawnThinkingTool,
  withSpawnThinkingDescription,
} from './tools/spawn-thinking-tool.mjs'
import {
  agentTaskToolEntries,
  BACKEND_INPUT_RESPONSE_CAPABILITY,
  CANCEL_AGENT_TASK_TOOL_NAME,
  GET_AGENT_TASK_STATUS_TOOL_NAME,
  PERMISSION_RESPONSE_CAPABILITY,
  RESPOND_AGENT_INPUT_TOOL_NAME,
  RESPOND_PERMISSION_TOOL_NAME,
  SPAWN_THINKING_TOOL_NAME,
} from './tools/features/agent-task-tools.mjs'
import {
  coreToolEntries,
  GET_CURRENT_TIME_TOOL_NAME,
} from './tools/features/core-tools.mjs'
import {
  NOTES_TOOL_NAME,
  personalToolEntries,
} from './tools/features/personal-tools.mjs'
import {
  FETCH_URL_TOOL_NAME,
  FRONTEND_RECALL_CAPABILITY,
  RECALL_TOOL_NAME,
  retrievalToolEntries,
  WEB_SEARCH_TOOL_NAME,
} from './tools/features/retrieval-tools.mjs'
import {
  scheduleToolEntries,
  scheduleToolForContext,
  SCHEDULE_REMINDER_TOOL_NAME,
} from './tools/features/schedule-tools.mjs'

export {
  BACKEND_INPUT_RESPONSE_CAPABILITY,
  CANCEL_AGENT_TASK_TOOL_NAME,
  FETCH_URL_TOOL_NAME,
  FRONTEND_RECALL_CAPABILITY,
  GET_AGENT_TASK_STATUS_TOOL_NAME,
  GET_CURRENT_TIME_TOOL_NAME,
  NOTES_TOOL_NAME,
  PERMISSION_RESPONSE_CAPABILITY,
  RECALL_TOOL_NAME,
  RESPOND_AGENT_INPUT_TOOL_NAME,
  RESPOND_PERMISSION_TOOL_NAME,
  SCHEDULE_REMINDER_TOOL_NAME,
  SPAWN_THINKING_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
}

const featureEntries = [
  ...agentTaskToolEntries,
  ...scheduleToolEntries,
  ...coreToolEntries,
  ...personalToolEntries,
  ...retrievalToolEntries,
  ...optionalFrontendFeatures.flatMap(feature => feature.entries),
]
const entriesByName = new Map(featureEntries.map(entry => [
  entry.definition.function.name,
  entry,
]))
const toolOrder = [
  SPAWN_THINKING_TOOL_NAME,
  SCHEDULE_REMINDER_TOOL_NAME,
  CANCEL_AGENT_TASK_TOOL_NAME,
  GET_AGENT_TASK_STATUS_TOOL_NAME,
  GET_CURRENT_TIME_TOOL_NAME,
  NOTES_TOOL_NAME,
  RECALL_TOOL_NAME,
  RESPOND_PERMISSION_TOOL_NAME,
  RESPOND_AGENT_INPUT_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
  FETCH_URL_TOOL_NAME,
  ...optionalFrontendFeatures.flatMap(feature => (
    feature.entries.map(entry => entry.definition.function.name)
  )),
]

export const frontendToolRegistry = new FrontendToolRegistry(
  toolOrder.map(name => entriesByName.get(name)),
)

export const TOOLS = frontendToolRegistry.definitions()

function dynamicFrontendTools(agentContext = {}) {
  const configured = agentContext?.frontend?.tools
  if (!Array.isArray(configured)) return []
  const names = new Set(frontendToolRegistry.names())
  return configured.map(tool => {
    const name = String(tool?.function?.name || '').trim()
    if (!name || names.has(name)) {
      throw new Error(`Invalid or duplicate dynamic frontend tool: ${name || '(unnamed)'}`)
    }
    names.add(name)
    return tool
  })
}

export function frontendTools(agentContext = {}) {
  const spawnThinkingDescription = agentContext?.frontend?.spawnThinkingDescription
  const tools = frontendToolRegistry.definitions(agentContext).map(tool => {
    if (tool === spawnThinkingTool && spawnThinkingDescription) {
      return withSpawnThinkingDescription(spawnThinkingDescription)
    }
    if (tool.function.name === SCHEDULE_REMINDER_TOOL_NAME) {
      return scheduleToolForContext(agentContext)
    }
    return tool
  })
  const dynamic = dynamicFrontendTools(agentContext)
  if (dynamic.length) return [...tools, ...dynamic]
  return tools.length === TOOLS.length
    && tools.every((tool, index) => tool === TOOLS[index])
    ? TOOLS
    : tools
}

export const resultResponseInstructions = [
  'This is the final result of previously submitted work, not a new user request.',
  'Treat the result as factual material and respond naturally within the current conversation; you may summarize, merge, continue, or ask for necessary information according to the context, without repeating what was already expressed.',
  'When the result context contains multiple pieces of work, cover the substantive result of each; do not report only one of them, and do not let process or status content overshadow the work actually completed.',
  'If the result raises a question, choice, confirmation, or missing information needed to continue, convey only that need naturally; the user\'s later answer is handled as a continuation of the same work.',
  'Start directly with the actual outcome, key findings, blocker, or necessary question — no empty acknowledgments like "okay, received, task completed."',
  'When the detailed result is already shown on screen, state only the key points and where to look; do not read it verbatim.',
  'Do not read out protocol prefixes, fields, execution IDs, paths, URLs, or other long content unsuited to speech.',
  'Do not call any tools, do not add facts not present in the event, and do not describe unfinished work as completed.',
].join(' ')

export const progressResponseInstructions = [
  'This is a phase update from previously submitted work, not the final result and not a new user request.',
  'Convey only the new progress in one short natural spoken sentence; do not expand on reasoning, and do not describe unfinished work as completed.',
  'Do not read out protocol tags, internal fields, execution IDs, paths, URLs, or other long content unsuited to speech.',
  'Do not call any tools, and do not add facts not present in the update.',
].join(' ')

export function speakResponseInstructions(content) {
  return `Convey the following information in natural spoken language, keeping the facts consistent; do not call any tools:\n${content}`
}

export const permissionResponseInstructions = [
  'This is a permission request from the background Agent.',
  'Explain the pending operation naturally and briefly, and ask the user whether they authorize this task and its subsequent operations.',
  'Do not prescribe a specific answer format, and do not provide or demand a fixed passphrase.',
  'Do not call tools or read out internal fields; wait for the user\'s answer.',
].join(' ')

export const inputRequestResponseInstructions = [
  'This is a follow-up question from the same in-flight background work, not the final result and not a new task.',
  'Convey the question naturally and briefly, then wait for the user\'s answer; do not call spawn_thinking.',
  'After the user answers, call respond_agent_input to return the answer to the same work.',
  'Do not read out protocol fields or work IDs, and do not describe waiting for input as completed work.',
  'The question is addressed to the user, not to you; do not answer or approve on the user\'s behalf in the first person. Receiving the request itself is not the user\'s consent — you must wait for their next genuine reply.',
  'If the content is an authorization preview, relay only the proposed operation and the impact explicitly disclosed in the preview, then ask whether they approve and stop. Do not claim beforehand that this or subsequent operations have been submitted, are in progress, or are complete; do not append example answers; and never generate user utterances like "I agree."',
  'If this is an authorization preview for a write operation and the user modifies any condition, the new requirement cannot be treated as consent to the old preview; use respond_agent_input with decline to reject the current preview, do not cancel the whole task; once the original task wraps up, dispatch again with the updated requirements.',
].join(' ')

export function buildFrontendInstructions(agentContext = {}) {
  return [
    loadFrontendPrompt(),
    ...optionalFrontendFeatures.filter(feature => feature.entries.some(entry => (
      frontendToolRegistry.isEnabled(entry.definition.function.name, agentContext)
    ))).map(feature => feature.instructions).filter(Boolean),
    '# Assistant Profile',
    '<assistant_profile authority="persona_only">',
    resolveAssistantProfile(agentContext),
    '</assistant_profile>',
    ...optionalFrontendFeatures.map(feature => feature.context?.(agentContext)).filter(Boolean),
    buildFrontendContext(agentContext),
  ].join('\n\n')
}
