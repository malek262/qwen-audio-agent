// Builds sherpa-onnx KWS keywords.txt content for the bundled zh-en model.
//
// The stock keyword is Chinese (pinyin tokens). Custom phrases are English:
// each word is looked up in the model's CMU-style lexicon (en.phone) and
// expanded to its ARPAbet phoneme tokens, e.g. "hey malek" becomes
// `HH EY1 M AH0 L EH2 K @hey malek`. Words missing from the lexicon are
// rejected loudly — silently misspelling a keyword would just never fire.

export const DEFAULT_KEYWORD_LINE = 'n ǐ h ǎo q iān w èn @你好千问'
export const DEFAULT_KEYWORD = '你好千问'

export function parseLexicon(content) {
  const entries = new Map()
  for (const line of String(content || '').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const space = trimmed.indexOf(' ')
    if (space <= 0) continue
    const word = trimmed.slice(0, space).toUpperCase()
    const phones = trimmed.slice(space + 1).trim().split(/\s+/).filter(Boolean)
    // First pronunciation wins; alternates would need acoustic disambiguation
    // the keywords file cannot express per-entry.
    if (!entries.has(word) && phones.length) entries.set(word, phones)
  }
  return entries
}

export function keywordLineForPhrase(phrase, lexicon) {
  const normalized = String(phrase || '').trim().replace(/\s+/g, ' ')
  if (!normalized) return null
  const words = normalized.split(' ')
  const tokens = []
  const missing = []
  for (const word of words) {
    const cleaned = word.replace(/[^\p{L}\p{N}'-]/gu, '').toUpperCase()
    if (!cleaned) continue
    const phones = lexicon.get(cleaned)
    if (!phones) {
      missing.push(word)
      continue
    }
    tokens.push(...phones)
  }
  if (missing.length) {
    throw new Error(
      `Wake phrase uses words the English lexicon does not know: ${missing.join(', ')}. `
      + 'Pick common English words (e.g. "hey jarvis", "computer").',
    )
  }
  if (!tokens.length) return null
  return `${tokens.join(' ')} @${normalized}`
}

export function buildKeywordsFile({ phrase, lexiconContent }) {
  const lines = [DEFAULT_KEYWORD_LINE]
  const trimmed = String(phrase || '').trim()
  if (!trimmed || trimmed === DEFAULT_KEYWORD) return lines.join('\n') + '\n'
  const line = keywordLineForPhrase(trimmed, parseLexicon(lexiconContent))
  if (line) lines.push(line)
  return lines.join('\n') + '\n'
}
