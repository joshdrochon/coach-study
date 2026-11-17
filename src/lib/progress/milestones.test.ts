import { describe, expect, it } from 'vitest'

import { nextEvaluation, readinessHeading, recallHeading } from './milestones'

describe('the next evaluation', () => {
  it('is practice day through Aug 19, in Pacific time', () => {
    expect(nextEvaluation(new Date('2026-08-17T15:00:00Z'))).toBe('Aug 19')

    expect(nextEvaluation(new Date('2026-08-20T05:00:00Z'))).toBe('Aug 19')
  })

  it('is their first coaching session after that, through Sep 10', () => {
    expect(nextEvaluation(new Date('2026-08-20T15:00:00Z'))).toBe('Sep 10')
    expect(nextEvaluation(new Date('2026-09-10T15:00:00Z'))).toBe('Sep 10')
  })

  it('is mastery, 30 days out, after Sep 10', () => {
    expect(nextEvaluation(new Date('2026-09-11T15:00:00Z'))).toBeNull()
    expect(readinessHeading(new Date('2026-09-22T15:00:00Z'))).toBe('Ready 30 days out?')
    expect(recallHeading(new Date('2026-09-22T15:00:00Z'))).toBe('Predicted recall 30 days out')
  })

  it('names the headings', () => {
    const dayOne = new Date('2026-08-17T15:00:00Z')
    expect(readinessHeading(dayOne)).toBe('Ready for Aug 19?')
    expect(recallHeading(dayOne)).toBe('Predicted recall on Aug 19')
  })
})
