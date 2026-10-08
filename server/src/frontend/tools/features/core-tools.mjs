import { currentTimeSnapshot } from '../../../conversation/frontend-agent-context.mjs'

export const GET_CURRENT_TIME_TOOL_NAME = 'get_current_time'

const getCurrentTimeTool = {
  type: 'function',
  function: {
    name: GET_CURRENT_TIME_TOOL_NAME,
    description: 'Get the exact current date, time, and weekday in the user\'s local time zone; also the basis for relative date and time calculations.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
}

export const coreToolEntries = [
  { definition: getCurrentTimeTool },
]

export function coreToolHandlers(runtime) {
  return {
    [GET_CURRENT_TIME_TOOL_NAME]: async ({ callId, turnId }) => {
      await runtime.sendOutput(callId, {
        status: 'ok',
        ...currentTimeSnapshot(runtime.getClientContext()),
      }, turnId)
    },
  }
}
