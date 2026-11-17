// Study state is rebuilt from append-only review events. Card states are a cache:
// they can always be recomputed by replaying the events.

import { count, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'

import type { Db } from '../db/client'
import { cardStates, itemFlags, reviewEvents } from '../db/schema'
import { localDay } from '../scheduler/calendar'
import { WINDOW_SIZE } from '../scheduler/difficulty'
import { defaultScheduler, newCard, type Scheduler } from '../scheduler/fsrs'
import { compareText, hash32 } from '../scheduler/seeded'
import { fsrsCardSchema, type SchedulerCard } from '../scheduler/types'

import { baselineAnswerRefs } from './baseline'
import type { ReviewEvent } from './contract'
import type { Deck } from './deck'
import type { StudyState } from './pick'
import { parseEvents, STUDY_EVENT_MODES } from './events'
import { replayItem, replayItems, type Answer, type Replayed } from './replay'

export const effectiveTimeSql: SQL = sql`least(${reviewEvents.reviewedAt}, ${reviewEvents.receivedAt})`

export const CACHE_VERSION = 2

export function cacheKey(scheduler: Scheduler = defaultScheduler): string {
  return `${String(CACHE_VERSION)}:${hash32(JSON.stringify(scheduler.parameters)).toString(16)}`
}

const cachedCardSchema = z.object({ key: z.string(), fsrs: fsrsCardSchema })

export const eventColumns = {
  id: reviewEvents.id,
  itemId: reviewEvents.itemId,
  mode: reviewEvents.mode,
  result: reviewEvents.result,
  rating: reviewEvents.rating,
  proposedRating: reviewEvents.proposedRating,
  overridden: reviewEvents.overridden,
  answerMs: reviewEvents.answerMs,
  hintUsed: reviewEvents.hintUsed,
  hintImposed: reviewEvents.hintImposed,
  gradedBy: reviewEvents.gradedBy,
  format: reviewEvents.format,
  reviewedAt: reviewEvents.reviewedAt,
  changedAt: reviewEvents.changedAt,
  receivedAt: reviewEvents.receivedAt,
}

type EventRow = { itemId: string }

type Rebuilt = { replayed: Replayed; eventCount: number }

function replayRows(
  deck: Deck,
  rows: readonly EventRow[],
  scheduler: Scheduler,
): { rebuilt: Map<string, Rebuilt>; invalid: number } {
  const { events, invalid } = parseEvents(rows)
  const replayed = replayItems(deck.metaById, events, scheduler)
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.itemId, (counts.get(row.itemId) ?? 0) + 1)
  const rebuilt = new Map<string, Rebuilt>()
  for (const [itemId, eventCount] of counts) {
    const meta = deck.metaById.get(itemId)
    if (!meta) continue
    const entry = replayed.get(itemId) ?? replayItem(meta, [], scheduler)
    rebuilt.set(itemId, { replayed: entry, eventCount })
  }
  return { rebuilt, invalid }
}

async function writeCache(
  db: Db,
  rebuilt: readonly Rebuilt[],
  now: Date,
  scheduler: Scheduler,
): Promise<void> {
  if (rebuilt.length === 0) return
  const key = cacheKey(scheduler)
  await db
    .insert(cardStates)
    .values(
      rebuilt.map(({ replayed: { card }, eventCount }) => ({
        itemId: card.itemId,
        card: { key, fsrs: card.fsrs },
        due: card.fsrs.due,
        reps: card.fsrs.reps,
        lapses: card.fsrs.lapses,
        eventCount,
        updatedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: cardStates.itemId,
      set: {
        card: sql`excluded.card`,
        due: sql`excluded.due`,
        reps: sql`excluded.reps`,
        lapses: sql`excluded.lapses`,
        eventCount: sql`excluded.event_count`,
        updatedAt: sql`excluded.updated_at`,
      },
      setWhere: sql`${cardStates.eventCount} <= excluded.event_count`,
    })
}

export async function rebuildCards(
  db: Db,
  deck: Deck,
  itemIds: readonly string[],
  now: Date,
  scheduler: Scheduler = defaultScheduler,
): Promise<Map<string, Replayed>> {
  const wanted = itemIds.filter((itemId) => deck.metaById.has(itemId))
  if (wanted.length === 0) return new Map()
  const rows = await db
    .select(eventColumns)
    .from(reviewEvents)
    .where(inArray(reviewEvents.itemId, wanted))
  const { rebuilt, invalid } = replayRows(deck, rows, scheduler)
  if (invalid > 0) {
    console.error(
      `study: ${String(invalid)} stored answers can't be read (cards ${wanted.join(',')})`,
    )
  }
  await writeCache(db, [...rebuilt.values()], now, scheduler)
  return new Map([...rebuilt].map(([itemId, entry]) => [itemId, entry.replayed]))
}

export type RecordOutcome = 'stored' | 'duplicate' | 'unknown-item'

// Event ids come from the client, so a resent answer is a no-op ('duplicate').
export async function recordReview(
  db: Db,
  deck: Deck,
  event: ReviewEvent,
  now: Date,
  scheduler: Scheduler = defaultScheduler,
): Promise<RecordOutcome> {
  if (!deck.metaById.has(event.itemId)) return 'unknown-item'
  const inserted = await db
    .insert(reviewEvents)
    .values({
      id: event.eventId,
      deviceId: event.deviceId ?? 'unknown',
      itemId: event.itemId,
      mode: event.mode,
      result: event.result,
      rating: event.rating,
      proposedRating: event.proposedRating,
      overridden: event.overridden,
      answerText: event.answerText,
      answerMs: event.answerMs,
      hintUsed: event.hintUsed,
      hintImposed: event.hintImposed ?? false,
      format: event.format ?? 'free',
      gradedBy: event.gradedBy,
      traceId: event.traceId,
      reviewedAt: new Date(event.reviewedAt),
      changedAt: event.changedAt === undefined ? null : new Date(event.changedAt),
      receivedAt: now,
    })
    .onConflictDoNothing({ target: reviewEvents.id })
    .returning({ id: reviewEvents.id })
  if (inserted.length === 0) return 'duplicate'
  try {
    await rebuildCards(db, deck, [event.itemId], now, scheduler)
  } catch (error) {
    console.error(`study: card ${event.itemId} cache not rebuilt`, error)
  }
  return 'stored'
}

export type { StudyState }

export async function loadStudyState(
  db: Db,
  deck: Deck,
  now: Date,
  scheduler: Scheduler = defaultScheduler,
): Promise<StudyState> {
  const dayStart = new Date(localDay(now).start)

  const answeredToday = db
    .select({ itemId: reviewEvents.itemId })
    .from(reviewEvents)
    .where(sql`${effectiveTimeSql} >= ${dayStart.toISOString()}::timestamptz`)
  const lastStudyAnswers = db
    .select({ itemId: reviewEvents.itemId })
    .from(reviewEvents)
    .where(inArray(reviewEvents.mode, [...STUDY_EVENT_MODES]))
    .groupBy(reviewEvents.itemId, reviewEvents.reviewedAt)
    .orderBy(desc(sql`min(${effectiveTimeSql})`))
    .limit(WINDOW_SIZE)

  const [cacheRows, countRows, windowRows, flagRows, baselineRows] = await Promise.all([
    db
      .select({
        itemId: cardStates.itemId,
        card: cardStates.card,
        eventCount: cardStates.eventCount,
      })
      .from(cardStates),
    db
      .select({ itemId: reviewEvents.itemId, events: count() })
      .from(reviewEvents)
      .groupBy(reviewEvents.itemId),
    db
      .select(eventColumns)
      .from(reviewEvents)
      .where(
        or(
          inArray(reviewEvents.itemId, answeredToday),
          inArray(reviewEvents.itemId, lastStudyAnswers),
        ),
      ),
    db.select({ itemId: itemFlags.itemId }).from(itemFlags).where(isNull(itemFlags.resolvedAt)),

    db.select(eventColumns).from(reviewEvents).where(eq(reviewEvents.mode, 'baseline')),
  ])

  const key = cacheKey(scheduler)
  const cached = new Map(cacheRows.map((row) => [row.itemId, row]))
  const freshFsrs = (itemId: string, events: number): SchedulerCard['fsrs'] | null => {
    const row = cached.get(itemId)
    if (row?.eventCount !== events) return null
    const parsed = cachedCardSchema.safeParse(row.card)
    return parsed.success && parsed.data.key === key ? parsed.data.fsrs : null
  }

  const window = replayRows(deck, windowRows, scheduler).rebuilt
  const staleWindow = [...window].filter(
    ([itemId, { eventCount }]) => freshFsrs(itemId, eventCount) === null,
  )

  const eventCounts = new Map(countRows.map((row) => [row.itemId, row.events]))
  const fromCache = new Map<string, SchedulerCard['fsrs']>()
  const stale: string[] = []
  for (const meta of deck.metas) {
    const events = eventCounts.get(meta.itemId)
    if (window.has(meta.itemId) || events === undefined) continue
    const fsrs = freshFsrs(meta.itemId, events)
    if (fsrs) fromCache.set(meta.itemId, fsrs)
    else stale.push(meta.itemId)
  }
  const [rebuilt] = await Promise.all([
    rebuildCards(db, deck, stale, now, scheduler),
    writeCache(
      db,
      staleWindow.map(([, entry]) => entry),
      now,
      scheduler,
    ),
  ])

  const quarantined = new Set(flagRows.map((row) => row.itemId))
  const cards = deck.metas.map((meta): SchedulerCard => {
    const replayed = window.get(meta.itemId)?.replayed ?? rebuilt.get(meta.itemId)
    const fsrs = replayed?.card.fsrs ?? fromCache.get(meta.itemId)
    const card = fsrs ? { ...meta, fsrs } : newCard(meta, now)
    return { ...card, quarantined: quarantined.has(meta.itemId) }
  })
  const answers = [...window.values()].flatMap((entry) => entry.replayed.answers)
  return {
    cards,
    history: answers.flatMap((answer) => (answer.log ? [answer.log] : [])),
    answersToday: answers.filter(
      (answer) =>
        answer.at.getTime() >= dayStart.getTime() &&
        (answer.context === 'study' || answer.context === 'baseline'),
    ).length,
    baselineAnswers: baselineAnswerRefs(parseEvents(baselineRows).events),
  }
}

export type AllAnswers = {
  cards: SchedulerCard[]

  answers: Answer[]
}

export async function loadAllAnswers(
  db: Db,
  deck: Deck,
  now: Date,
  scheduler: Scheduler = defaultScheduler,
): Promise<AllAnswers> {
  const [rows, flagRows] = await Promise.all([
    db.select(eventColumns).from(reviewEvents),
    db.select({ itemId: itemFlags.itemId }).from(itemFlags).where(isNull(itemFlags.resolvedAt)),
  ])
  const { events, invalid } = parseEvents(rows)
  if (invalid > 0) {
    console.error(`study: ${String(invalid)} stored answers can't be read; left out of the history`)
  }
  const replayed = replayItems(deck.metaById, events, scheduler)
  const quarantined = new Set(flagRows.map((row) => row.itemId))
  const cards = deck.metas.map((meta): SchedulerCard => {
    const card = replayed.get(meta.itemId)?.card ?? newCard(meta, now)
    return { ...card, quarantined: quarantined.has(meta.itemId) }
  })
  const answers = [...replayed.values()]
    .flatMap((entry) => entry.answers)
    .toSorted((a, b) => a.at.getTime() - b.at.getTime() || compareText(a.itemId, b.itemId))
  return { cards, answers }
}

export async function loadCardsAsOf(
  db: Db,
  deck: Deck,
  asOf: Date,
  scheduler: Scheduler = defaultScheduler,
): Promise<SchedulerCard[]> {
  const [rows, flagRows] = await Promise.all([
    db
      .select(eventColumns)
      .from(reviewEvents)
      .where(sql`${effectiveTimeSql} < ${asOf.toISOString()}::timestamptz`),
    db.select({ itemId: itemFlags.itemId }).from(itemFlags).where(isNull(itemFlags.resolvedAt)),
  ])
  const { events } = parseEvents(rows)
  const replayed = replayItems(deck.metaById, events, scheduler)
  const quarantined = new Set(flagRows.map((row) => row.itemId))
  return deck.metas.map((meta): SchedulerCard => {
    const card = replayed.get(meta.itemId)?.card ?? newCard(meta, asOf)
    return { ...card, quarantined: quarantined.has(meta.itemId) }
  })
}
