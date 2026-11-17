import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadBank } from '../content/bank'
import { passageRunsFileSchema } from '../content/schema'

import { cardSystemPrompt } from './card'
import { cardRegradeSystemPrompt } from './card-regrade'
import { GLOSSARY, glossaryBlock } from './glossary'

const bank = loadBank()
const runs = passageRunsFileSchema.parse(
  JSON.parse(readFileSync(path.join(process.cwd(), 'content', 'passage-runs.json'), 'utf8')),
).runs

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .split(/[^a-z0-9']+/)
    .map((word) => word.replace(/^'+|'+$/g, ''))
    .filter((word) => word !== '')

function isRun(ids: readonly string[]): boolean {
  if (ids.length === 1) return true
  return runs.some((run) => {
    const start = run.indexOf(ids[0] ?? '')
    return start >= 0 && ids.every((id, i) => run[start + i] === id)
  })
}

describe('the glossary', () => {
  it('quotes each definition verbatim from its cited manual passages, on its page', () => {
    for (const entry of GLOSSARY) {
      const passages = entry.passageIds.map((id) => bank.passages.get(id))
      for (const passage of passages) {
        expect(passage?.kind, `${entry.term}: ${entry.passageIds.join(', ')}`).toBe('manual')
        if (passage?.kind === 'manual') expect(passage.page, entry.term).toBe(entry.page)
      }
      expect(isRun(entry.passageIds), `${entry.term}: passages are not one run`).toBe(true)
      const text = passages.map((passage) => passage?.text ?? '').join(' ')
      expect(text, entry.term).toContain(entry.quote)
    }
  })

  it('says the meaning in the quote’s own words, and the term as the manual names it', () => {
    for (const entry of GLOSSARY) {
      const quote = new Set(words(entry.quote))
      for (const word of words(entry.means)) {
        expect(quote.has(word), `${entry.term}: "${word}" is not in the quote`).toBe(true)
      }
      const heading = new Set(entry.passageIds.flatMap((id) => id.split('-')))
      for (const word of words(entry.term)) {
        expect(quote.has(word) || heading.has(word), `${entry.term}: "${word}"`).toBe(true)
      }
    }
  })

  it('has one entry per term', () => {
    const terms = GLOSSARY.map((entry) => entry.term.toLowerCase())
    expect(new Set(terms).size).toBe(terms.length)
  })

  it('leaves out what would turn a real mistake into a right answer', () => {
    const terms = GLOSSARY.map((entry) => entry.term.toLowerCase())
    expect(terms).not.toContain('blue band')
    expect(terms).not.toContain('tight')
    expect(GLOSSARY.some((entry) => entry.quote.includes('9 apples'))).toBe(false)
  })

  it('is given to the card grader and the re-grade for every card, in the cached prompt', () => {
    expect(cardSystemPrompt()).toContain(glossaryBlock())
    expect(cardRegradeSystemPrompt()).toContain(glossaryBlock())
  })
})
