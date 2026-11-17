import { describe, expect, it } from 'vitest'

import { containsPhrase, decide, errorRate, normalize } from './keyterms'

describe('normalize', () => {
  it('maps number words to digits and drops punctuation', () => {
    expect(normalize('Bags in Zone Four, left shelf!')).toBe('bags in zone 4 left shelf')
  })
  it('expands ligatures and straightens quotes', () => {
    expect(normalize('ﬁnish the set’s')).toBe("finish the set's")
  })
  it('keeps decimals', () => {
    expect(normalize('1.5 seconds')).toBe('1.5 seconds')
  })
})

describe('containsPhrase', () => {
  it('matches whole words only', () => {
    expect(containsPhrase('the zone 10 sign', 'zone 1')).toBe(false)
    expect(containsPhrase('bags in zone one', 'zone 1')).toBe(true)
  })
})

describe('error rate and the committed decision', () => {
  it('computes missed over total key terms', () => {
    expect(errorRate([{ heard: ['a', 'b', 'c'], missed: ['d'] }])).toEqual({
      total: 4,
      missed: 1,
      rate: 0.25,
    })
  })
  it('treats no key terms at all as a full failure', () => {
    expect(errorRate([]).rate).toBe(1)
  })
  it('keeps Safari under 10%, adds a fix step at 10-20%, switches over 20%', () => {
    expect(decide(0.099)).toBe('keep')
    expect(decide(0.1)).toBe('keep-with-fix-step')
    expect(decide(0.2)).toBe('keep-with-fix-step')
    expect(decide(0.201)).toBe('switch')
  })
})
