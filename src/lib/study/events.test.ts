import { describe, expect, it } from 'vitest'

import { at, MINUTE, stored } from '@/test/study-fixtures'

import { contextOf, effectiveTime, parseEvents } from './events'

describe('contextOf', () => {
  it('maps the three study modes to study, and the baseline and mic practice to their own', () => {
    expect(contextOf('start')).toBe('study')
    expect(contextOf('focus')).toBe('study')
    expect(contextOf('together')).toBe('study')
    expect(contextOf('baseline')).toBe('baseline')
    expect(contextOf('mic-practice')).toBe('mic-practice')
  })
})

describe('parseEvents', () => {
  it('keeps rows that parse and counts the ones that do not', () => {
    const good = stored()
    const result = parseEvents([good, { ...good, rating: 7 }, { ...good, mode: 'chat' }, null])
    expect(result.events).toEqual([good])
    expect(result.invalid).toBe(3)
  })
})

describe('effectiveTime', () => {
  it('is when the learner answered', () => {
    const event = stored({ reviewedAt: at(0), receivedAt: at(5 * MINUTE) })
    expect(effectiveTime(event)).toEqual(at(0))
  })

  it('is when the server got it, when the iPad clock runs ahead', () => {
    const event = stored({ reviewedAt: at(10 * MINUTE), receivedAt: at(MINUTE) })
    expect(effectiveTime(event)).toEqual(at(MINUTE))
  })
})
