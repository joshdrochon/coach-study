import { Rating, State } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'

import { fixed, graduated, makeCard, T0, TYPES } from '@/test/scheduler-fixtures'

import {
  BASELINE_INCLUDES_MIC_PRACTICE,
  BASELINE_ITEMS,
  BASELINE_REPEAT_WINDOW_DAYS,
  BASELINE_REPEATS,
  baselineAnswerSchema,
  baselineDue,
  baselineRunSchema,
  pickBaselineItems,
  placeFromBaseline,
  type BaselineRun,
} from './baseline'
import { addDays } from './calendar'
import type { RatingInput, SchedulerCard } from './types'

function bank(sizes: Record<string, number>): SchedulerCard[] {
  return Object.entries(sizes).flatMap(([category, size]) =>
    Array.from({ length: size }, (_, i) =>
      makeCard(`${category}-${String(i)}`, { category, itemType: TYPES[i % TYPES.length] }),
    ),
  )
}

const countBy = <T>(values: readonly T[]): Map<T, number> => {
  const counts = new Map<T, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return counts
}

describe('pickBaselineItems', () => {
  it('picks 60 cards, spread evenly across categories and formats', () => {
    expect(BASELINE_ITEMS).toBe(60)
    expect(BASELINE_INCLUDES_MIC_PRACTICE).toBe(true)
    const cards = bank({
      'Floor work': 20,
      'Standing work': 20,
      Glossary: 20,
      'Coaching voice': 20,
      A: 20,
      B: 20,
    })
    const plan = pickBaselineItems(cards, 'day-1')
    expect(plan.includesMicPractice).toBe(true)
    expect(plan.itemIds).toHaveLength(60)
    expect(new Set(plan.itemIds).size).toBe(60)
    const byId = new Map(cards.map((card) => [card.itemId, card]))
    const picked = plan.itemIds.flatMap((id) => {
      const card = byId.get(id)
      return card ? [card] : []
    })
    expect([...countBy(picked.map((card) => card.category)).values()]).toEqual([
      10, 10, 10, 10, 10, 10,
    ])
    for (const category of countBy(picked.map((card) => card.category)).keys()) {
      const types = picked.filter((card) => card.category === category).map((card) => card.itemType)
      expect(new Set(types).size).toBe(TYPES.length)
    }

    plan.itemIds.slice(1).forEach((id, i) => {
      expect(byId.get(id)?.category).not.toBe(byId.get(plan.itemIds[i] ?? '')?.category)
    })
  })

  it('is repeatable for a seed, whatever the input order, and samples afresh for a new seed', () => {
    const cards = bank({ 'Floor work': 30, 'Standing work': 30, Glossary: 30 })
    const first = pickBaselineItems(cards, 'day-1')
    expect(pickBaselineItems(cards.toReversed(), 'day-1')).toEqual(first)
    const repeat = pickBaselineItems(cards, 'before-practice-day')
    expect(repeat.itemIds).not.toEqual(first.itemIds)
  })

  it('leaves out cards pulled from rotation, and returns them all when the bank is small', () => {
    const cards = [
      ...bank({ 'Floor work': 5 }),
      { ...makeCard('pulled', { category: 'Floor work' }), quarantined: true },
    ]
    const plan = pickBaselineItems(cards, 'day-1')
    expect(plan.itemIds.toSorted()).toEqual([
      'Floor work-0',
      'Floor work-1',
      'Floor work-2',
      'Floor work-3',
      'Floor work-4',
    ])
    expect(pickBaselineItems(cards, 'day-1', 2).itemIds).toHaveLength(2)
    expect(pickBaselineItems([], 'day-1').itemIds).toEqual([])
  })
})

describe('placeFromBaseline', () => {
  const answer = (overrides: Partial<RatingInput> = {}): RatingInput => ({
    correct: 'right',
    answerMs: 5_000,
    hintUsed: false,
    itemType: 'recall',
    ...overrides,
  })

  it('starts a new card the learner already knows at Easy, past the learning steps', () => {
    for (const answerMs of [2_000, 5_000]) {
      const placed = placeFromBaseline(makeCard('known'), answer({ answerMs }), T0, 'day-1', fixed)
      expect(placed.placed).toBe(true)
      expect(placed.card.fsrs.state).toBe(State.Review)
      expect(placed.card.fsrs.scheduled_days).toBe(8)
      expect(placed.log).toMatchObject({
        context: 'baseline',
        proposed: null,
        result: 'right',
        helped: false,
      })
      expect(placed.log?.fsrs.rating).toBe(Rating.Easy)
    }
  })

  it('gives known material a longer interval than learning it from scratch', () => {
    const placed = placeFromBaseline(makeCard('known'), answer(), T0, 'day-1', fixed).card
    const learned = graduated(makeCard('learned'), T0).card
    expect(placed.fsrs.due.getTime()).toBeGreaterThan(learned.fsrs.due.getTime())
  })

  it('leaves a new card new when the learner misses it, half-knows it, needs a hint or is slow', () => {
    const cases: Partial<RatingInput>[] = [
      { correct: 'wrong' },
      { correct: 'partial' },
      { hintUsed: true },
      { answerMs: 20_000 },
      { format: 'choices' },
    ]
    for (const overrides of cases) {
      const card = makeCard('unknown')
      const result = placeFromBaseline(card, answer(overrides), T0, 'day-1', fixed)
      expect(result).toMatchObject({ card, log: null, placed: false })
    }
  })

  it('returns the record to store for every answer, placed or not', () => {
    const card = makeCard('unknown', { category: 'Standing work' })
    const missed = placeFromBaseline(
      card,
      answer({ correct: 'wrong', answerMs: 9_000 }),
      T0,
      'day-1',
    )
    expect(missed.answer).toEqual({
      round: 'day-1',
      itemId: 'unknown',
      category: 'Standing work',
      context: 'baseline',
      result: 'wrong',
      helped: false,
      answerMs: 9_000,
      at: T0,
    })
    expect(baselineAnswerSchema.parse(JSON.parse(JSON.stringify(missed.answer)))).toEqual(
      missed.answer,
    )
    const hinted = placeFromBaseline(card, answer({ hintUsed: true }), T0, 'before-practice-day')
    expect(hinted.answer).toMatchObject({ round: 'before-practice-day', helped: true })

    const imposed = placeFromBaseline(
      card,
      answer({ hintUsed: true, hintImposed: true }),
      T0,
      'day-1',
    )
    expect(imposed).toMatchObject({ placed: false, log: null, answer: { helped: true } })
    const placed = placeFromBaseline(card, answer(), T0, 'day-1', fixed)
    expect(placed.answer).toMatchObject({ result: 'right', helped: false })
  })

  it('reviews a card the learner has already started as usual, outside the study window', () => {
    const started = graduated(makeCard('started'), addDays(T0, -3)).card
    const right = placeFromBaseline(started, answer(), T0, 'before-practice-day', fixed)
    expect(right.placed).toBe(false)
    expect(right.log).toMatchObject({
      context: 'baseline',
      proposed: Rating.Good,
      result: 'right',
      helped: false,
    })
    expect(right.card).toEqual(fixed.review(started, Rating.Good, T0).card)

    const wrong = placeFromBaseline(
      started,
      answer({ correct: 'wrong' }),
      T0,
      'before-practice-day',
    )
    expect(wrong.card.fsrs.state).toBe(State.Relearning)
  })
})

describe('baselineDue', () => {
  const at = (day: string, time = '16:00:00'): Date => new Date(`${day}T${time}.000Z`)
  const run = (round: BaselineRun['round'], day: string): BaselineRun => ({
    round,
    completedAt: at(day),
  })

  it('uses the dates on the clock', () => {
    expect(BASELINE_REPEATS).toEqual([
      { round: 'before-practice-day', before: '2026-08-19' },
      { round: 'before-first-class', before: '2026-09-10' },
    ])
    expect(BASELINE_REPEAT_WINDOW_DAYS).toBe(2)
  })

  it('is due on day 1, whatever the date', () => {
    expect(baselineDue([], at('2026-08-17'))).toEqual({ due: true, round: 'day-1' })
    expect(baselineDue([], at('2026-08-31'))).toEqual({ due: true, round: 'day-1' })
  })

  it('repeats on Aug 18 when day 1 was Aug 17, then before Sep 10', () => {
    const dayOne = [run('day-1', '2026-08-17')]
    expect(baselineDue(dayOne, at('2026-08-17', '23:00:00'))).toEqual({
      due: false,
      next: { round: 'before-practice-day', opensOn: '2026-08-18' },
    })
    expect(baselineDue(dayOne, at('2026-08-18'))).toEqual({
      due: true,
      round: 'before-practice-day',
    })

    const both = [...dayOne, run('before-practice-day', '2026-08-18')]
    expect(baselineDue(both, at('2026-08-18'))).toEqual({
      due: false,
      next: { round: 'before-first-class', opensOn: '2026-09-08' },
    })
    expect(baselineDue(both, at('2026-08-26'))).toMatchObject({ due: false })
    expect(baselineDue(both, at('2026-09-08'))).toEqual({
      due: true,
      round: 'before-first-class',
    })
    expect(baselineDue(both, at('2026-09-09'))).toEqual({
      due: true,
      round: 'before-first-class',
    })

    const all = [...both, run('before-first-class', '2026-09-09')]
    expect(baselineDue(all, at('2026-09-09'))).toEqual({ due: false, next: null })
    expect(baselineDue(all, at('2026-09-22'))).toEqual({ due: false, next: null })
  })

  it('skips a repeat whose window has passed', () => {
    const dayOne = [run('day-1', '2026-08-17')]
    expect(baselineDue(dayOne, at('2026-08-19'))).toEqual({
      due: false,
      next: { round: 'before-first-class', opensOn: '2026-09-08' },
    })
    expect(baselineDue(dayOne, at('2026-09-10'))).toEqual({ due: false, next: null })
  })

  it('never runs two on one day: a day 1 on Aug 18 counts for Aug 19', () => {
    const late = [run('day-1', '2026-08-18')]
    expect(baselineDue(late, at('2026-08-18', '20:00:00'))).toEqual({
      due: false,
      next: { round: 'before-first-class', opensOn: '2026-09-08' },
    })
  })

  it('counts days in their time zone', () => {
    const dayOne = [run('day-1', '2026-08-17')]

    const lateEvening = new Date('2026-08-18T05:00:00.000Z')
    expect(baselineDue(dayOne, lateEvening)).toMatchObject({ due: false })
    expect(baselineDue(dayOne, lateEvening, 'UTC')).toEqual({
      due: true,
      round: 'before-practice-day',
    })
  })

  it('reads stored runs, with dates as text', () => {
    expect(
      baselineRunSchema.parse({ round: 'day-1', completedAt: '2026-08-17T16:00:00.000Z' }),
    ).toEqual(run('day-1', '2026-08-17'))
    expect(baselineRunSchema.safeParse({ round: 'day-2', completedAt: T0 }).success).toBe(false)
  })
})
