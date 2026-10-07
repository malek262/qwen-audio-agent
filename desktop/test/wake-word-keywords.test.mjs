import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_KEYWORD_LINE,
  buildKeywordsFile,
  keywordLineForPhrase,
  parseLexicon,
} from '../src/wake-word/keyword-builder.mjs'

const LEXICON = [
  'HEY HH EY1',
  'JARVIS JH AA1 R V AH0 S',
  "O'CLOCK AH0 K L AA1 K",
].join('\n')

test('parses the CMU lexicon with first-pronunciation wins', () => {
  const lexicon = parseLexicon(`${LEXICON}\nHEY HH IY1\n`)
  assert.deepEqual(lexicon.get('HEY'), ['HH', 'EY1'])
  assert.deepEqual(lexicon.get('JARVIS'), ['JH', 'AA1', 'R', 'V', 'AH0', 'S'])
})

test('builds a keyword line from an English phrase', () => {
  const line = keywordLineForPhrase('Hey Jarvis!', parseLexicon(LEXICON))
  // The keywords-file parser splits on whitespace: the label must never
  // contain spaces (a space aborts the WASM engine with exit -1). The line
  // carries the per-keyword boost/threshold so the stock defaults stay
  // strict for the bundled demo phrase.
  assert.equal(line, 'HH EY1 JH AA1 R V AH0 S :2 #0.1 @Hey_Jarvis!')
})

test('rejects words missing from the lexicon with a clear error', () => {
  assert.throws(
    () => keywordLineForPhrase('hey qwexil', parseLexicon(LEXICON)),
    /qwexil/,
  )
})

test('empty phrases keep only the default keyword', () => {
  const content = buildKeywordsFile({ phrase: '', lexiconContent: LEXICON })
  assert.equal(content, `${DEFAULT_KEYWORD_LINE}\n`)
})

test('a custom phrase is appended next to the default keyword', () => {
  const content = buildKeywordsFile({ phrase: 'hey jarvis', lexiconContent: LEXICON })
  assert.equal(
    content,
    `${DEFAULT_KEYWORD_LINE}\nHH EY1 JH AA1 R V AH0 S :2 #0.1 @hey_jarvis\n`,
  )
})
