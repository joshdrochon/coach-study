import 'server-only'

// Passcode brute-force protection: a lock per client IP and a global one, each
// with its own window.

import { inArray, sql } from 'drizzle-orm'

import type { Db } from '../db/client'
import { authLockouts } from '../db/schema'

import type { SessionKind } from './session'

export type Limit = { max: number; windowMs: number; lockMs: number }
export const LIMITS = {
  device: { max: 5, windowMs: 15 * 60_000, lockMs: 15 * 60_000 },
  global: { max: 10, windowMs: 60 * 60_000, lockMs: 15 * 60_000 },
} satisfies Record<string, Limit>

export type LockState = { failures: number; windowStart: Date; lockedUntil: Date | null }

export function lockedUntil(state: LockState | undefined, now: Date): Date | null {
  return state?.lockedUntil && state.lockedUntil > now ? state.lockedUntil : null
}

export function afterFailure(state: LockState | undefined, limit: Limit, now: Date): LockState {
  const fresh = !state || now.getTime() - state.windowStart.getTime() >= limit.windowMs
  const failures = fresh ? 1 : state.failures + 1
  const windowStart = fresh ? now : state.windowStart
  return {
    failures,
    windowStart,
    lockedUntil: failures >= limit.max ? new Date(now.getTime() + limit.lockMs) : null,
  }
}

export function lockKeys(kind: SessionKind, ip: string): { device: string; global: string } {
  return { device: `${kind}:ip:${ip}`, global: `${kind}:global` }
}

async function readStates(db: Db, keys: string[]): Promise<Map<string, LockState>> {
  const rows = await db.select().from(authLockouts).where(inArray(authLockouts.key, keys))
  return new Map(rows.map((row) => [row.key, row]))
}

export type GateCheck = { locked: true; until: Date } | { locked: false }

export async function checkLock(
  db: Db,
  kind: SessionKind,
  ip: string,
  now: Date,
): Promise<GateCheck> {
  const keys = lockKeys(kind, ip)
  const states = await readStates(db, [keys.device, keys.global])
  const until = [
    lockedUntil(states.get(keys.device), now),
    lockedUntil(states.get(keys.global), now),
  ]
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0]
  return until ? { locked: true, until } : { locked: false }
}

export async function recordFailure(
  db: Db,
  kind: SessionKind,
  ip: string,
  now: Date,
): Promise<{ deviceTriesLeft: number }> {
  const keys = lockKeys(kind, ip)
  const states = await readStates(db, [keys.device, keys.global])
  const device = afterFailure(states.get(keys.device), LIMITS.device, now)
  const global = afterFailure(states.get(keys.global), LIMITS.global, now)
  for (const [key, state] of [
    [keys.device, device],
    [keys.global, global],
  ] as const) {
    await db
      .insert(authLockouts)
      .values({ key, ...state })
      .onConflictDoUpdate({
        target: authLockouts.key,
        set: {
          failures: state.failures,
          windowStart: state.windowStart,
          lockedUntil: state.lockedUntil,
        },
      })
  }
  return { deviceTriesLeft: Math.max(0, LIMITS.device.max - device.failures) }
}

export async function clearDevice(db: Db, kind: SessionKind, ip: string): Promise<void> {
  await db.delete(authLockouts).where(sql`${authLockouts.key} = ${lockKeys(kind, ip).device}`)
}
