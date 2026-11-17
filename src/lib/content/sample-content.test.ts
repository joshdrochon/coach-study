import { describe, expect, it } from 'vitest'

import glossary from '../../../content/method/glossary.json'
import { GLOSSARY, glossaryBlock, glossaryFor } from '../grader/glossary'
import { ACRONYM_LIST, spokenText } from '../tts/spoken'

import { citationsFor, loadBank } from './bank'

const bank = loadBank()

describe('the shipped sample content', () => {
  it('has accepted cards, each citing a passage that holds its quote', () => {
    expect(bank.items.length).toBeGreaterThan(400)
    for (const item of bank.items) {
      const cited = citationsFor(bank, item)
      expect(cited.length, item.id).toBe(item.citations.length)
      for (const { passage, quote } of cited) {
        expect(passage.text.toLowerCase(), item.id).toContain(quote.toLowerCase())
      }
    }
  })

  it('gives every glossary entry a quote from its own passages', () => {
    expect(GLOSSARY).toHaveLength(glossary.entries.length)
    for (const entry of GLOSSARY) {
      const text = entry.passageIds.map((id) => bank.passages.get(id)?.text ?? '').join(' ')
      expect(text, entry.term).toContain(entry.quote)
    }
  })

  it('tells the grader only the definitions a card uses', () => {
    expect(glossaryBlock()).toContain('- tempo = how many counts each part of a move takes')
    expect(glossaryFor('What is the tempo here?')).toHaveLength(1)
    expect(glossaryFor('Nothing to define')).toEqual([])
  })

  it('says acronyms the way the data file says them', () => {
    expect(ACRONYM_LIST.map((entry) => entry.letters)).toContain('HQ')
    expect(spokenText('Call HQ daily.')).toBe('Call headquarters daily.')
    expect(spokenText('Fix the PC monitor.')).toBe('Fix the P-C monitor.')
    expect(spokenText('PC is fine.')).toBe('PC is fine.')
  })
})
