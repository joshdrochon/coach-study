import { beforeEach, describe, expect, it } from 'vitest'

import { formatShortDate } from '../dashboard/format'
import { openTestDb, type Db } from '../db/client'
import { progressSchema } from '../progress/client'
import { nextEvaluation } from '../progress/milestones'
import { addDays } from '../scheduler/calendar'
import { readinessByCategory } from '../scheduler/readiness'
import { insertPractice } from '@/test/practice-rows'
import { at, MINUTE, posted, T0 } from '@/test/study-fixtures'

import { loadDeck } from './deck'
import { progressView, readinessMoment } from './progress'
import { loadAllAnswers, recordReview } from './state'

const deck = loadDeck()
const categories = [...new Set(deck.metas.map((meta) => meta.category))]

let db: Db
beforeEach(async () => {
  db = await openTestDb()
})

describe('readinessMoment', () => {
  it('is the end of Aug 19 in Pacific time until that day is over', () => {
    const endOfPracticeDay = new Date('2026-08-20T06:59:59.999Z')
    expect(readinessMoment(T0)).toEqual(endOfPracticeDay)
    expect(readinessMoment(new Date('2026-08-20T04:00:00Z'))).toEqual(endOfPracticeDay)
  })

  it('is then the end of Sep 10, and 30 days out after that', () => {
    expect(readinessMoment(new Date('2026-08-20T07:30:00Z'))).toEqual(
      new Date('2026-09-11T06:59:59.999Z'),
    )
    const later = new Date('2026-09-11T16:00:00Z')
    expect(readinessMoment(later)).toEqual(addDays(later, 30))
  })

  it('names the same day as the Progress and Learning headings', () => {
    for (let hours = 0; hours < 24 * 25; hours += 7) {
      const now = new Date(T0.getTime() + hours * 3_600_000)
      const day = nextEvaluation(now)
      if (day === null) expect(readinessMoment(now)).toEqual(addDays(now, 30))
      else expect(formatShortDate(readinessMoment(now))).toBe(day)
    }
  })
})

describe('progressView', () => {
  it('is day one before the learner has answered anything', async () => {
    const view = await progressView(db, deck, T0)
    expect(progressSchema.parse(view)).toEqual(view)
    expect(view).toEqual({
      name: 'Coach Alex',
      title: 'Starter',
      avatarUrl: '/api/avatar?v=default',
      practiceSessions: { done: 0, of: 3 },
      practiceClasses: { done: 0, of: 10 },
      readiness: expect.arrayContaining(
        categories.map((category) => ({ category, ready: 0 })),
      ) as unknown,
      isDayOne: true,
      practices: [],
    })
    expect(view.readiness).toHaveLength(categories.length)
  })

  it('shows predicted recall per category over every card, for the next evaluation', async () => {
    const core = deck.metas.filter((meta) => meta.category === 'Floor work').slice(0, 3)
    for (const [index, meta] of core.entries()) {
      const when = at(index * MINUTE)
      await recordReview(
        db,
        deck,
        posted({ itemId: meta.itemId, reviewedAt: when.toISOString() }),
        when,
      )
    }
    const now = at(10 * MINUTE)
    const view = await progressView(db, deck, now)
    expect(view.isDayOne).toBe(false)
    const all = await loadAllAnswers(db, deck, now)
    const expected = readinessByCategory(all.cards, readinessMoment(now)).map(
      ({ category, recall }) => ({ category, ready: recall }),
    )
    expect(view.readiness).toEqual(expected)
    const coreReadiness =
      view.readiness.find((entry) => entry.category === 'Floor work')?.ready ?? 0
    expect(coreReadiness).toBeGreaterThan(0)

    expect(view.readiness.at(-1)?.category).toBe('Floor work')
  })

  it('leaves day one with any answer or practice, graded or not', async () => {
    await insertPractice(db, { doneAt: T0 })
    const view = await progressView(db, deck, T0)
    expect(view).toMatchObject({ isDayOne: false, practices: [] })
  })
})
