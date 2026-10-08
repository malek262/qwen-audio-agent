import { PERMISSION_DECISIONS } from '../../../../../shared/permission-decisions.mjs'
import {
  spawnThinkingTool,
} from '../spawn-thinking-tool.mjs'

export { SPAWN_THINKING_TOOL_NAME } from '../spawn-thinking-tool.mjs'
export const CANCEL_AGENT_TASK_TOOL_NAME = 'cancel_agent_task'
export const GET_AGENT_TASK_STATUS_TOOL_NAME = 'get_agent_task_status'
export const RESPOND_PERMISSION_TOOL_NAME = 'respond_permission'
export const PERMISSION_RESPONSE_CAPABILITY = 'permission.respond'
export const RESPOND_AGENT_INPUT_TOOL_NAME = 'respond_agent_input'
export const BACKEND_INPUT_RESPONSE_CAPABILITY = 'backend.input.respond'

const cancelAgentTaskTool = {
  type: 'function',
  function: {
    name: CANCEL_AGENT_TASK_TOOL_NAME,
    description: 'Cancel asynchronous work, scheduled tasks, or reminders the user previously started that are still cancellable; supports cancelling a single item, a whole recurring-reminder series, or all work in the current session.',
    parameters: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'The task_id to cancel. Only use IDs returned by the system, never invent one; omit to cancel the most recently created, still-cancellable item in the current voice session.',
        },
        series_id: {
          type: 'string',
          description: 'The series_id returned by the recurring-reminder creation receipt. Use it when the user asks to stop a whole recurring reminder series; never invent one, and do not fill it together with task_id.',
        },
        all: {
          type: 'boolean',
          description: 'Set to true only when the user explicitly asks to cancel all work, scheduled tasks, and reminders in the current session; do not fill task_id or series_id in that case.',
        },
      },
      additionalProperties: false,
    },
  },
}

const getAgentTaskStatusTool = {
  type: 'function',
  function: {
    name: GET_AGENT_TASK_STATUS_TOOL_NAME,
    description: 'Query the latest status and results of created work, scheduled tasks, or reminders, or list recent records to identify a target; not for reviewing chat content.',
    parameters: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'A work ID returned by the system, from the current conversation or a tool result. Never invent one; when omitted, prefer the most recent work still in progress in the current voice session, otherwise the most recent item.',
        },
        list_all: {
          type: 'boolean',
          description: 'List up to 20 of the current user\'s most recent records, including work, scheduled tasks, and reminders from other sessions. Set to true when a list is needed or to identify a target; do not fill task_id in that case.',
        },
      },
      additionalProperties: false,
    },
  },
}

const respondPermissionTool = {
  type: 'function',
  function: {
    name: RESPOND_PERMISSION_TOOL_NAME,
    description: 'Reply to the permission request currently waiting for the user\'s decision. Judge from the operation just presented and the user\'s natural expression this turn; when the meaning is unclear, ask first. Never guess the permission\'s origin, decide on the user\'s behalf, or demand a fixed passphrase.',
    parameters: {
      type: 'object',
      properties: {
        permission_id: {
          type: 'string',
          description: 'May be omitted when there is only one pending request; when there are several, use the permission_id provided by the Gateway verbatim — never invent one.',
        },
        decision: {
          type: 'string',
          enum: PERMISSION_DECISIONS,
          description: 'task: allow the current task and its subsequent operations, for ordinary affirmative expressions; always: automatically allow subsequent permission requests for all tasks in this session, choose only when the user explicitly asks; reject: refuse the current operation.',
        },
      },
      required: ['decision'],
      additionalProperties: false,
    },
  },
}

const respondAgentInputTool = {
  type: 'function',
  function: {
    name: RESPOND_AGENT_INPUT_TOOL_NAME,
    description: 'Return the user\'s answer to the current background follow-up question to the same work. An authorization preview accepts only the user\'s explicit consent to that preview without added conditions. Use decline to reject the current preview or when the user modifies its conditions; use cancel only when the user explicitly asks to terminate the entire background work.',
    parameters: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'The ID of the work waiting for supplementary input; must come from the current background input request.',
        },
        action: {
          type: 'string',
          enum: ['accept', 'decline', 'cancel'],
          description: 'Ordinary follow-up question: accept submits the answer. Authorization preview: accept only when the user consents to the original preview without added conditions; decline rejects only the current preview (also when the user modifies the operation\'s conditions); cancel only when the user explicitly asks to terminate the entire background work.',
        },
        text: {
          type: 'string',
          description: 'The user\'s natural-language answer to hand to the backend. Fill when action=accept.',
        },
        values: {
          type: 'object',
          description: 'Optional structured form answer; fields must come from the schema provided in the request.',
          additionalProperties: true,
        },
      },
      required: ['task_id', 'action'],
      additionalProperties: false,
    },
  },
}

export const agentTaskToolEntries = [
  {
    definition: spawnThinkingTool,
    policy: { repeatHandling: 'handler' },
  },
  { definition: cancelAgentTaskTool },
  { definition: getAgentTaskStatusTool },
  {
    definition: respondPermissionTool,
    policy: {
      requiredCapabilities: [PERMISSION_RESPONSE_CAPABILITY],
    },
  },
  {
    definition: respondAgentInputTool,
    policy: {
      requiredCapabilities: [BACKEND_INPUT_RESPONSE_CAPABILITY],
    },
  },
]

export function agentTaskToolHandlers(runtime) {
  return {
    spawn_thinking: context => runtime.executeSpawnThinkingToolCall(context),
    [CANCEL_AGENT_TASK_TOOL_NAME]: context => runtime.executeCancelToolCall(context),
    [GET_AGENT_TASK_STATUS_TOOL_NAME]: context => runtime.executeStatusToolCall(context),
    [RESPOND_PERMISSION_TOOL_NAME]: context => runtime.respondPermission(context),
    [RESPOND_AGENT_INPUT_TOOL_NAME]: context => runtime.respondAgentInput(context),
  }
}
