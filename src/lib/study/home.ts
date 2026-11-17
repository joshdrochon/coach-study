// Everything the Home screen shows, computed on the server in one call.

import { and, count, desc, eq, gte, lt, max } from 'drizzle-orm'

import type { Db } from '../db/client'
import { gateResults, practices } from '../db/schema'
import { findGate, gateById, isScored, GATES, type GateId } from '../gates'
import { localDay, TIME_ZONE } from '../scheduler/calendar'
import { defaultScheduler, type Scheduler } from '../scheduler/fsrs'
import { meanRecall } from '../scheduler/readiness'

import type { HomeView } from './contract'
import { daysUntil, endOfEvaluationDay, MILESTONES } from './days'
import type { Deck } from './deck'
import { homeCounts } from './pick'
import { readProfile } from './profile'
import { PACE_START_DAY } from './pace'
import { loadCardsAsOf, loadStudyState } from './state'

export {
  canonicalTimeZone,
  daysUntil,
  endOfEvaluationDay,
  endOfPacificDay,
  MILESTONES,
  nextEvaluationDay,
} from './days'

export const RECENT_PRACTICES = 10

export async function weakestMustDo(db: Db): Promise<GateId | null> {
  const recent = db
    .select({ id: practices.id, doneAt: practices.doneAt })
    .from(practices)
    .orderBy(desc(practices.doneAt))
    .limit(RECENT_PRACTICES)
    .as('recent')
  const rows = await db
    .select({ gateId: gateResults.gateId, misses: count(), lastMiss: max(recent.doneAt) })
    .from(gateResults)
    .innerJoin(recent, eq(recent.id, gateResults.practiceId))
    .where(eq(gateResults.verdict, 'miss'))
    .groupBy(gateResults.gateId)
    .orderBy(desc(count()), desc(max(recent.doneAt)), gateResults.gateId)
  for (const row of rows) {
    const gate = findGate(GATES, row.gateId)
    if (gate && isScored(gate)) return gate.id
  }
  return null
}

export async function weakestMustDoLabel(db: Db): Promise<string | null> {
  const id = await weakestMustDo(db)
  return id === null ? null : gateById(id).label
}

export async function paceStart(
  db: Db,
  deck: Deck,
  now: Date,
  scheduler: Scheduler = defaultScheduler,
): Promise<number | null> {
  if (daysUntil(MILESTONES.firstClass, now) < 0 || daysUntil(PACE_START_DAY, now) > 0) return null
  const dayStart = new Date(localDay(new Date(`${PACE_START_DAY}T12:00:00Z`), TIME_ZONE).start)
  const cards = await loadCardsAsOf(db, deck, dayStart, scheduler)
  return meanRecall(cards, endOfEvaluationDay(MILESTONES.firstClass), scheduler)
}

export async function homeView(
  db: Db,
  deck: Deck,
  now: Date,
  timeZone: string = TIME_ZONE,
  scheduler: Scheduler = defaultScheduler,
): Promise<HomeView> {
  const [state, weakest, me, practicesToday, start] = await Promise.all([
    loadStudyState(db, deck, now, scheduler),
    weakestMustDoLabel(db),
    readProfile(db),
    micPracticesOn(db, now),
    paceStart(db, deck, now, scheduler),
  ])
  return {
    ...homeCounts(state, now, timeZone),
    weakestMustDo: weakest,
    title: me.title,
    name: 'Coach Alex',
    avatarUrl: me.avatarUrl,
    micPracticesToday: practicesToday,
    paceStart: start,
  }
}

export async function micPracticesOn(db: Db, now: Date): Promise<number> {
  const day = localDay(now, TIME_ZONE)
  const [row] = await db
    .select({ n: count() })
    .from(practices)
    .where(and(gte(practices.doneAt, new Date(day.start)), lt(practices.doneAt, new Date(day.end))))
  return row?.n ?? 0
}
