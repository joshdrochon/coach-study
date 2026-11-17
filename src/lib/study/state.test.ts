import { eq } from 'drizzle-orm'
import { Rating, State } from 'ts-fsrs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { openTestDb, type Db } from '../db/client'
import { cardStates, itemFlags, reviewEvents } from '../db/schema'
import { createScheduler, defaultScheduler, newCard, type Scheduler } from '../scheduler/fsrs'
import { at, DAY, HOUR, MINUTE, posted, T0 } from '@/test/study-fixtures'

import { loadDeck } from './deck'
import { effectiveTime, parseEvents } from './events'
import { replayItem } from './replay'
import {
  cacheKey,
  effectiveTimeSql,
  loadAllAnswers,
  loadStudyState,
  rebuildCards,
  recordReview,
} from './state'

const deck = loadDeck()
const metas = deck.metas
function metaAt(index: number) {
  const meta = metas[index]
  if (!meta) throw new Error(`no card ${String(index)}`)
  return meta
}
const A = metaAt(0)
const B = metaAt(1)

let db: Db
beforeEach(async () => {
  db = await openTestDb()
})

async function cacheRow(itemId: string) {
  const [row] = await db.select().from(cardStates).where(eq(cardStates.itemId, itemId))
  return row
}

function expectedFsrs(itemId: string, answers: { rating: Rating; at: Date }[]) {
  const meta = deck.metaById.get(itemId)
  if (!meta) throw new Error(itemId)
  let card = newCard(meta, T0)
  for (const answer of answers) {
    if (answer.rating === Rating.Manual) throw new Error('not a grade')
    card = defaultScheduler.review(card, answer.rating, answer.at).card
  }
  return card.fsrs
}

describe('recordReview', () => {
  it('stores an answer once and caches the card’s replayed schedule', async () => {
    const event = posted({ itemId: A.itemId })
    expect(await recordReview(db, deck, event, T0)).toBe('stored')
    expect(await recordReview(db, deck, { ...event, rating: 1 }, at(MINUTE))).toBe('duplicate')
    const rows = await db.select().from(reviewEvents)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: event.eventId,
      itemId: A.itemId,
      rating: 3,
      deviceId: 'unknown',
      format: 'free',
      receivedAt: T0,
    })
    const row = await cacheRow(A.itemId)
    expect(row?.eventCount).toBe(1)
    expect(row?.card).toMatchObject({ key: cacheKey() })
    const state = await loadStudyState(db, deck, at(MINUTE))
    expect(state.cards.find((card) => card.itemId === A.itemId)?.fsrs).toEqual(
      expectedFsrs(A.itemId, [{ rating: Rating.Good, at: T0 }]),
    )
  })

  it('keeps how the card was asked, an imposed hint and which device sent it', async () => {
    const event = posted({
      itemId: A.itemId,
      format: 'choices',
      hintUsed: true,
      hintImposed: true,
      deviceId: 'ipad-tab-2',
      overridden: true,
      changedAt: at(MINUTE).toISOString(),
    })
    await recordReview(db, deck, event, T0)
    const [row] = await db.select().from(reviewEvents)
    expect(row).toMatchObject({
      format: 'choices',
      hintUsed: true,
      hintImposed: true,
      deviceId: 'ipad-tab-2',
      changedAt: at(MINUTE),
    })
    expect(await recordReview(db, deck, posted({ itemId: B.itemId }), T0)).toBe('stored')
    const rows = await db.select().from(reviewEvents)
    expect(rows.find((entry) => entry.itemId === B.itemId)).toMatchObject({
      hintImposed: false,
      format: 'free',
      changedAt: null,
      deviceId: 'unknown',
    })
  })

  it('refuses a card that is not in the bank and stores nothing', async () => {
    expect(await recordReview(db, deck, posted({ itemId: 'not-a-card' }), T0)).toBe('unknown-item')
    expect(await db.select().from(reviewEvents)).toEqual([])
  })

  it('puts an answer that arrives late where it belongs', async () => {
    const early = posted({ itemId: A.itemId, reviewedAt: at(0).toISOString() })
    const later = posted({ itemId: A.itemId, reviewedAt: at(11 * MINUTE).toISOString() })
    await recordReview(db, deck, later, at(11 * MINUTE))
    expect(await recordReview(db, deck, early, at(12 * MINUTE))).toBe('stored')
    const expected = expectedFsrs(A.itemId, [
      { rating: Rating.Good, at: at(0) },
      { rating: Rating.Good, at: at(11 * MINUTE) },
    ])
    expect((await cacheRow(A.itemId))?.card).toMatchObject({
      fsrs: { reps: 2, state: expected.state, due: expected.due.toISOString() },
    })
  })

  it('ends a changed rating as if the learner had picked it', async () => {
    const answer = posted({ itemId: A.itemId })
    await recordReview(db, deck, answer, T0)
    const change = { ...answer, eventId: posted().eventId, rating: 1 as const, overridden: true }
    expect(await recordReview(db, deck, change, at(MINUTE))).toBe('stored')
    const state = await loadStudyState(db, deck, at(2 * MINUTE))
    expect(state.cards.find((card) => card.itemId === A.itemId)?.fsrs).toEqual(
      expectedFsrs(A.itemId, [{ rating: Rating.Again, at: T0 }]),
    )
    expect(state.history).toHaveLength(1)
    expect(state.history[0]).toMatchObject({ proposed: Rating.Good, result: 'wrong' })
    expect(state.answersToday).toBe(1)
  })

  it('still stores the answer when the cache can’t be rebuilt', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const broken: Scheduler = Object.defineProperty({ ...defaultScheduler }, 'parameters', {
      get() {
        throw new Error('cache write failed')
      },
    })
    expect(await recordReview(db, deck, posted({ itemId: A.itemId }), T0, broken)).toBe('stored')
    expect(error).toHaveBeenCalledOnce()
    error.mockRestore()
    expect(await cacheRow(A.itemId)).toBeUndefined()
    const state = await loadStudyState(db, deck, at(MINUTE))
    expect(state.cards.find((card) => card.itemId === A.itemId)?.fsrs.reps).toBe(1)
    expect((await cacheRow(A.itemId))?.eventCount).toBe(1)
  })
})

describe('loadStudyState', () => {
  it('starts with every card new and nothing answered', async () => {
    const state = await loadStudyState(db, deck, T0)
    expect(state.cards).toHaveLength(metas.length)
    expect(state.cards.every((card) => card.fsrs.state === State.New)).toBe(true)
    expect(state.history).toEqual([])
    expect(state.answersToday).toBe(0)
    expect(await db.select().from(cardStates)).toEqual([])
  })

  it('counts today’s answers: study and baseline, not mic-practice misses', async () => {
    await recordReview(db, deck, posted({ itemId: A.itemId }), T0)
    await db.insert(reviewEvents).values([
      {
        id: posted().eventId,
        deviceId: 'ipad',
        itemId: B.itemId,
        mode: 'baseline',
        result: 'wrong',
        rating: 1,
        proposedRating: 1,
        answerMs: 5000,
        gradedBy: 'tutor',
        reviewedAt: at(MINUTE),
        receivedAt: at(MINUTE),
      },
      {
        id: posted().eventId,
        deviceId: 'ipad',
        itemId: metaAt(2).itemId,
        mode: 'mic-practice',
        result: 'wrong',
        rating: 1,
        proposedRating: 1,
        answerMs: 0,
        gradedBy: 'code',
        reviewedAt: at(2 * MINUTE),
        receivedAt: at(2 * MINUTE),
      },
    ])
    const state = await loadStudyState(db, deck, at(3 * MINUTE))
    expect(state.answersToday).toBe(2)

    expect(state.history.map((log) => log.context).toSorted()).toEqual(['mic-practice', 'study'])
    expect(state.cards.find((card) => card.itemId === metaAt(2).itemId)?.fsrs.state).toBe(
      State.Learning,
    )

    expect((await loadStudyState(db, deck, at(DAY))).answersToday).toBe(0)
  })

  it('takes a card out of rotation while a flag is open, and back when it’s resolved', async () => {
    await db.insert(itemFlags).values({ itemId: A.itemId, reason: 'dispute' })
    const flagged = await loadStudyState(db, deck, T0)
    expect(flagged.cards.find((card) => card.itemId === A.itemId)?.quarantined).toBe(true)
    expect(flagged.cards.filter((card) => card.quarantined)).toHaveLength(1)
    await db.update(itemFlags).set({ resolvedAt: T0, resolution: 'restored' })
    const restored = await loadStudyState(db, deck, T0)
    expect(restored.cards.find((card) => card.itemId === A.itemId)?.quarantined).toBe(false)
  })

  it('replays the cards of their last 25 study answers and takes older cards from the cache', async () => {
    const answered = metas.slice(0, 30)
    for (const [index, meta] of answered.entries()) {
      const when = at(-3 * DAY + index * HOUR)
      await recordReview(
        db,
        deck,
        posted({ itemId: meta.itemId, reviewedAt: when.toISOString() }),
        when,
      )
    }

    const oldest = metaAt(0)
    const row = await cacheRow(oldest.itemId)
    const tampered = { key: cacheKey(), fsrs: { ...expectedFsrs(oldest.itemId, []), reps: 42 } }
    await db.update(cardStates).set({ card: tampered }).where(eq(cardStates.itemId, oldest.itemId))
    expect(row?.eventCount).toBe(1)

    const state = await loadStudyState(db, deck, T0)
    expect(state.history).toHaveLength(25)
    expect(new Set(state.history.map((log) => log.itemId))).toEqual(
      new Set(answered.slice(5).map((meta) => meta.itemId)),
    )
    expect(state.cards.find((card) => card.itemId === oldest.itemId)?.fsrs.reps).toBe(42)
    expect(state.answersToday).toBe(0)
  })

  it('rebuilds a card whose cache is missing, stale, corrupt or from another scheduler', async () => {
    const old = at(-3 * DAY)

    const insertMiss = (itemId: string, when: Date = old) =>
      db.insert(reviewEvents).values({
        id: posted().eventId,
        deviceId: 'ipad',
        itemId,
        mode: 'mic-practice',
        result: 'wrong',
        rating: 1,
        proposedRating: 1,
        answerMs: 0,
        gradedBy: 'code',
        reviewedAt: when,
        receivedAt: when,
      })
    const [missing, stale, corrupt, otherScheduler] = [metaAt(3), metaAt(4), metaAt(5), metaAt(6)]
    await insertMiss(missing.itemId)
    for (const meta of [stale, corrupt, otherScheduler]) {
      await insertMiss(meta.itemId)
      await rebuildCards(db, deck, [meta.itemId], old)
    }
    await insertMiss(stale.itemId, at(HOUR, old))
    await db
      .update(cardStates)
      .set({ card: { nonsense: true } })
      .where(eq(cardStates.itemId, corrupt.itemId))
    await rebuildCards(
      db,
      deck,
      [otherScheduler.itemId],
      old,
      createScheduler({ enableFuzz: false }),
    )

    const state = await loadStudyState(db, deck, T0)
    const fsrsOf = (itemId: string) => state.cards.find((card) => card.itemId === itemId)?.fsrs
    const missedOnce = defaultScheduler.missedInPractice(newCard(missing, old), old).card
    const missedTwice = defaultScheduler.missedInPractice(missedOnce, at(HOUR, old)).card
    expect(fsrsOf(missing.itemId)).toEqual(missedOnce.fsrs)
    expect(fsrsOf(stale.itemId)).toEqual(missedTwice.fsrs)
    expect(fsrsOf(corrupt.itemId)).toEqual(missedOnce.fsrs)
    expect(fsrsOf(otherScheduler.itemId)).toEqual(missedOnce.fsrs)
    for (const meta of [missing, stale, corrupt, otherScheduler]) {
      const row = await cacheRow(meta.itemId)
      expect(row?.card).toMatchObject({ key: cacheKey() })
    }
    expect((await cacheRow(stale.itemId))?.eventCount).toBe(2)
  })

  it('never lets a cache built from fewer events replace one built from more', async () => {
    await recordReview(db, deck, posted({ itemId: A.itemId }), T0)
    await db.update(cardStates).set({ eventCount: 5 }).where(eq(cardStates.itemId, A.itemId))
    await rebuildCards(db, deck, [A.itemId], at(MINUTE))
    expect((await cacheRow(A.itemId))?.eventCount).toBe(5)
  })

  it('skips a stored row it can’t read and replays the rest', async () => {
    await recordReview(db, deck, posted({ itemId: A.itemId }), T0)
    await db.insert(reviewEvents).values({
      id: posted().eventId,
      deviceId: 'ipad',
      itemId: A.itemId,
      mode: 'start',
      result: 'right',
      rating: 9,
      proposedRating: 3,
      answerMs: 100,
      gradedBy: 'tutor',
      reviewedAt: at(MINUTE),
      receivedAt: at(MINUTE),
    })
    const state = await loadStudyState(db, deck, at(2 * MINUTE))
    expect(state.cards.find((card) => card.itemId === A.itemId)?.fsrs.reps).toBe(1)
    expect((await cacheRow(A.itemId))?.eventCount).toBe(2)
  })

  it('caches a card none of whose rows can be read, as a new card, and says so once', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const old = at(-3 * DAY)
    await db.insert(reviewEvents).values({
      id: posted().eventId,
      deviceId: 'ipad',
      itemId: B.itemId,
      mode: 'mic-practice',
      result: 'wrong',
      rating: 0,
      proposedRating: 0,
      answerMs: 0,
      gradedBy: 'code',
      reviewedAt: old,
      receivedAt: old,
    })
    const first = await loadStudyState(db, deck, T0)
    expect(first.cards.find((card) => card.itemId === B.itemId)?.fsrs.state).toBe(State.New)
    expect((await cacheRow(B.itemId))?.eventCount).toBe(1)
    await loadStudyState(db, deck, at(MINUTE))
    expect(error).toHaveBeenCalledOnce()
    expect(String(error.mock.calls[0]?.[0])).toContain(B.itemId)
    error.mockRestore()
  })

  it('picks today’s answers in SQL by the same rule as the replay (a fast iPad clock)', async () => {
    const ahead = posted({ itemId: A.itemId, reviewedAt: at(DAY).toISOString() })
    await recordReview(db, deck, ahead, at(-2 * HOUR))
    const [row] = await db
      .select({
        sql: effectiveTimeSql,
        reviewedAt: reviewEvents.reviewedAt,
        receivedAt: reviewEvents.receivedAt,
      })
      .from(reviewEvents)
    if (!row) throw new Error('not stored')
    const fromSql = row.sql instanceof Date ? row.sql : new Date(String(row.sql))
    expect(fromSql).toEqual(effectiveTime(row))
    expect(fromSql).toEqual(at(-2 * HOUR))

    expect((await loadStudyState(db, deck, at(-2 * HOUR))).answersToday).toBe(1)
    expect((await loadStudyState(db, deck, at(DAY))).answersToday).toBe(0)
  })

  it('rebuilds nothing for an empty list or cards outside the bank', async () => {
    expect(await rebuildCards(db, deck, [], T0)).toEqual(new Map())
    expect(await rebuildCards(db, deck, ['not-a-card'], T0)).toEqual(new Map())
  })

  it('leaves out answers to a card that is no longer in the bank', async () => {
    await db.insert(reviewEvents).values({
      id: posted().eventId,
      deviceId: 'ipad',
      itemId: 'retired-card',
      mode: 'start',
      result: 'right',
      rating: 3,
      proposedRating: 3,
      answerMs: 5000,
      gradedBy: 'tutor',
      reviewedAt: T0,
      receivedAt: T0,
    })
    const state = await loadStudyState(db, deck, at(MINUTE))
    expect(state.cards).toHaveLength(metas.length)
    expect(state.history).toEqual([])
    expect(state.answersToday).toBe(0)
    expect(await db.select().from(cardStates)).toEqual([])
  })

  it('replays exactly like the replay module', async () => {
    const answer = posted({ itemId: A.itemId, reviewedAt: at(0).toISOString() })
    await recordReview(db, deck, answer, T0)
    const state = await loadStudyState(db, deck, at(MINUTE))
    const { events } = parseEvents(await db.select().from(reviewEvents))
    expect(events).toHaveLength(1)
    expect(state.cards[0]?.fsrs).toEqual(replayItem(A, events).card.fsrs)
  })
})

describe('loadAllAnswers', () => {
  it('replays every card from all its events, oldest answer first', async () => {
    const old = at(-10 * DAY)
    await recordReview(db, deck, posted({ itemId: A.itemId, reviewedAt: old.toISOString() }), old)
    const today = posted({ itemId: B.itemId, reviewedAt: at(0).toISOString() })
    await recordReview(db, deck, today, T0)
    await recordReview(
      db,
      deck,
      { ...today, eventId: posted().eventId, rating: 1, overridden: true },
      at(MINUTE),
    )
    await db.insert(reviewEvents).values({
      id: posted().eventId,
      deviceId: 'ipad',
      itemId: metaAt(2).itemId,
      mode: 'mic-practice',
      result: 'wrong',
      rating: 1,
      proposedRating: 1,
      answerMs: 0,
      gradedBy: 'code',
      reviewedAt: at(-DAY),
      receivedAt: at(-DAY),
    })
    await db.insert(itemFlags).values({ itemId: metaAt(3).itemId, reason: 'dispute' })

    const all = await loadAllAnswers(db, deck, at(HOUR))
    expect(all.cards).toHaveLength(metas.length)
    expect(all.cards.map((card) => card.itemId)).toEqual(metas.map((meta) => meta.itemId))
    expect(all.answers.map((answer) => [answer.itemId, answer.context, answer.result])).toEqual([
      [A.itemId, 'study', 'right'],
      [metaAt(2).itemId, 'mic-practice', 'wrong'],

      [B.itemId, 'study', 'wrong'],
    ])
    const state = await loadStudyState(db, deck, at(HOUR))
    expect(all.cards).toEqual(state.cards)
    expect(all.cards.find((card) => card.itemId === metaAt(3).itemId)?.quarantined).toBe(true)
  })

  it('says when stored rows can’t be read, and leaves them out', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await db.insert(reviewEvents).values({
      id: posted().eventId,
      deviceId: 'ipad',
      itemId: A.itemId,
      mode: 'start',
      result: 'right',
      rating: 9,
      proposedRating: 3,
      answerMs: 100,
      gradedBy: 'tutor',
      reviewedAt: T0,
      receivedAt: T0,
    })
    const all = await loadAllAnswers(db, deck, at(MINUTE))
    expect(all.answers).toEqual([])
    expect(error).toHaveBeenCalledOnce()
    error.mockRestore()
  })
})
