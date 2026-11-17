// Daily spend cap. A call first holds its estimated cost; the hold is atomic in SQL,
// so two calls at once can't both slip under the cap. The real cost replaces it.

import { and, eq, sql } from 'drizzle-orm'

import type { Db } from '../db/client'
import { apiSpend, counters } from '../db/schema'
import { costUsd, type ModelId, type Usage } from '../grader/models'

export const CAPS = { app: 5, build: 120 } as const
export type Scope = keyof typeof CAPS

export function pacificDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(now)
}

export async function spent(db: Db, scope: Scope, now: Date): Promise<number> {
  const where =
    scope === 'app'
      ? and(eq(apiSpend.scope, 'app'), eq(apiSpend.day, pacificDay(now)))
      : eq(apiSpend.scope, 'build')
  const [row] = await db
    .select({ total: sql<string | null>`sum(${apiSpend.usd})` })
    .from(apiSpend)
    .where(where)
  return Number(row?.total ?? 0)
}

export type SpendCheck = { ok: boolean; spent: number; cap: number; remaining: number }

export async function canSpend(
  db: Db,
  scope: Scope,
  estimateUsd: number,
  now: Date,
): Promise<SpendCheck> {
  const total = await spent(db, scope, now)
  const cap = CAPS[scope]
  return { ok: total + estimateUsd <= cap, spent: total, cap, remaining: Math.max(0, cap - total) }
}

export type Hold = { key: string | null; usd: number }

export function spendKey(now: Date): string {
  return `spend:app:${pacificDay(now)}`
}

const asNumeric = (value: number) => sql`${value}::numeric`

function recordedToday(now: Date) {
  return sql`(select coalesce(sum(${apiSpend.usd}), 0)::numeric from ${apiSpend} where ${apiSpend.scope} = 'app' and ${apiSpend.day} = ${pacificDay(now)}::date)`
}

async function holdOn(
  db: Db,
  key: string,
  cap: number,
  estimateUsd: number,
  now: Date,
): Promise<boolean> {
  const estimate = asNumeric(estimateUsd)
  const limit = asNumeric(cap)
  const recorded = recordedToday(now)
  const held = await db
    .insert(counters)
    .select(
      sql`select ${key}::text, ${recorded} + ${estimate}, ${now.toISOString()}::timestamptz where ${recorded} + ${estimate} <= ${limit}`,
    )
    .onConflictDoUpdate({
      target: counters.key,
      set: { value: sql`${counters.value} + ${estimate}`, updatedAt: now },
      setWhere: sql`${counters.value} + ${estimate} <= ${limit}`,
    })
    .returning({ value: counters.value })
  return held.length > 0
}

async function unhold(db: Db, key: string, usd: number, now: Date): Promise<void> {
  await db
    .update(counters)
    .set({ value: sql`${counters.value} - ${asNumeric(usd)}`, updatedAt: now })
    .where(eq(counters.key, key))
}

export async function reserveSpend(db: Db, estimateUsd: number, now: Date): Promise<Hold | null> {
  const key = spendKey(now)
  return (await holdOn(db, key, CAPS.app, estimateUsd, now)) ? { key, usd: estimateUsd } : null
}

export async function releaseSpend(db: Db, hold: Hold, now: Date): Promise<void> {
  if (hold.key !== null) await unhold(db, hold.key, hold.usd, now)
}

export async function roomToday(db: Db, now: Date): Promise<number> {
  const [row] = await db
    .select({
      value: sql<string>`coalesce((select ${counters.value} from ${counters} where ${counters.key} = ${spendKey(now)}), ${recordedToday(now)})`,
    })
    .from(sql`(select 1) as one`)
  return CAPS.app - Number(row?.value ?? 0)
}

export async function chargeEstimate(
  db: Db,
  hold: Hold,
  entry: { purpose: string; traceId?: string },
  now: Date,
): Promise<number> {
  await db.insert(apiSpend).values({
    day: pacificDay(now),
    scope: 'app',
    purpose: entry.purpose,
    model: 'unknown',
    inputTokens: 0,
    outputTokens: 0,
    usd: hold.usd,
    traceId: entry.traceId,
    createdAt: now,
  })
  return hold.usd
}

export type SpendEntry = {
  scope: Scope
  purpose: string
  model: ModelId
  usage: Usage
  traceId?: string
}

export async function recordSpend(
  db: Db,
  entry: SpendEntry,
  now: Date,
  hold?: Hold,
): Promise<number> {
  const usd = costUsd(entry.model, entry.usage)
  const row = {
    day: pacificDay(now),
    scope: entry.scope,
    purpose: entry.purpose,
    model: entry.model,
    inputTokens: entry.usage.input_tokens,
    outputTokens: entry.usage.output_tokens,
    cacheReadTokens: entry.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: entry.usage.cache_creation_input_tokens ?? 0,
    usd,
    traceId: entry.traceId,
    createdAt: now,
  }
  if (entry.scope !== 'app') {
    await db.insert(apiSpend).values(row)
    return usd
  }
  const ledger = db
    .$with('ledger')
    .as(db.insert(apiSpend).values(row).returning({ usd: apiSpend.usd }))
  await db
    .with(ledger)
    .update(counters)
    .set({
      value: sql`${counters.value} + (select ${ledger.usd} from ${ledger})::numeric - ${asNumeric(hold?.usd ?? 0)}`,
      updatedAt: now,
    })
    .where(eq(counters.key, hold?.key ?? spendKey(now)))
  return usd
}
