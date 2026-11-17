import { isNull } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { openTestDb, type Db } from '../db/client'
import { itemFlags } from '../db/schema'
import { newCard } from '../scheduler/fsrs'
import { storeCheckDone } from '@/test/baseline-done'
import { at, DAY, HOUR, MINUTE, posted, T0 } from '@/test/study-fixtures'

import type { NextResponse, SyncEvent } from './contract'
import { deckCards, loadDeck } from './deck'
import { homeView } from './home'
import {
  localEventFor,
  localHome,
  localNext,
  mergeSync,
  reviewBodyFor,
  sendOrder,
  storedEvent,
  type LocalCopy,
  type LocalEvent,
} from './local-copy'
import { nextView } from './next'
import type { NextQuery } from './pick'
import { loadStudyState, recordReview } from './state'
import { storedEvents, syncEvent } from './sync'

const deck = loadDeck()

function event(id: string, overrides: Partial<SyncEvent> = {}): SyncEvent {
  return {
    id,
    itemId: 'term-range',
    mode: 'start',
    result: 'right',
    rating: 3,
    proposedRating: 3,
    overridden: false,
    answerMs: 6000,
    hintUsed: false,
    hintImposed: false,
    gradedBy: 'tutor',
    format: 'free',
    reviewedAt: T0.toISOString(),
    changedAt: null,
    receivedAt: T0.toISOString(),
    ...overrides,
  }
}

function record(id: string, overrides: Partial<LocalEvent> = {}): LocalEvent {
  return { id, event: event(id), body: null, pending: 0, seq: 1, sentAt: 100, ...overrides }
}

describe('localEventFor', () => {
  it('saves their answer as given and waiting, with the replay’s defaults', () => {
    const review = posted({ itemId: 'term-range', reviewedAt: T0.toISOString() })
    const saved = localEventFor(review, 7)
    expect(saved).toEqual({
      id: review.eventId,
      event: {
        id: review.eventId,
        itemId: 'term-range',
        mode: 'start',
        result: 'right',
        rating: 3,
        proposedRating: 3,
        overridden: false,
        answerMs: 6000,
        hintUsed: false,
        hintImposed: false,
        gradedBy: 'tutor',
        format: 'free',
        reviewedAt: T0.toISOString(),
        changedAt: null,

        receivedAt: T0.toISOString(),
      },
      body: review,
      pending: 1,
      seq: 7,
      sentAt: null,
    })
    const changed = localEventFor(
      { ...review, format: 'choices', hintImposed: true, changedAt: at(MINUTE).toISOString() },
      8,
    )
    expect(changed.event).toMatchObject({
      format: 'choices',
      hintImposed: true,
      changedAt: at(MINUTE).toISOString(),
    })
    expect(storedEvent(changed.event)).toMatchObject({
      reviewedAt: T0,
      changedAt: at(MINUTE),
      receivedAt: T0,
    })
  })

  it('orders answers by when they were saved, then by ID', () => {
    const list = [record('b', { seq: 2 }), record('c', { seq: 1 }), record('a', { seq: 2 })]
    expect(list.toSorted(sendOrder).map((r) => r.id)).toEqual(['c', 'a', 'b'])
  })
})

const LOST = {
  confirmed: '00000000-0000-4000-8000-0000000000a1',
  unconfirmed: '00000000-0000-4000-8000-0000000000a2',
  changed: '00000000-0000-4000-8000-0000000000a3',
  practice: '00000000-0000-4000-8000-0000000000a4',
}

describe('mergeSync', () => {
  it('takes the server’s answers and keeps theirs that wait or just arrived', () => {
    const requestedAt = 1_000
    const current = [
      record('on-server', { event: event('on-server', { receivedAt: T0.toISOString() }) }),
      record('waiting', { pending: 1, body: posted(), sentAt: null, seq: 5 }),
      record('sent-after-request', { sentAt: 1_000 }),
      record('delivered-elsewhere', { pending: 1, body: posted(), sentAt: null, seq: 9 }),
    ]
    const server = [
      event('on-server', { receivedAt: at(MINUTE).toISOString() }),
      event('delivered-elsewhere'),
      event('from-other-device'),
    ]
    const put = mergeSync(current, server, requestedAt)
    expect(put).toEqual([
      { ...record('on-server'), event: server[0], body: null, pending: 0, seq: 1, sentAt: 100 },

      {
        id: 'delivered-elsewhere',
        event: server[1],
        body: null,
        pending: 0,
        seq: 9,
        sentAt: requestedAt,
      },
      {
        id: 'from-other-device',
        event: server[2],
        body: null,
        pending: 0,
        seq: 0,
        sentAt: requestedAt,
      },
    ])
  })

  it('never drops an answer the server no longer has: it waits to be sent again (a restore)', () => {
    const requestedAt = 1_000

    const confirmed = record(LOST.confirmed, { sentAt: 999, seq: 3 })

    const sentBody = posted({ eventId: LOST.unconfirmed, answerText: 'a mat' })
    const unconfirmed = {
      ...localEventFor(sentBody, 4),
      pending: 0 as const,
      sentAt: 990,
    }

    const changedAt = at(MINUTE).toISOString()
    const changed = record(LOST.changed, {
      sentAt: 500,
      event: event(LOST.changed, { overridden: true, rating: 4, changedAt }),
    })

    const practice = record(LOST.practice, {
      sentAt: 500,
      event: event(LOST.practice, { mode: 'mic-practice', rating: 1, result: 'wrong' }),
    })
    const put = mergeSync([confirmed, unconfirmed, changed, practice], [], requestedAt)
    expect(put).toEqual([
      {
        ...confirmed,
        pending: 1,
        sentAt: null,

        body: {
          eventId: LOST.confirmed,
          itemId: 'term-range',
          mode: 'start',
          result: 'right',
          rating: 3,
          proposedRating: 3,
          overridden: false,
          answerText: '',
          answerMs: 6000,
          hintUsed: false,
          hintImposed: false,
          gradedBy: 'tutor',
          format: 'free',
          traceId: null,
          reviewedAt: T0.toISOString(),
        },
      },

      { ...unconfirmed, pending: 1, sentAt: null, body: sentBody },
      { ...changed, pending: 1, sentAt: null, body: reviewBodyFor(changed.event) },
    ])
    expect(put[2]?.body).toMatchObject({ eventId: LOST.changed, overridden: true, changedAt })

    expect(put.map((r) => r.id)).not.toContain(LOST.practice)
    expect(reviewBodyFor(practice.event)).toBeNull()
  })
})

describe('the local copy answers as the server would', () => {
  let db: Db
  beforeEach(async () => {
    db = await openTestDb()

    await storeCheckDone(
      db,
      deck.metas.map((meta) => newCard(meta, T0)),
    )
  })

  async function copyOf(): Promise<LocalCopy> {
    const flags = await db
      .select({ itemId: itemFlags.itemId })
      .from(itemFlags)
      .where(isNull(itemFlags.resolvedAt))
    return {
      deck: deckCards(deck),
      events: (await storedEvents(db)).map(syncEvent),
      quarantined: flags.map((flag) => flag.itemId),
    }
  }

  async function serverNext(query: NextQuery, now: Date): Promise<NextResponse | null> {
    return nextView(query, await loadStudyState(db, deck, now), deck, now)
  }

  const start: NextQuery = { mode: 'start', categories: [], exclude: [] }

  async function answer(count: number, rating: 1 | 2 | 3 | 4, from: Date): Promise<Date> {
    let now = from
    for (let turn = 0; turn < count; turn += 1) {
      const card = (await serverNext(start, now))?.card
      if (!card) break
      now = at(15_000, now)
      await recordReview(
        db,
        deck,
        posted({
          itemId: card.itemId,
          rating,
          proposedRating: rating,
          result: rating === 1 ? 'wrong' : 'right',
          format: card.format === 'choices' ? 'choices' : 'free',
          hintImposed: card.hintFirst === true,
          hintUsed: card.hintFirst === true,
          reviewedAt: now.toISOString(),
        }),
        now,
      )
      now = at(4_000, now)
    }
    return now
  }

  it('picks the same card, rendered the same (choices, hint first, due times), in every mode', async () => {
    let now = await answer(6, 3, T0)
    const queries: NextQuery[] = [
      start,
      { mode: 'together', categories: [], exclude: [] },
      { mode: 'focus', categories: ['Glossary'], exclude: [] },
      {
        mode: 'start',
        categories: [],
        exclude: [(await serverNext(start, now))?.card?.itemId ?? ''],
      },
    ]
    for (const query of queries) {
      expect(localNext(await copyOf(), query, now)).toEqual(await serverNext(query, now))
    }

    now = await answer(28, 1, now)
    const struggling = await serverNext(start, now)
    expect(struggling?.card?.hintFirst).toBe(true)
    expect(localNext(await copyOf(), start, now)).toEqual(struggling)
    for (let turn = 0; turn < 6; turn += 1) {
      now = await answer(1, 3, now)
      expect(localNext(await copyOf(), start, now)).toEqual(await serverNext(start, now))
    }

    const pulled = (await serverNext(start, at(DAY, now)))?.card?.itemId
    if (!pulled) throw new Error('nothing due')
    await db.insert(itemFlags).values({ itemId: pulled, reason: 'this-looks-wrong' })
    const nextDay = await serverNext(start, at(DAY, now))
    expect(nextDay?.card?.itemId).not.toBe(pulled)
    expect(localNext(await copyOf(), start, at(DAY, now))).toEqual(nextDay)
  })

  it('turns away a focus the content model can’t serve, and says done when nothing is left', async () => {
    const copy = await copyOf()
    expect(localNext(copy, { mode: 'focus', categories: [], exclude: [] }, T0)).toBeNull()
    const everything = deckCards(deck).map((card) => card.itemId)
    const done = localNext({ ...copy, quarantined: everything }, start, T0)
    expect(done?.card).toBeNull()
  })

  it('counts Home as the server does; the rest comes from the last Home it sent', async () => {
    const now = await answer(9, 2, T0)
    const server = await homeView(db, deck, now, 'America/New_York')
    const last = { ...server, dueToday: 999, daysToPracticeDay: 9, weakestMustDo: 'Band loads' }
    expect(localHome(await copyOf(), last, now, 'America/New_York')).toEqual({
      ...server,
      weakestMustDo: 'Band loads',
    })

    const tomorrow = localHome(await copyOf(), last, at(DAY + HOUR, now), 'America/New_York')
    expect(tomorrow.daysToPracticeDay).toBe(server.daysToPracticeDay - 1)
  })

  it('counts their readiness for Sep 5 as the server does, and keeps the pace line’s start from the last Home', async () => {
    const fifthDay = await answer(8, 3, at(4 * DAY))
    const now = await answer(5, 2, at(DAY, fifthDay))
    const server = await homeView(db, deck, now)
    expect(server.readiness).not.toBeNull()
    expect(server.paceStart).not.toBeNull()
    expect(server.studiedToday).toBe(true)

    const last = { ...server, readiness: null, studiedToday: false, dueToday: 0 }
    expect(localHome(await copyOf(), last, now, 'America/Los_Angeles')).toEqual(server)
  })

  it('leaves out answers to cards its deck doesn’t have, and counts each answer once', async () => {
    const copy = await copyOf()
    const [first, second] = copy.deck
    if (!first || !second) throw new Error('deck too small')
    const answered = event('00000000-0000-4000-8000-0000000000aa', { itemId: first.itemId })
    const narrow = {
      ...copy,
      deck: [second],
      events: [answered, answered, event('x', { itemId: 'retired-card' })],
    }
    expect(localNext(narrow, start, T0)?.card?.itemId).toBe(second.itemId)
  })
})
