import { describe, expect, it } from 'vitest'

import { MODELS } from '../grader/models'

import { costThrough, dailyCost, dailyTotal, daysThrough, DAILY_USE_ESTIMATE } from './estimate'

const row = (use: string) => {
  const found = DAILY_USE_ESTIMATE.find((r) => r.use === use)
  if (!found) throw new Error(`no row ${use}`)
  return found
}

describe('cost estimator', () => {
  it('grading row 0.40: 150 Haiku answers at 1.5K in and 200 out is about $0.40 a day', () => {
    const grading = row('Short-answer grading')
    expect(grading).toMatchObject({
      model: MODELS.haiku,
      callsPerDay: 150,
      inputTokens: 1500,
      outputTokens: 200,
    })
    expect(dailyCost(grading)).toBeCloseTo(0.375, 6)
    expect(Math.abs(dailyCost(grading) - 0.4)).toBeLessThanOrEqual(0.05)
  })

  it('mic practice row 0.75: 15 Sonnet practices at 15K in and 2K out is about $0.75 a day', () => {
    const practices = row('Mic practices')
    expect(practices).toMatchObject({
      model: MODELS.sonnet,
      callsPerDay: 15,
      inputTokens: 15_000,
      outputTokens: 2000,
    })
    expect(dailyCost(practices)).toBeCloseTo(0.75, 6)
  })

  it('explanations row 0.55: 50 Sonnet calls at 3K in and 500 out is about $0.55 a day', () => {
    const explanations = row('Explanations and scenarios')
    expect(explanations).toMatchObject({
      model: MODELS.sonnet,
      callsPerDay: 50,
      inputTokens: 3000,
      outputTokens: 500,
    })
    expect(dailyCost(explanations)).toBeCloseTo(0.55, 6)
  })

  it('daily total 1.50-2: the three rows come to $1.50-2 a day', () => {
    expect(DAILY_USE_ESTIMATE).toHaveLength(3)
    const total = dailyTotal(DAILY_USE_ESTIMATE)
    expect(total).toBeCloseTo(1.675, 6)
    expect(total).toBeGreaterThanOrEqual(1.5)
    expect(total).toBeLessThanOrEqual(2)
  })

  it('through Sep 5 30-60: Aug 17 through Sep 5 comes to $30-60', () => {
    expect(daysThrough('2026-08-17', '2026-09-05')).toBe(20)
    const total = costThrough(DAILY_USE_ESTIMATE, '2026-08-17', '2026-09-05')
    expect(total).toBeCloseTo(33.5, 6)
    expect(total).toBeGreaterThanOrEqual(30)
    expect(total).toBeLessThanOrEqual(60)
  })

  it('counts calendar days inclusively, none when the range runs backwards', () => {
    expect(daysThrough('2026-08-19', '2026-08-19')).toBe(1)
    expect(daysThrough('2026-09-16', '2026-09-17')).toBe(2)
    expect(daysThrough('2026-09-05', '2026-08-17')).toBe(0)
    expect(costThrough(DAILY_USE_ESTIMATE, '2026-09-05', '2026-08-17')).toBe(0)
    expect(() => daysThrough('Aug 17', '2026-09-05')).toThrow(/YYYY-MM-DD/)
  })
})
