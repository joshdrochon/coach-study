import { describe, expect, it } from 'vitest'

import { aiPunctuation, plainPunctuation } from './punctuation'

describe('plainPunctuation (model-written text only)', () => {
  it('turns an em dash into a comma', () => {
    expect(plainPunctuation('Not quite — you missed the bands.')).toBe(
      'Not quite, you missed the bands.',
    )
    expect(plainPunctuation('Almost—two apples, not one.')).toBe('Almost, two apples, not one.')
  })

  it('turns an en dash used as a dash into a comma, and keeps a range', () => {
    expect(plainPunctuation('Next stop – the library.')).toBe('Next stop, the library.')
    expect(plainPunctuation('Hold it for 80–90% of the time.')).toBe(
      'Hold it for 80–90% of the time.',
    )
  })

  it('ends the sentence at a semicolon and capitalizes the next word', () => {
    expect(plainPunctuation('Got it; the bus leaves at noon.')).toBe(
      'Got it. The bus leaves at noon.',
    )
    expect(plainPunctuation('lights on;  doors open')).toBe('lights on. Doors open')
    expect(plainPunctuation('Not quite; at noon.')).toBe('Not quite. At noon.')
  })

  it('leaves no stray mark at either end, and no doubled punctuation', () => {
    expect(plainPunctuation('— and the pegs')).toBe('and the pegs')
    expect(plainPunctuation('and the pegs —')).toBe('and the pegs')
    expect(plainPunctuation('and the pegs;')).toBe('and the pegs.')
    expect(plainPunctuation('the pegs —, then')).toBe('the pegs, then')
    expect(plainPunctuation('the pegs — . Then')).toBe('the pegs. Then')
  })

  it('keeps the joins between pieces of their words', () => {
    expect(plainPunctuation('lower down — slowly … and hold')).toBe('lower down, slowly … and hold')
  })

  it('passes a quotation of the manual through untouched', () => {
    const citation = '“Pack light; bring water — and a map.”'
    expect(plainPunctuation(citation)).toBe(citation)
    expect(plainPunctuation(`Almost — the manual says ${citation}`)).toBe(
      `Almost, the manual says ${citation}`,
    )
  })

  it('leaves nothing the voice audit would flag', () => {
    const model = 'Not quite — two apples; the library – then the park; done'
    expect(aiPunctuation(plainPunctuation(model))).toEqual([])
    expect(plainPunctuation('Got it.')).toBe('Got it.')
  })
})
