import { randomUUID } from 'node:crypto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { openTestDb, type Db } from '../db/client'
import { itemFlags, reviewEvents } from '../db/schema'
import { at, MINUTE, posted, T0 } from '@/test/study-fixtures'

import { syncResponseSchema } from './contract'
import { buildDeck, loadDeck } from './deck'
import { recordReview } from './state'
import { deckSnapshot, syncView } from './sync'

const deck = loadDeck()
let db: Db

beforeEach(async () => {
  db = await openTestDb()
})

describe('deckSnapshot', () => {
  it('holds every card the learner can study, and a version that follows the content', () => {
    const snapshot = deckSnapshot(deck)
    expect(snapshot.cards.map((card) => card.itemId)).toEqual(deck.metas.map((m) => m.itemId))
    expect(deckSnapshot(deck)).toBe(snapshot)
    expect(snapshot.version).toMatch(/^[0-9a-f]{16}$/)

    const [first, ...rest] = deck.bank.items
    if (!first) throw new Error('empty bank')
    const items = [{ ...first, answer: `${first.answer} (edited)` }, ...rest]
    const edited = buildDeck(
      { ...deck.bank, items, byId: new Map(items.map((item) => [item.id, item])) },
      deck.photos,
    )
    expect(deckSnapshot(edited).version).not.toBe(snapshot.version)
  })
})

describe('syncView', () => {
  it('sends the deck only to an iPad without this version, every answer and the open flags', async () => {
    const first = posted({ itemId: deck.metas[0]?.itemId ?? '', reviewedAt: T0.toISOString() })
    const late = posted({
      itemId: deck.metas[1]?.itemId ?? '',
      reviewedAt: at(-MINUTE).toISOString(),
      format: 'choices',
      hintImposed: true,
    })
    await recordReview(db, deck, first, T0)
    await recordReview(db, deck, late, at(MINUTE))
    await db.insert(itemFlags).values([
      { itemId: 'b-open', reason: 'dispute' },
      { itemId: 'a-open', reason: 'this-looks-wrong' },
      { itemId: 'resolved', reason: 'dispute', resolvedAt: T0, resolution: 'restored' },
    ])

    const fresh = syncResponseSchema.parse(await syncView(db, deck, null))
    expect(fresh.deck).toHaveLength(deck.metas.length)
    expect(fresh.deckVersion).toBe(deckSnapshot(deck).version)
    expect(fresh.quarantined).toEqual(['a-open', 'b-open'])

    expect(fresh.events.map((event) => event.id)).toEqual([first.eventId, late.eventId])
    expect(fresh.events[1]).toMatchObject({
      reviewedAt: at(-MINUTE).toISOString(),
      receivedAt: at(MINUTE).toISOString(),
      format: 'choices',
      hintImposed: true,
      changedAt: null,
    })

    const held = await syncView(db, deck, fresh.deckVersion)
    expect(held.deck).toBeNull()
    expect(held.events).toEqual(fresh.events)
    expect((await syncView(db, deck, 'an-old-version')).deck).toHaveLength(deck.metas.length)
  })

  it('leaves out a stored row the replay can’t read, and says so', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await db.insert(reviewEvents).values({
      id: randomUUID(),
      deviceId: 'ipad',
      itemId: deck.metas[0]?.itemId ?? '',
      mode: 'start',
      result: 'right',
      rating: 9,
      proposedRating: 3,
      answerMs: 10,
      gradedBy: 'tutor',
      reviewedAt: T0,
      receivedAt: T0,
    })
    expect((await syncView(db, deck, null)).events).toEqual([])
    expect(error).toHaveBeenCalledOnce()
    error.mockRestore()
  })
})
