import { count, desc, eq, max, ne, sql } from 'drizzle-orm'

import type { Db } from '../db/client'
import { nudges } from '../db/schema'

import type { NudgeMessage } from './copy'
import type { NudgeReason } from './schedule'

export type DayLog = {
  counted: number

  attempts: number
}

export async function dayLog(db: Db, day: string): Promise<DayLog> {
  const [row] = await db
    .select({
      counted: sql<number>`count(*) filter (where ${nudges.status} <> 'failed')`.mapWith(Number),
      attempts: count(),
    })
    .from(nudges)
    .where(eq(nudges.day, day))
  return { counted: row?.counted ?? 0, attempts: row?.attempts ?? 0 }
}

export async function lastNudgeAt(db: Db): Promise<Date | null> {
  const [row] = await db
    .select({ at: max(nudges.createdAt) })
    .from(nudges)
    .where(ne(nudges.status, 'failed'))
  return row?.at ?? null
}

export type Claim = {
  day: string
  seq: number
  reason: NudgeReason
  message: NudgeMessage
  cardsLeft: number
  now: Date
}

export async function claimNudge(db: Db, claim: Claim): Promise<string | null> {
  const [row] = await db
    .insert(nudges)
    .values({
      day: claim.day,
      seq: claim.seq,
      status: 'sending',
      reason: claim.reason,
      title: claim.message.title,
      body: claim.message.body,
      cardsLeft: claim.cardsLeft,
      createdAt: claim.now,
    })
    .onConflictDoNothing({ target: [nudges.day, nudges.seq] })
    .returning({ id: nudges.id })
  return row?.id ?? null
}

export type Sent = { delivered: number; failed: number; removed: number; sentAt: Date }

export async function finishNudge(db: Db, id: string, sent: Sent): Promise<void> {
  await db
    .update(nudges)
    .set({
      status: sent.delivered > 0 ? 'sent' : 'failed',
      delivered: sent.delivered,
      failed: sent.failed,
      removed: sent.removed,
      sentAt: sent.sentAt,
    })
    .where(eq(nudges.id, id))
}

export type LoggedNudge = {
  day: string
  seq: number
  status: 'sending' | 'sent' | 'failed'
  reason: NudgeReason
  title: string
  body: string
  cardsLeft: number
  delivered: number
  failed: number
  removed: number
  createdAt: Date
  sentAt: Date | null
}

export async function recentNudges(db: Db, limit = 20): Promise<LoggedNudge[]> {
  return db
    .select({
      day: nudges.day,
      seq: nudges.seq,
      status: nudges.status,
      reason: nudges.reason,
      title: nudges.title,
      body: nudges.body,
      cardsLeft: nudges.cardsLeft,
      delivered: nudges.delivered,
      failed: nudges.failed,
      removed: nudges.removed,
      createdAt: nudges.createdAt,
      sentAt: nudges.sentAt,
    })
    .from(nudges)
    .orderBy(desc(nudges.createdAt), desc(nudges.seq))
    .limit(limit)
}
