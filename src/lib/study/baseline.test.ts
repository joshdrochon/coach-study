import { Rating } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'

import { BASELINE_ITEMS, pickBaselineItems } from '../scheduler/baseline'
import { newCard } from '../scheduler/fsrs'
import type { SchedulerCard } from '../scheduler/types'
import { at, DAY, HOUR, MINUTE, stored, T0 } from '@/test/study-fixtures'

import {
  BASELINE_LABELS,
  baselineAnswerRefs,
  baselineRounds,
  currentRound,
  roundOrder,
  roundSize,
  type BaselineAnswerRef,
} from './baseline'
import { loadDeck } from './deck'

const deck = loadDeck()
const cards: SchedulerCard[] = deck.metas.map((meta) => newCard(meta, T0))
const dayOneOrder = roundOrder(cards, 'day-1')
const dayOne = dayOneOrder.slice(0, BASELINE_ITEMS)

const DAY_TWO = at(DAY)

function answers(itemIds: readonly string[], from: Date, gapMs = MINUTE): BaselineAnswerRef[] {
  return itemIds.map((itemId, index) => ({ itemId, at: new Date(from.getTime() + index * gapMs) }))
}

describe('roundOrder and roundSize', () => {
  it('starts with the scheduler’s 60-card sample for the round, then goes on over the bank', () => {
    expect(roundSize(cards)).toBe(BASELINE_ITEMS)
    expect(dayOne).toEqual(pickBaselineItems(cards, 'day-1').itemIds)
    expect(dayOneOrder).toHaveLength(cards.length)
    expect(new Set(dayOneOrder).size).toBe(cards.length)

    expect(roundOrder(cards, 'before-practice-day').slice(0, 60)).not.toEqual(dayOne)

    const categories = new Set(cards.map((card) => card.category))
    const sampled = new Set(dayOne.map((id) => cards.find((card) => card.itemId === id)?.category))
    expect(sampled).toEqual(categories)
  })

  it('leaves out a card pulled from rotation without reshuffling the others', () => {
    const pulledId = dayOne[3] ?? ''
    const pulled = cards.map((card) =>
      card.itemId === pulledId ? { ...card, quarantined: true } : card,
    )
    expect(roundOrder(pulled, 'day-1')).toEqual(dayOneOrder.filter((id) => id !== pulledId))
    expect(roundSize(pulled)).toBe(BASELINE_ITEMS)
    expect(roundSize(cards.slice(0, 5))).toBe(5)
  })
})

describe('baselineAnswerRefs', () => {
  it('keeps one answer per card and moment, when it counts as given, oldest first', () => {
    const refs = baselineAnswerRefs([
      stored({ itemId: 'b', mode: 'baseline', reviewedAt: at(2 * MINUTE) }),
      stored({ itemId: 'a', mode: 'baseline', reviewedAt: at(MINUTE) }),

      stored({
        itemId: 'a',
        mode: 'baseline',
        reviewedAt: at(MINUTE),
        receivedAt: at(5 * MINUTE),
        rating: Rating.Again,
        overridden: true,
      }),

      stored({ itemId: 'c', mode: 'baseline', reviewedAt: at(DAY), receivedAt: at(3 * MINUTE) }),
      stored({ itemId: 'd', mode: 'start', reviewedAt: at(0) }),
    ])
    expect(refs).toEqual([
      { itemId: 'a', at: at(MINUTE) },
      { itemId: 'b', at: at(2 * MINUTE) },
      { itemId: 'c', at: at(3 * MINUTE) },
    ])
  })

  it('orders answers given at the same moment by card, so every copy agrees', () => {
    const refs = baselineAnswerRefs([
      stored({ itemId: 'z', mode: 'baseline', reviewedAt: at(0) }),
      stored({ itemId: 'y', mode: 'baseline', reviewedAt: at(0) }),
    ])
    expect(refs.map((ref) => ref.itemId)).toEqual(['y', 'z'])
  })
})

describe('baselineRounds', () => {
  it('counts each answer toward the round due when the learner gave it, and closes it at 60 cards', () => {
    const given = answers(dayOne, T0)
    const { runs, rounds } = baselineRounds(cards, given)
    const last = given.at(-1)?.at
    expect(runs).toEqual([{ round: 'day-1', completedAt: last }])
    expect(rounds).toEqual([{ round: 'day-1', answers: given, completedAt: last }])
  })

  it('counts a card once, and leaves out answers given while no round was due', () => {
    const [first] = dayOne
    const given = [
      { itemId: first ?? '', at: T0 },
      { itemId: first ?? '', at: at(MINUTE) },
      ...answers(dayOne.slice(1), at(2 * MINUTE)),

      { itemId: dayOneOrder[100] ?? '', at: at(5 * HOUR) },
    ]
    const { runs, rounds } = baselineRounds(cards, given)
    expect(runs).toHaveLength(1)
    expect(rounds[0]?.answers.map((answer) => answer.itemId)).toEqual(dayOne)
  })

  it('stays done when the bank changes or a flag is lifted later (a count, not a list)', () => {
    const given = answers(dayOne, T0)

    const grown = [
      ...cards,
      ...cards.slice(0, 40).map((card) => ({ ...card, itemId: `${card.itemId}-v2` })),
    ]
    expect(baselineRounds(grown, given).runs).toHaveLength(1)
    const pulled = cards.map((card, index) => (index < 10 ? { ...card, quarantined: true } : card))
    expect(baselineRounds(pulled, given).runs).toHaveLength(1)
  })

  it('counts the next day’s answers toward the repeat before Aug 19', () => {
    const repeat = roundOrder(cards, 'before-practice-day').slice(0, 5)
    const { rounds } = baselineRounds(cards, [...answers(dayOne, T0), ...answers(repeat, DAY_TWO)])
    expect(rounds.map((round) => [round.round, round.answers.length])).toEqual([
      ['day-1', BASELINE_ITEMS],
      ['before-practice-day', 5],
    ])
  })
})

describe('currentRound', () => {
  it('is the day-1 check, all 60 cards, before the learner starts', () => {
    expect(currentRound(cards, [], T0)).toEqual({
      round: 'day-1',
      label: 'Day-1 check',
      answered: 0,
      remaining: BASELINE_ITEMS,
      order: dayOneOrder,
    })
  })

  it('counts down as the learner answers, and is over at 60 cards', () => {
    const some = answers(dayOne.slice(0, 10), T0)
    const halfway = currentRound(cards, some, at(HOUR))
    expect(halfway).toMatchObject({ answered: 10, remaining: 50 })
    expect(halfway?.order[0]).toBe(dayOne[10])
    const all = answers(dayOne, T0)

    expect(currentRound(cards, all, at(2 * HOUR))).toBeNull()
    expect(currentRound(cards, all, DAY_TWO)).toMatchObject({
      round: 'before-practice-day',
      label: BASELINE_LABELS['before-practice-day'],
      answered: 0,
      remaining: BASELINE_ITEMS,
    })
  })

  it('skips a repeat whose window has passed, then offers the next in its own window', () => {
    const all = answers(dayOne, T0)

    expect(currentRound(cards, all, at(2 * DAY))).toBeNull()
    expect(currentRound(cards, all, at(22 * DAY))).toMatchObject({
      round: 'before-first-class',
      label: 'Check before Sep 10',
    })
  })

  it('has nothing to ask without cards', () => {
    expect(currentRound([], [], T0)).toBeNull()
  })
})
