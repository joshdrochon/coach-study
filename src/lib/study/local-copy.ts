import { z } from 'zod'

import { defaultScheduler, type Scheduler } from '../scheduler/fsrs'

import { metaOf, toCardView } from './card-view'
import {
  reviewEventSchema,
  syncEventSchema,
  type DeckCard,
  type HomeView,
  type NextResponse,
  type ReviewEvent,
  type SyncEvent,
} from './contract'
import { storedEventSchema, type StoredEvent } from './events'
import { homeCounts, pickNext, type NextQuery, type StudyState } from './pick'
import { stateFromEvents } from './replay-state'

export const localEventSchema = z.object({
  id: z.string().min(1),

  event: syncEventSchema,
  body: reviewEventSchema.nullable(),

  pending: z.union([z.literal(0), z.literal(1)]),

  seq: z.number(),
  sentAt: z.number().nullable(),
})
export type LocalEvent = z.infer<typeof localEventSchema>

export function localEventFor(review: ReviewEvent, seq: number): LocalEvent {
  return {
    id: review.eventId,
    event: {
      id: review.eventId,
      itemId: review.itemId,
      mode: review.mode,
      result: review.result,
      rating: review.rating,
      proposedRating: review.proposedRating,
      overridden: review.overridden,
      answerMs: review.answerMs,
      hintUsed: review.hintUsed,
      hintImposed: review.hintImposed ?? false,
      gradedBy: review.gradedBy,
      format: review.format ?? 'free',
      reviewedAt: review.reviewedAt,
      changedAt: review.changedAt ?? null,
      receivedAt: review.reviewedAt,
    },
    body: review,
    pending: 1,
    seq,
    sentAt: null,
  }
}

export function sendOrder(a: LocalEvent, b: LocalEvent): number {
  return a.seq - b.seq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

export function reviewBodyFor(event: SyncEvent): ReviewEvent | null {
  const body = reviewEventSchema.safeParse({
    eventId: event.id,
    itemId: event.itemId,
    mode: event.mode,
    result: event.result,
    rating: event.rating,
    proposedRating: event.proposedRating,
    overridden: event.overridden,
    answerText: '',
    answerMs: event.answerMs,
    hintUsed: event.hintUsed,
    hintImposed: event.hintImposed,
    gradedBy: event.gradedBy,
    format: event.format,
    traceId: null,
    reviewedAt: event.reviewedAt,
    ...(event.changedAt === null ? {} : { changedAt: event.changedAt }),
  })
  return body.success ? body.data : null
}

export function mergeSync(
  current: readonly LocalEvent[],
  server: readonly SyncEvent[],
  requestedAt: number,
): LocalEvent[] {
  const byId = new Map(current.map((record) => [record.id, record]))
  const put: LocalEvent[] = server.map((event) => {
    const known = byId.get(event.id)
    return {
      id: event.id,
      event,
      body: null,
      pending: 0,
      seq: known?.seq ?? 0,
      sentAt: known?.sentAt ?? requestedAt,
    }
  })
  const onServer = new Set(server.map((event) => event.id))
  for (const record of current) {
    if (onServer.has(record.id) || record.pending === 1) continue
    if (record.sentAt !== null && record.sentAt >= requestedAt) continue
    const body = record.body ?? reviewBodyFor(record.event)
    if (body) put.push({ ...record, body, pending: 1, sentAt: null })
  }
  return put
}

export function storedEvent(event: SyncEvent): StoredEvent {
  return storedEventSchema.parse({
    ...event,
    reviewedAt: new Date(event.reviewedAt),
    changedAt: event.changedAt === null ? null : new Date(event.changedAt),
    receivedAt: new Date(event.receivedAt),
  })
}

export type LocalCopy = {
  deck: readonly DeckCard[]
  events: readonly SyncEvent[]
  quarantined: readonly string[]
}

function studyState(copy: LocalCopy, now: Date, scheduler: Scheduler): StudyState {
  const seen = new Set<string>()
  const events: StoredEvent[] = []
  for (const event of copy.events) {
    if (seen.has(event.id)) continue
    seen.add(event.id)
    events.push(storedEvent(event))
  }
  return stateFromEvents(copy.deck.map(metaOf), events, new Set(copy.quarantined), now, scheduler)
}

export function localNext(
  copy: LocalCopy,
  query: NextQuery,
  now: Date,
  scheduler: Scheduler = defaultScheduler,
): NextResponse | null {
  const state = studyState(copy, now, scheduler)
  const cards = new Map(copy.deck.map((card) => [card.itemId, card]))
  return pickNext(
    query,
    state,
    (queued, seed) => {
      const card = cards.get(queued.card.itemId)
      if (!card) throw new Error(`card ${queued.card.itemId} is not in the deck`)
      return toCardView(card, queued, now, seed, scheduler)
    },
    now,
    scheduler,
  )
}

export function localHome(
  copy: LocalCopy,
  last: HomeView,
  now: Date,
  timeZone: string,
  scheduler: Scheduler = defaultScheduler,
): HomeView {
  return { ...last, ...homeCounts(studyState(copy, now, scheduler), now, timeZone) }
}
