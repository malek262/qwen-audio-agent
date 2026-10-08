export const SPAWN_THINKING_TOOL_NAME = 'spawn_thinking'

export const spawnThinkingTool = {
  type: 'function',
  function: {
    name: SPAWN_THINKING_TOOL_NAME,
    // 客户定制点：只修改后台 Agent 的能力描述。固定调用规则位于
    // PROMPT.md，参数协议由下方 schema 定义。
    description: 'Call the backend Agent to access or operate the user\'s environment, devices, files, screen, applications, and code — for media creation, sustained execution, and producing deliverables; also used to continue or modify existing work after the user supplements information, makes a choice, or confirms.',
    parameters: {
      type: 'object',
      properties: {
        objective: {
          type: 'string',
          description: 'Faithfully, completely, and self-containedly convey what the user wants done together with its explicit constraints, preserving the execution approach and the relationship to existing work. Resolve clear references from the current conversation, adding only the facts or constraints necessary to complete it; do not omit, infer, or change the user\'s meaning; do not prescribe specific tools, Agents, or Sessions the user did not ask for; do not submit placeholder objectives. The backend does not receive the frontend\'s full conversation, personalization preferences, or stored long-term facts.',
        },
        input_refs: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 8,
          description: 'Fill in the corresponding input_N only when the task depends on images or files marked as "referenceable inputs" in earlier turns; inputs submitted in the current turn are carried automatically. Omit when there are no relevant inputs; never fabricate references.',
        },
      },
      required: ['objective'],
      additionalProperties: false,
    },
  },
}

export function withSpawnThinkingDescription(description) {
  const customized = String(description || '').trim()
  if (!customized || customized === spawnThinkingTool.function.description) {
    return spawnThinkingTool
  }
  return {
    ...spawnThinkingTool,
    function: {
      ...spawnThinkingTool.function,
      description: customized,
    },
  }
}
