import { normalizeRecurrence } from '../../../task/recurrence.mjs'
import { toolFailure } from '../tool-result.mjs'

export const SCHEDULE_REMINDER_TOOL_NAME = 'schedule_reminder'

const scheduleReminderTool = {
  type: 'function',
  function: {
    name: SCHEDULE_REMINDER_TOOL_NAME,
    description: 'Create a reminder or background task that triggers in the future; not for merely recording list entries. Call get_current_time first to determine the current time, then compute the trigger time.',
    parameters: {
      type: 'object',
      properties: {
        execute_at: {
          type: 'string',
          description: 'The trigger time computed from the user\'s local time zone, as an ISO 8601 timestamp including the time zone offset.',
        },
        reminder: {
          type: 'string',
          description: 'The reminder content or task description. Faithfully preserve what the user wants to be reminded of or have executed.',
        },
        type: {
          type: 'string',
          enum: ['reminder', 'task'],
          description: 'reminder=announce the content at the due time (default); task=the backend Agent executes at the due time and announces the result, requires a configured backend. Use reminder when the user only asks to be reminded; use task when they want something executed and then reported.',
        },
        recurrence: {
          type: 'string',
          enum: ['once', 'daily', 'weekly', 'weekdays'],
          description: 'Recurrence pattern, default once; daily=every day, weekly=every week, weekdays=Monday through Friday. Recurring reminders keep the local time in the client time zone.',
        },
      },
      required: ['execute_at', 'reminder'],
      additionalProperties: false,
    },
  },
}

export const scheduleToolEntries = [
  { definition: scheduleReminderTool },
]

const reminderOnlyTool = {
  ...scheduleReminderTool,
  function: {
    ...scheduleReminderTool.function,
    description: 'Create a reminder that triggers in the future; does not execute background work. Call get_current_time first to determine the current time, then compute the trigger time.',
    parameters: {
      ...scheduleReminderTool.function.parameters,
      properties: {
        ...scheduleReminderTool.function.parameters.properties,
        type: {
          type: 'string',
          enum: ['reminder'],
          description: 'Announce the reminder content at the due time (default); does not execute background work.',
        },
      },
    },
  },
}

export function scheduleToolForContext(context) {
  return context?.frontend?.backendConfigured === false
    ? reminderOnlyTool
    : scheduleReminderTool
}

async function scheduleReminder(runtime, callId, turnId, args) {
  const executeAt = Date.parse(args.execute_at)
  if (!executeAt || executeAt <= Date.now()) {
    await runtime.sendOutput(callId, {
      status: 'error',
      error: true,
      error_code: 'invalid_time',
      user_message: '触发时间无效或已过期，请提供一个未来的时间。',
    }, turnId)
    return
  }

  const type = args.type === 'task' ? 'task' : 'reminder'
  if (type === 'task' && runtime.backendAvailability?.snapshot()?.configured === false) {
    await runtime.sendOutput(callId, toolFailure(
      'backend_unavailable',
      '当前未配置后台 Agent，无法创建定时执行任务；仍可创建到点播报的提醒。',
    ), turnId)
    return
  }
  const recurrence = normalizeRecurrence(args.recurrence)
  const runner = type === 'task'
    ? (objective, context) => runtime.taskOperations.runScheduled(objective, context)
    : null

  const task = runtime.taskManager.createScheduled({
    objective: args.reminder,
    ownerId: runtime.ownerId,
    sessionId: runtime.sessionId,
    turnId,
    schedule: {
      at: executeAt,
      recurrence,
      ...(recurrence === 'once'
        ? {}
        : { timeZone: runtime.getClientContext()?.timeZone }),
    },
    type,
    runner,
  })

  await runtime.sendOutput(callId, {
    status: 'scheduled',
    task_id: task.id,
    execute_at: args.execute_at,
    type,
    recurrence,
    ...(task.seriesId ? { series_id: task.seriesId } : {}),
  }, turnId, task.id, {
    response: {
      instructions: [
        '用一句自然的话确认已设好提醒，包含具体时间和内容。',
        '不要调用工具，不要重复确认。',
      ].join(' '),
    },
  })
}

export function scheduleToolHandlers(runtime) {
  return {
    [SCHEDULE_REMINDER_TOOL_NAME]: ({ callId, turnId, args }) => (
      scheduleReminder(runtime, callId, turnId, args)
    ),
  }
}
