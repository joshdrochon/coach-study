import { Rating } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'

import { addDays } from '../scheduler/calendar'
import { isNew } from '../scheduler/fsrs'
import { meanRecall } from '../scheduler/readiness'
import { dueReview, fixed, graduated, makeCard, T0 } from '@/test/scheduler-fixtures'

import {
  PACE_DAYS,
  PACE_FAR,
  PACE_GOAL,
  PACE_TOLERANCE,
  paceDay,
  paceStanding,
  paceTarget,
  readinessAfterToday,
} from './pace'

describe('the pace line', () => {
  it('runs from Aug 21 to Sep 10, 20 days, to 90%', () => {
    expect(PACE_DAYS).toBe(20)
    expect(PACE_GOAL).toBe(0.9)
    expect(PACE_TOLERANCE).toBe(0.03)
    expect(PACE_FAR).toBe(0.1)
  })

  it('numbers the days from the days left to Sep 10', () => {
    expect(paceDay(20)).toBe(0)
    expect(paceDay(19)).toBe(1)
    expect(paceDay(0)).toBe(20)

    expect(paceDay(30)).toBe(0)
    expect(paceDay(-3)).toBe(20)
  })

  it('rises evenly from where the learner started to 90%', () => {
    expect(paceTarget(0.5, 0)).toBe(0.5)
    expect(paceTarget(0.5, 10)).toBeCloseTo(0.7, 12)
    expect(paceTarget(0.5, 20)).toBeCloseTo(0.9, 12)
    expect(paceTarget(0, 5)).toBeCloseTo(0.225, 12)
    expect(paceTarget(0.5, 25)).toBeCloseTo(0.9, 12)
    expect(paceTarget(0.5, -2)).toBe(0.5)
  })

  it('never asks for less than 90% once the learner is there', () => {
    expect(paceTarget(0.9, 0)).toBe(0.9)
    expect(paceTarget(0.95, 10)).toBe(0.9)
  })
})

const base = { start: 0.5, daysToFirstClass: 10 }

describe('where the learner stands against the line', () => {
  it('is on pace within 3 points of the line, either side, and the edge is on pace', () => {
    expect(paceStanding({ ...base, now: 0.7, afterToday: 0.73 }).pace).toBe('on')
    expect(paceStanding({ ...base, now: 0.73, afterToday: 0.75 }).pace).toBe('on')
    expect(paceStanding({ ...base, now: 0.67, afterToday: 0.72 }).pace).toBe('on')
  })

  it('is ahead past 3 points above and behind past 3 points below', () => {
    expect(paceStanding({ ...base, now: 0.7301, afterToday: 0.76 }).pace).toBe('ahead')
    expect(paceStanding({ ...base, now: 0.8, afterToday: 0.82 }).pace).toBe('ahead')
    expect(paceStanding({ ...base, now: 0.6699, afterToday: 0.72 }).pace).toBe('behind')
    expect(paceStanding({ ...base, now: 0.48, afterToday: 0.6 }).pace).toBe('behind')
  })

  it('is "a bit behind" up to 10 points under and "behind" past that', () => {
    expect(paceStanding({ ...base, now: 0.6, afterToday: 0.7 }).far).toBe(false)
    expect(paceStanding({ ...base, now: 0.5999, afterToday: 0.7 }).far).toBe(true)
    expect(paceStanding({ ...base, now: 0.7, afterToday: 0.73 }).far).toBe(false)
  })

  it('moves the line with the day: the same readiness is on pace early and behind late', () => {
    expect(
      paceStanding({ start: 0.5, now: 0.55, afterToday: 0.6, daysToFirstClass: 20 }).pace,
    ).toBe('ahead')
    expect(
      paceStanding({ start: 0.5, now: 0.55, afterToday: 0.6, daysToFirstClass: 15 }).pace,
    ).toBe('behind')

    expect(
      paceStanding({ start: 0.5, now: 0.86, afterToday: 0.88, daysToFirstClass: 0 }).pace,
    ).toBe('behind')
    expect(paceStanding({ start: 0.5, now: 0.88, afterToday: 0.9, daysToFirstClass: 0 }).pace).toBe(
      'on',
    )
  })

  it('on pace: today keeps them on pace only if the math says so', () => {
    expect(paceStanding({ ...base, now: 0.7, afterToday: 0.69 }).effect).toBe('keeps')
    expect(paceStanding({ ...base, now: 0.7, afterToday: 0.6899 }).effect).toBe('none')
    expect(paceStanding({ ...base, now: 0.7, afterToday: 0.74 }).effect).toBe('keeps')
  })

  it('ahead: today keeps them ahead only if the learner finishes ahead of tonight’s line', () => {
    expect(paceStanding({ ...base, now: 0.78, afterToday: 0.76 }).effect).toBe('keeps')
    expect(paceStanding({ ...base, now: 0.78, afterToday: 0.75 }).effect).toBe('none')
    expect(paceStanding({ ...base, now: 0.78, afterToday: 0.7 }).effect).toBe('none')
  })

  it('behind: "catches up" only if today puts them back on pace, else "closer" only if it moves them up', () => {
    expect(paceStanding({ ...base, now: 0.6, afterToday: 0.69 }).effect).toBe('catches-up')
    expect(paceStanding({ ...base, now: 0.6, afterToday: 0.6899 }).effect).toBe('closer')
    expect(paceStanding({ ...base, now: 0.6, afterToday: 0.61 }).effect).toBe('closer')
    expect(paceStanding({ ...base, now: 0.6, afterToday: 0.6 }).effect).toBe('none')
    expect(paceStanding({ ...base, now: 0.6, afterToday: 0.55 }).effect).toBe('none')
  })

  it('starting at 0 puts the line at 0 on Aug 21 and a little each day', () => {
    expect(paceStanding({ start: 0, now: 0, afterToday: 0.04, daysToFirstClass: 20 }).pace).toBe(
      'on',
    )
    expect(paceStanding({ start: 0, now: 0.1, afterToday: 0.14, daysToFirstClass: 19 }).pace).toBe(
      'ahead',
    )
  })
})

describe('readiness after today’s cards', () => {
  const now = T0
  const at = addDays(T0, 15)

  it('is today’s readiness when nothing is left to answer', () => {
    const notDue = graduated(makeCard('a', {}, addDays(T0, -1)), addDays(T0, -1)).card
    const cards = [notDue, makeCard('b')]
    expect(readinessAfterToday(cards, 0, now, at, fixed)).toBeCloseTo(
      meanRecall(cards, at, fixed),
      12,
    )
  })

  it('goes up when a due review is answered right, and leaves cards that aren’t due alone', () => {
    const notDue = graduated(makeCard('b', {}, addDays(T0, -1)), addDays(T0, -1)).card
    expect(notDue.fsrs.due.getTime()).toBeGreaterThan(now.getTime())
    const due = dueReview('a')
    const before = meanRecall([due, notDue], at, fixed)
    const after = readinessAfterToday([due, notDue], 0, now, at, fixed)
    expect(after).toBeGreaterThan(before)

    const answered = fixed.review(due, Rating.Good, now).card
    expect(after).toBeCloseTo(meanRecall([answered, notDue], at, fixed), 12)
  })

  it('takes a new card through its learning steps, in bank order, only as many as the plan allows', () => {
    const x = makeCard('x', { position: 3 })
    const y = makeCard('y', { position: 1 })
    const cards = [x, y, makeCard('z', { position: 2 })]
    const one = readinessAfterToday(cards, 1, now, at, fixed)
    const two = readinessAfterToday(cards, 2, now, at, fixed)
    expect(one).toBeGreaterThan(0)
    expect(two).toBeGreaterThan(one)

    const learned = readinessAfterToday([y], 1, now, at, fixed)
    expect(one).toBeCloseTo(learned / 3, 12)
    expect(isNew(x)).toBe(true)
  })

  it('leaves out cards pulled from rotation', () => {
    const pulled = { ...dueReview('p'), quarantined: true }
    const cards = [dueReview('a'), pulled]
    const after = readinessAfterToday(cards, 0, now, at, fixed)
    const answered = fixed.review(dueReview('a'), Rating.Good, now).card
    expect(after).toBeCloseTo(meanRecall([answered, pulled], at, fixed), 12)
  })
})
