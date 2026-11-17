import { Rating, State } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'

import { dateSchema, gradeSchema, modeRequestSchema, ratingInputSchema, stateSchema } from './types'

describe('contracts', () => {
  it('read dates from Date objects and ISO text, and nothing else', () => {
    const at = new Date('2026-08-17T16:00:00.000Z')
    expect(dateSchema.parse(at)).toBe(at)
    expect(dateSchema.parse('2026-08-17T09:00:00-07:00')).toEqual(at)
    expect(dateSchema.safeParse('Aug 17').success).toBe(false)
    expect(dateSchema.safeParse(new Date('nope')).success).toBe(false)
    expect(dateSchema.safeParse(1_790_000_000_000).success).toBe(false)
  })

  it('accept the four answer ratings, never the Manual bookkeeping rating', () => {
    for (const grade of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]) {
      expect(gradeSchema.parse(grade)).toBe(grade)
    }
    expect(gradeSchema.safeParse(Rating.Manual).success).toBe(false)
    expect(stateSchema.parse(State.Relearning)).toBe(State.Relearning)
    expect(stateSchema.safeParse('Review').success).toBe(false)
  })

  it('need at least one category for focus', () => {
    expect(modeRequestSchema.parse({ mode: 'start' })).toEqual({ mode: 'start' })
    expect(modeRequestSchema.parse({ mode: 'focus', categories: ['Floor work'] })).toEqual({
      mode: 'focus',
      categories: ['Floor work'],
    })
    expect(modeRequestSchema.safeParse({ mode: 'focus', categories: [] }).success).toBe(false)
    expect(modeRequestSchema.safeParse({ mode: 'mic' }).success).toBe(false)
  })

  it('default an answer to free recall', () => {
    const parsed = ratingInputSchema.parse({
      correct: 'right',
      answerMs: 3_000,
      hintUsed: false,
      itemType: 'recall',
    })
    expect(parsed.format).toBe('free')
    expect(parsed.hintImposed).toBe(false)
    expect(
      ratingInputSchema.safeParse({
        correct: 'maybe',
        answerMs: 1,
        hintUsed: false,
        itemType: 'recall',
      }).success,
    ).toBe(false)
  })
})
