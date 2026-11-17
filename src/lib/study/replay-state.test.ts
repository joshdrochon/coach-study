import { randomUUID } from 'node:crypto'

import { isNull } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { openTestDb, type Db } from '../db/client'
import { itemFlags, reviewEvents } from '../db/schema'
import { seededRandom } from '../scheduler/seeded'
import type { ReviewLog } from '../scheduler/types'
import { at, DAY, HOUR, MINUTE, posted, stored, T0 } from '@/test/study-fixtures'

import type { CardView } from './contract'
import { loadDeck } from './deck'
import type { StoredEvent } from './events'
import { nextView } from './next'
import { homeCounts, pickNext, type NextQuery, type StudyState } from './pick'
import { lastStudyAnswerItems, stateFromEvents } from './replay-state'
import { loadStudyState, recordReview } from './state'
import { storedEvents } from './sync'

const deck = loadDeck()
let db: Db

beforeEach(async () => {
  db = await openTestDb()
})

async function quarantined(): Promise<Set<string>> {
  const rows = await db
    .select({ itemId: itemFlags.itemId })
    .from(itemFlags)
    .where(isNull(itemFlags.resolvedAt))
  return new Set(rows.map((row) => row.itemId))
}

async function localState(now: Date): Promise<StudyState> {
  return stateFromEvents(deck.metas, await storedEvents(db), await quarantined(), now)
}

const byLog = (a: ReviewLog, b: ReviewLog): number =>
  a.itemId.localeCompare(b.itemId) || a.fsrs.review.getTime() - b.fsrs.review.getTime()

function expectSameState(local: StudyState, server: StudyState): void {
  expect(local.cards).toEqual(server.cards)
  expect(local.history.toSorted(byLog)).toEqual(server.history.toSorted(byLog))
  expect(local.answersToday).toBe(server.answersToday)
  expect(local.baselineAnswers).toEqual(server.baselineAnswers)
}

const QUERIES: NextQuery[] = [
  { mode: 'start', categories: [], exclude: [] },
  { mode: 'together', categories: [], exclude: [] },
  { mode: 'focus', categories: ['Floor work', 'Standing work'], exclude: [] },
  { mode: 'baseline', categories: [], exclude: [] },
]

function picks(state: StudyState, now: Date) {
  return QUERIES.map((query) =>
    pickNext(query, state, (queued) => ({ itemId: queued.card.itemId }) as CardView, now),
  )
}

async function expectSameEverywhere(now: Date): Promise<void> {
  const server = await loadStudyState(db, deck, now)
  const local = await localState(now)
  expectSameState(local, server)
  expect(picks(local, now)).toEqual(picks(server, now))
}

async function study(from: Date, count: number, seed: string): Promise<Date> {
  const random = seededRandom(seed)
  let now = from
  for (let turn = 0; turn < count; turn += 1) {
    const state = await loadStudyState(db, deck, now)
    const view = nextView(
      QUERIES[0] ?? { mode: 'start', categories: [], exclude: [] },
      state,
      deck,
      now,
    )
    const card = view?.card
    if (!card) break
    now = at(20_000, now)
    const roll = random()
    const rating = roll < 0.15 ? 1 : roll < 0.35 ? 2 : roll < 0.9 ? 3 : 4
    await recordReview(
      db,
      deck,
      posted({
        itemId: card.itemId,
        rating,
        proposedRating: rating,
        result: rating === 1 ? 'wrong' : 'right',
        reviewedAt: now.toISOString(),
      }),
      at(400, now),
    )
    now = at(5_000, now)
  }
  return now
}

describe('stateFromEvents', () => {
  it('is the database’s state on the same events, through days of study and every kind of answer', async () => {
    let now = await study(T0, 45, 'day-1')
    expect((await storedEvents(db)).length).toBe(45)
    await expectSameEverywhere(now)

    const [first, second, third] = deck.metas
    if (!first || !second || !third) throw new Error('deck too small')
    await db.insert(reviewEvents).values([
      {
        id: randomUUID(),
        deviceId: 'ipad',
        itemId: second.itemId,
        mode: 'baseline',
        result: 'right',
        rating: 3,
        proposedRating: 3,
        answerMs: 5000,
        gradedBy: 'tutor',
        reviewedAt: at(MINUTE, now),
        receivedAt: at(MINUTE, now),
      },
      {
        id: randomUUID(),
        deviceId: 'ipad',
        itemId: third.itemId,
        mode: 'mic-practice',
        result: 'wrong',
        rating: 1,
        proposedRating: 1,
        answerMs: 0,
        gradedBy: 'code',
        reviewedAt: at(2 * MINUTE, now),
        receivedAt: at(2 * MINUTE, now),
      },
    ])
    await db.insert(itemFlags).values({ itemId: first.itemId, reason: 'this-looks-wrong' })
    const answer = posted({ itemId: second.itemId, reviewedAt: at(3 * MINUTE, now).toISOString() })
    await recordReview(db, deck, answer, at(3 * MINUTE, now))
    await recordReview(
      db,
      deck,
      {
        ...answer,
        eventId: randomUUID(),
        rating: 4,
        overridden: true,
        changedAt: at(4 * MINUTE, now).toISOString(),
      },
      at(4 * MINUTE, now),
    )

    await recordReview(
      db,
      deck,
      posted({ itemId: third.itemId, reviewedAt: at(-HOUR, now).toISOString(), rating: 2 }),
      at(5 * MINUTE, now),
    )
    now = at(6 * MINUTE, now)
    await expectSameEverywhere(now)

    now = await study(at(DAY, T0), 30, 'day-2')
    await expectSameEverywhere(now)

    await recordReview(
      db,
      deck,
      posted({ itemId: first.itemId, reviewedAt: at(DAY, now).toISOString() }),
      now,
    )
    await expectSameEverywhere(at(MINUTE, now))
    now = await study(at(3 * DAY, T0), 12, 'day-4')
    await expectSameEverywhere(now)
    await expectSameEverywhere(at(HOUR, now))

    const local = await localState(now)
    const answered = new Set((await storedEvents(db)).map((event) => event.itemId))
    expect(new Set(local.history.map((log) => log.itemId)).size).toBeLessThan(answered.size)
  })

  it('agrees with the database on the baseline check: its next card, its count and Home', async () => {
    let now = T0
    for (let turn = 0; turn < 8; turn += 1) {
      const state = await loadStudyState(db, deck, now)
      const view = nextView({ mode: 'baseline', categories: [], exclude: [] }, state, deck, now)
      const card = view?.card
      if (!card) throw new Error('the check ran out')
      now = at(20_000, now)
      await recordReview(
        db,
        deck,
        posted({
          itemId: card.itemId,
          mode: 'baseline',
          rating: turn % 3 === 0 ? 1 : 3,
          proposedRating: turn % 3 === 0 ? 1 : 3,
          result: turn % 3 === 0 ? 'wrong' : 'right',
          reviewedAt: now.toISOString(),
        }),
        at(400, now),
      )
      now = at(5_000, now)
    }
    await expectSameEverywhere(now)
    const server = await loadStudyState(db, deck, now)
    const local = await localState(now)
    expect(server.baselineAnswers).toHaveLength(8)
    expect(homeCounts(local, now, 'America/Los_Angeles')).toEqual(
      homeCounts(server, now, 'America/Los_Angeles'),
    )
    expect(homeCounts(server, now, 'America/Los_Angeles').baseline).toEqual({
      label: 'Day-1 check',
      cards: 52,
    })
  })

  it('a card with no answers is new, and answers to cards outside the deck are left out', () => {
    const outside = stored({ itemId: 'retired-card', mode: 'start' })
    const state = stateFromEvents(deck.metas, [outside], new Set(), T0)
    expect(state.cards).toHaveLength(deck.metas.length)
    expect(state.history).toEqual([])
    expect(state.answersToday).toBe(0)
  })
})

describe('lastStudyAnswerItems', () => {
  it('counts an answer and its rating change once, newest first, study modes only', () => {
    const events: StoredEvent[] = [
      stored({ itemId: 'a', reviewedAt: at(1 * MINUTE) }),
      stored({ itemId: 'a', reviewedAt: at(1 * MINUTE), overridden: true }),
      stored({ itemId: 'b', reviewedAt: at(2 * MINUTE) }),
      stored({ itemId: 'c', reviewedAt: at(3 * MINUTE), mode: 'baseline' }),
      stored({ itemId: 'd', reviewedAt: at(4 * MINUTE), mode: 'mic-practice' }),
      stored({ itemId: 'e', reviewedAt: at(5 * MINUTE) }),
    ]
    expect([...lastStudyAnswerItems(events, 2)]).toEqual(['e', 'b'])
    expect([...lastStudyAnswerItems(events, 25)]).toEqual(['e', 'b', 'a'])
  })

  it('dates an answer by when it counts as given (a fast clock counts at receipt)', () => {
    const events: StoredEvent[] = [
      stored({ itemId: 'early', reviewedAt: at(DAY), receivedAt: at(MINUTE) }),
      stored({ itemId: 'late', reviewedAt: at(2 * MINUTE) }),
    ]
    expect([...lastStudyAnswerItems(events, 1)]).toEqual(['late'])
  })
})
