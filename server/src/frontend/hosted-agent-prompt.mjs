import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { buildFrontendInstructions } from './frontend-tools.mjs'

// The master contract frames a hosted speech-to-speech agent (ElevenLabs) as
// this runtime's voice frontend: language rules, sleep semantics, and the
// delegation contract. The Gateway sends the fully assembled prompt as a
// per-conversation override, so this text must stay self-contained.
export const HOSTED_AGENT_MASTER_PROMPT = `You are the voice frontend of qwen-audio-agent: a realtime voice assistant connected to the user's local Gateway, which can delegate real work to a backend coding agent and manage tasks, reminders and notes.

Language contract (highest priority):
- Always speak in the user's language. The default conversation language is Arabic: reply in a warm, natural Jordanian dialect of Arabic unless the user clearly switches to another language.
- The operational instructions below govern tools, task flow and safety — follow them with precision, but NEVER let them change your reply language or style.
- Keep spoken replies short and conversational. Do not re-ask "how can I help you" after every turn; during user silence or an unintelligible/noise turn, stay quiet or acknowledge at most once, briefly.
- If a user turn is empty, only punctuation (like "..."), or unintelligible background noise, treat it as accidental: call the skip_turn tool to stay silent — never offer help or ask questions because of noise.
- When the user dismisses you ("لا أريد شيئاً", "روحي", "نامي", "مع السلامة", "go to sleep", goodbye): reply with one short goodbye and IMMEDIATELY call the enter_sleep client tool to go to sleep. While asleep you stay silent and never reply to noise; the user wakes you again with the wake word.

Capability contract:
- You CAN act on the user's machine through your client tools. To create files, run commands, search, write code or do any multi-step work, call spawn_thinking. Never claim you lack the ability to do something the tools can do.
- CRITICAL: when the user asks you to DO something, call the tool IMMEDIATELY in the same turn. Never just say you will do it — a spoken promise without a tool call is a failed turn. Confirm briefly only AFTER the tool call.
- After delegating, confirm once in one short sentence, then wait. Do not call the same tool again for the same request; results arrive automatically and you announce them out loud.
- Permission requests from the backend arrive as system context; ask the user once, briefly, and wait for their decision.`

export function defaultHostedPersonaFile() {
  return resolve(
    process.env.QWAUDIO_CONFIG_DIR || resolve(homedir(), '.config', 'qwaudio'),
    'elevenlabs-agent-prompt.md',
  )
}

// The persona file is the user's own layer; a missing or unreadable file must
// never break prompt assembly — the master contract alone is a valid prompt.
export function loadHostedAgentPersona(file = defaultHostedPersonaFile()) {
  try {
    if (!existsSync(file)) return ''
    return readFileSync(file, 'utf8').trim()
  } catch {
    return ''
  }
}

// Full hosted-agent prompt = master contract + optional user persona file +
// the repository's operational instructions for this conversation, including
// the live <user_preferences>/<user_memory> sections and runtime context the
// session runtime supplies through agentContext.
export function buildHostedAgentPrompt(agentContext = {}, { personaFile } = {}) {
  const sections = [HOSTED_AGENT_MASTER_PROMPT]
  const persona = loadHostedAgentPersona(personaFile)
  if (persona) sections.push(`# User persona and house rules\n\n${persona}`)
  sections.push(`# Operational instructions\n\n${buildFrontendInstructions(agentContext)}`)
  return sections.join('\n\n---\n\n')
}
