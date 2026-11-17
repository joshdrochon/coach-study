import { describe, expect, it } from 'vitest'

import { posted, T0 } from '@/test/study-fixtures'

import type { DeckCard, SyncResponse } from './contract'
import { localEventFor } from './local-copy'
import { memoryLocalStore } from './local-store'

const CARD: DeckCard = {
  itemId: 'term-range',
  category: 'Floor work',
  type: 'recall',
  prompt: 'Sample move a: which parts carry it?',
  answer: 'A mat first.',
  explanation: 'From the manual.',
  citation: { label: 'Sample guide', quote: 'A mat first' },
  position: 0,
}

function sync(overrides: Partial<SyncResponse> = {}): SyncResponse {
  return { deckVersion: 'v1', deck: [CARD], events: [], quarantined: [], epoch: 0, ...overrides }
}

describe('memoryLocalStore', () => {
  it('saves an answer once, waiting, in the order it was saved', async () => {
    const store = memoryLocalStore()
    const first = localEventFor(posted({ itemId: 'a' }), 2)
    const second = localEventFor(posted({ itemId: 'b' }), 1)
    await store.add(first)
    await store.add(second)
    await store.add({ ...first, seq: 99 })
    expect((await store.pending()).map((e) => e.id)).toEqual([second.id, first.id])
    expect(await store.status()).toEqual({ deckVersion: null, pending: 2 })
  })

  it('a sent answer stops waiting and keeps its body until a sync lists it; a refused one leaves the copy', async () => {
    const store = memoryLocalStore()
    const sent = localEventFor(posted(), 1)
    const refused = localEventFor(posted(), 2)
    await store.add(sent)
    await store.add(refused)
    await store.markSent(sent.id, 500)
    await store.markSent('unknown', 500)
    await store.drop(refused.id)
    expect(await store.pending()).toEqual([])
    expect((await store.read()).events).toEqual([{ ...sent, pending: 0, sentAt: 500 }])
    await store.replace(sync({ events: [sent.event] }), 600)
    expect((await store.read()).events).toEqual([{ ...sent, pending: 0, body: null, sentAt: 500 }])
  })

  it('a sync that no longer lists answers the server had (a restore) hands them back to send', async () => {
    const store = memoryLocalStore()
    const sent = localEventFor(posted(), 1)
    await store.add(sent)
    await store.markSent(sent.id, 500)
    await store.replace(sync({ events: [] }), 600)
    expect(await store.pending()).toEqual([{ ...sent, pending: 1, sentAt: null }])
    expect(await store.status()).toEqual({ deckVersion: 'v1', pending: 1 })
  })

  it('a sync brings the deck and the server’s answers, and keeps the deck when none is sent', async () => {
    const store = memoryLocalStore()
    const mine = localEventFor(posted({ reviewedAt: T0.toISOString() }), 1)
    await store.add(mine)
    await store.replace(sync({ quarantined: ['x'] }), 1_000)
    expect(await store.status()).toEqual({ deckVersion: 'v1', pending: 1 })
    expect((await store.read()).deck).toEqual({ version: 'v1', cards: [CARD] })
    await store.replace(sync({ deck: null, events: [mine.event], quarantined: [] }), 2_000)
    const copy = await store.read()
    expect(copy.deck?.version).toBe('v1')
    expect(copy.events).toEqual([{ ...mine, body: null, pending: 0, sentAt: 2_000 }])
    expect(copy.quarantined).toEqual([])
  })

  it('pulls a card the learner flagged here out of rotation until the next sync says otherwise', async () => {
    const store = memoryLocalStore()
    await store.quarantine('term-range')
    await store.quarantine('term-range')
    expect((await store.read()).quarantined).toEqual(['term-range'])
    await store.replace(sync({ quarantined: ['term-range', 'other'] }), 1)
    expect((await store.read()).quarantined).toEqual(['term-range', 'other'])
  })

  it('a reset clears every answer saved before it and the pulled cards, keeps the deck and later answers', async () => {
    const store = memoryLocalStore()
    const old = localEventFor(posted(), 100)
    const oldSent = localEventFor(posted(), 200)
    const later = localEventFor(posted(), 900)
    await store.replace(sync({ quarantined: ['x'] }), 50)
    await store.add(old)
    await store.add(oldSent)
    await store.add(later)
    await store.markSent(oldSent.id, 300)
    await store.clear(500)
    const copy = await store.read()
    expect(copy.events.map((event) => event.id)).toEqual([later.id])
    expect(copy.quarantined).toEqual([])
    expect(copy.deck?.version).toBe('v1')
    expect(await store.status()).toEqual({ deckVersion: 'v1', pending: 1 })
  })
})
