// The desktop client owns both its model-visible contract and implementation.
export const desktopClientTools = Object.freeze([{
  name: 'enter_sleep',
  description: 'Put the current voice surface to sleep. It MUST be called immediately when the user explicitly asks you to step away, hide, collapse, or take a break — not merely reply verbally. Sleeping never cancels background work and is not for quitting the app or muting alone.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  response_on_success: 'none',
}])
