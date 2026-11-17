import { Rating } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'

import { fixed, graduated, makeCard, T0 } from '@/test/scheduler-fixtures'

import { addDays, addMinutes } from './calendar'
import { masteryCheck, meanRecall, READY_THRESHOLD, readinessByCategory } from './readiness'
import type { SchedulerCard } from './types'

function strengthened(itemId: string, category: string): SchedulerCard {
  let card = graduated(makeCard(itemId, { category }, addDays(T0, -61)), addDays(T0, -60)).card
  while (card.fsrs.due < T0) card = fixed.review(card, Rating.Good, card.fsrs.due).card
  return card
}

describe('readinessByCategory', () => {
  it('reports predicted recall per category, weakest first', () => {
    const started = graduated(
      makeCard('stand-1', { category: 'Standing work' }),
      addDays(T0, -1),
    ).card
    const cards = [
      strengthened('floor-1', 'Floor work'),
      strengthened('floor-2', 'Floor work'),
      started,
      makeCard('stand-2', { category: 'Standing work' }),
      makeCard('term-1', { category: 'Glossary' }),
    ]
    const readiness = readinessByCategory(cards, T0, fixed)
    expect(readiness.map((entry) => entry.category)).toEqual([
      'Glossary',
      'Standing work',
      'Floor work',
    ])

    const [terminology, groupB, core] = readiness
    expect(terminology).toEqual({
      category: 'Glossary',
      items: 1,
      started: 0,
      recall: 0,
      itemsReady: 0,
      ready: false,
    })

    expect(groupB?.items).toBe(2)
    expect(groupB?.started).toBe(1)
    expect(groupB?.recall).toBeCloseTo(fixed.retrievability(started, T0) / 2)
    expect(groupB?.ready).toBe(false)
    expect(core?.recall).toBeGreaterThanOrEqual(READY_THRESHOLD)
    expect(core?.itemsReady).toBe(2)
    expect(core?.ready).toBe(true)
  })

  it('is not ready on cards the learner missed earlier today', () => {
    const missed = fixed.review(
      makeCard('floor-1', { category: 'Floor work' }),
      Rating.Again,
      T0,
    ).card
    const evening = addMinutes(T0, 10 * 60)
    expect(readinessByCategory([missed], evening, fixed)[0]).toMatchObject({
      ready: false,
      itemsReady: 0,
    })
  })

  it('answers "Ready for Aug 19?" by predicting recall on that date', () => {
    const card = graduated(makeCard('floor-1'), T0).card
    const today = readinessByCategory([card], T0, fixed)[0]?.recall ?? 0
    const onPracticeDay =
      readinessByCategory([card], new Date('2026-08-19T16:00:00.000Z'), fixed)[0]?.recall ?? 0
    expect(onPracticeDay).toBeLessThan(today)
  })

  it('leaves out cards pulled from rotation, and orders ties by name', () => {
    const cards = [
      makeCard('b-1', { category: 'B' }),
      makeCard('a-1', { category: 'A' }),
      { ...makeCard('c-1', { category: 'C' }), quarantined: true },
    ]
    expect(readinessByCategory(cards, T0).map((entry) => entry.category)).toEqual(['A', 'B'])
  })
})

describe('masteryCheck', () => {
  it('is mastered only when every card is at 90% or more 30 days out', () => {
    const strong = [strengthened('a', 'Floor work'), strengthened('b', 'Standing work')]
    const report = masteryCheck(strong, T0, fixed)
    expect(report).toMatchObject({
      mastered: true,
      items: 2,
      itemsReady: 2,
      notYet: [],
      quarantined: 0,
    })
    expect(report.checkedAt).toEqual(addDays(T0, 30))

    const weak = graduated(makeCard('c', { category: 'Floor work' }), addDays(T0, -1)).card
    const partial = masteryCheck(
      [
        ...strong,
        weak,
        makeCard('e', { category: 'Floor work' }),
        makeCard('d', { category: 'Standing work' }),
      ],
      T0,
      fixed,
    )
    expect(partial.mastered).toBe(false)
    expect(partial.itemsReady).toBe(2)

    expect(partial.notYet.map((entry) => entry.itemId)).toEqual(['d', 'e', 'c'])
    expect(partial.notYet[0]).toEqual({ itemId: 'd', category: 'Standing work', recall: 0 })
  })

  it('checks 30 days out, not today', () => {
    const recent = graduated(makeCard('recent'), addDays(T0, -1)).card
    expect(fixed.retrievability(recent, T0)).toBeGreaterThanOrEqual(READY_THRESHOLD)
    expect(masteryCheck([recent], T0, fixed).mastered).toBe(false)
  })

  it('waits for cards pulled from rotation, and an empty bank is not mastered', () => {
    const strong = strengthened('a', 'Floor work')
    expect(masteryCheck([strong], T0)).toMatchObject({ mastered: true, reason: null })
    const pulled = { ...makeCard('pulled'), quarantined: true }
    expect(masteryCheck([strong, pulled], T0)).toMatchObject({
      mastered: false,
      reason: '1 card pulled from rotation, waiting for review',
      items: 1,
      itemsReady: 1,
      quarantined: 1,
    })
    expect(masteryCheck([], T0)).toMatchObject({ mastered: false, reason: 'no cards yet' })
  })

  it('says why, in plain words', () => {
    const report = masteryCheck(
      [
        makeCard('a'),
        makeCard('b'),
        { ...makeCard('p1'), quarantined: true },
        { ...makeCard('p2'), quarantined: true },
      ],
      T0,
    )
    expect(report.reason).toBe(
      '2 cards under 90% 30 days out; 2 cards pulled from rotation, waiting for review',
    )
  })
})

describe('meanRecall (Home’s one readiness number)', () => {
  it('is the mean predicted recall over every card, a card not started counting 0', () => {
    const strong = strengthened('a', 'Floor work')
    const cards = [strong, makeCard('b', { category: 'Standing work' })]
    expect(meanRecall(cards, T0, fixed)).toBeCloseTo(fixed.retrievability(strong, T0) / 2, 12)
  })

  it('weighs every card the same, so a big category counts for more than a small one', () => {
    const cards = [
      strengthened('a', 'Floor work'),
      strengthened('b', 'Floor work'),
      strengthened('c', 'Floor work'),
      makeCard('d', { category: 'Standing work' }),
    ]
    const byCategory = readinessByCategory(cards, T0, fixed)
    const meanOfCategories =
      byCategory.reduce((sum, row) => sum + row.recall, 0) / byCategory.length
    expect(meanRecall(cards, T0, fixed)).toBeGreaterThan(meanOfCategories)
  })

  it('leaves out cards pulled from rotation, and is 0 with nothing to count', () => {
    const pulled = { ...strengthened('p', 'Floor work'), quarantined: true }
    const kept = makeCard('k')
    expect(meanRecall([pulled, kept], T0, fixed)).toBe(0)
    expect(meanRecall([pulled], T0, fixed)).toBe(0)
    expect(meanRecall([], T0, fixed)).toBe(0)
  })
})
