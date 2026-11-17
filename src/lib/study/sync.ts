import 'server-only'

// What a device downloads to study offline: the deck and the events it doesn't have.

import { createHash } from 'node:crypto'

import { asc, isNull } from 'drizzle-orm'

import type { Db } from '../db/client'
import { itemFlags, reviewEvents } from '../db/schema'

import type { DeckCard, SyncEvent, SyncResponse } from './contract'
import { deckCards, type Deck } from './deck'
import { readEpoch } from './epoch-server'
import { parseEvents, type StoredEvent } from './events'
import { eventColumns } from './state'

export type DeckSnapshot = { version: string; cards: DeckCard[] }

const snapshots = new WeakMap<Deck, DeckSnapshot>()

export function deckSnapshot(deck: Deck): DeckSnapshot {
  const known = snapshots.get(deck)
  if (known) return known
  const cards = deckCards(deck)
  const version = createHash('sha256').update(JSON.stringify(cards)).digest('hex').slice(0, 16)
  const snapshot = { version, cards }
  snapshots.set(deck, snapshot)
  return snapshot
}

export async function storedEvents(db: Db): Promise<StoredEvent[]> {
  const rows = await db
    .select(eventColumns)
    .from(reviewEvents)
    .orderBy(asc(reviewEvents.receivedAt), asc(reviewEvents.id))
  const { events, invalid } = parseEvents(rows)
  if (invalid > 0) {
    console.error(`sync: ${String(invalid)} stored answers can't be read; left out of the copy`)
  }
  return events
}

export function syncEvent(event: StoredEvent): SyncEvent {
  return {
    id: event.id,
    itemId: event.itemId,
    mode: event.mode,
    result: event.result,
    rating: event.rating,
    proposedRating: event.proposedRating,
    overridden: event.overridden,
    answerMs: event.answerMs,
    hintUsed: event.hintUsed,
    hintImposed: event.hintImposed,
    gradedBy: event.gradedBy,
    format: event.format,
    reviewedAt: event.reviewedAt.toISOString(),
    changedAt: event.changedAt?.toISOString() ?? null,
    receivedAt: event.receivedAt.toISOString(),
  }
}

export async function syncView(db: Db, deck: Deck, have: string | null): Promise<SyncResponse> {
  const snapshot = deckSnapshot(deck)
  const [epoch, events, flags] = await Promise.all([
    readEpoch(db),
    storedEvents(db),
    db
      .select({ itemId: itemFlags.itemId })
      .from(itemFlags)
      .where(isNull(itemFlags.resolvedAt))
      .orderBy(asc(itemFlags.itemId)),
  ])
  return {
    deckVersion: snapshot.version,
    deck: have === snapshot.version ? null : snapshot.cards,
    events: events.map(syncEvent),
    quarantined: flags.map((flag) => flag.itemId),
    epoch,
  }
}
