import { randomUUID } from 'node:crypto'

import { beforeEach, describe, expect, it } from 'vitest'

import { learningSchema } from '../dashboard/client'
import { openTestDb, type Db } from '../db/client'
import { reviewEvents } from '../db/schema'
import { newCard } from '../scheduler/fsrs'
import { at, DAY, HOUR, MINUTE, T0 } from '@/test/study-fixtures'

import { roundOrder } from './baseline'
import { loadDeck } from './deck'
import { baselineVsNow, learningView, sessions } from './learning'
import { loadAllAnswers } from './state'

const deck = loadDeck()
const metas = deck.metas

let db: Db
beforeEach(async () => {
  db = await openTestDb()
})

async function baseline(itemIds: readonly string[], from: Date, right: (index: number) => boolean) {
  await db.insert(reviewEvents).values(
    itemIds.map((itemId, index) => {
      const when = new Date(from.getTime() + index * MINUTE)
      return {
        id: randomUUID(),
        deviceId: 'ipad',
        itemId,
        mode: 'baseline' as const,
        result: right(index) ? ('right' as const) : ('wrong' as const),
        rating: right(index) ? 3 : 1,
        proposedRating: right(index) ? 3 : 1,
        answerMs: 6000,
        gradedBy: 'tutor' as const,
        reviewedAt: when,
        receivedAt: when,
      }
    }),
  )
}

const cards = metas.map((meta) => newCard(meta, T0))
const dayOne = roundOrder(cards, 'day-1').slice(0, 60)
const beforePracticeDay = roundOrder(cards, 'before-practice-day').slice(0, 60)
const beforeFirstClass = roundOrder(cards, 'before-first-class').slice(0, 60)

describe('learningView', () => {
  it('has nothing measured before the learner studies', async () => {
    const view = await learningView(db, deck, T0)
    expect(learningSchema.parse(view)).toEqual(view)
    expect(view).toMatchObject({
      sessions: [],
      practices: [],
      mostMissed: null,
      baseline: null,
      now: null,
    })
    expect(view.readiness.every((entry) => entry.recall === 0)).toBe(true)
  })
})

describe('baseline vs now', () => {
  it('is the day-1 round, then the latest repeat, each as far as the learner got', async () => {
    await baseline(dayOne, T0, (index) => index % 4 !== 0)
    let all = await loadAllAnswers(db, deck, at(2 * HOUR))
    expect(baselineVsNow(all.cards, all.answers)).toEqual({
      baseline: { label: 'Baseline · Aug 17', pct: 0.75, of: 60 },
      now: null,
    })

    await baseline(beforePracticeDay.slice(0, 3), at(DAY), () => true)
    all = await loadAllAnswers(db, deck, at(DAY + HOUR))
    expect(baselineVsNow(all.cards, all.answers).now).toEqual({ pct: 1, of: 3 })

    await baseline(beforeFirstClass.slice(0, 2), at(22 * DAY), (index) => index === 0)
    all = await loadAllAnswers(db, deck, at(22 * DAY + HOUR))
    expect(baselineVsNow(all.cards, all.answers)).toEqual({
      baseline: { label: 'Baseline · Aug 17', pct: 0.75, of: 60 },
      now: { pct: 0.5, of: 2 },
    })

    expect(sessions(all.answers)).toEqual([])
  })

  it('keeps a day-1 check that runs past midnight as one round', async () => {
    await baseline(dayOne.slice(0, 20), new Date('2026-08-18T06:50:00Z'), () => true)
    const all = await loadAllAnswers(db, deck, at(DAY))
    expect(baselineVsNow(all.cards, all.answers)).toEqual({
      baseline: { label: 'Baseline · Aug 17', pct: 1, of: 20 },
      now: null,
    })
  })

  it('counts any card answered while a round is due (the check asks past its first 60 when one is skipped)', async () => {
    const pastTheFirst60 = roundOrder(cards, 'day-1')[80] ?? ''
    await baseline([pastTheFirst60], T0, () => true)
    const all = await loadAllAnswers(db, deck, at(HOUR))
    expect(baselineVsNow(all.cards, all.answers)).toEqual({
      baseline: { label: 'Baseline · Aug 17', pct: 1, of: 1 },
      now: null,
    })
  })
})
