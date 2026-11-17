import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { openTestDb, type Db } from '../db/client'
import { counters } from '../db/schema'

import {
  canSpend,
  CAPS,
  pacificDay,
  recordSpend,
  releaseSpend,
  reserveSpend,
  spendKey,
  spent,
  type Hold,
} from './ledger'

const NOON = new Date('2026-08-17T19:00:00Z')
const big = { input_tokens: 1_000_000, output_tokens: 200_000 }

describe('spend ledger', () => {
  let db: Db
  beforeEach(async () => {
    db = await openTestDb()
  })

  it('counts days in Pacific time', () => {
    expect(pacificDay(new Date('2026-08-18T03:00:00Z'))).toBe('2026-08-17')
  })

  it('records actual cost from usage', async () => {
    const usd = await recordSpend(
      db,
      { scope: 'app', purpose: 'card-grade', model: 'claude-sonnet-5-5', usage: big },
      NOON,
    )
    expect(usd).toBeCloseTo(4)
    expect(await spent(db, 'app', NOON)).toBeCloseTo(4)
  })

  it('refuses a call that would cross the $5/day app cap', async () => {
    await recordSpend(
      db,
      { scope: 'app', purpose: 'practice-grade', model: 'claude-sonnet-5-5', usage: big },
      NOON,
    )
    const check = await canSpend(db, 'app', 1.5, NOON)
    expect(check).toMatchObject({ ok: false, cap: CAPS.app })
    expect(check.remaining).toBeCloseTo(1)
    expect((await canSpend(db, 'app', 0.5, NOON)).ok).toBe(true)
  })

  it('starts a fresh app day the next Pacific day', async () => {
    await recordSpend(
      db,
      { scope: 'app', purpose: 'practice-grade', model: 'claude-sonnet-5-5', usage: big },
      NOON,
    )
    const tomorrow = new Date('2026-08-18T19:00:00Z')
    expect(await spent(db, 'app', tomorrow)).toBe(0)
  })

  it('keeps the build budget separate and cumulative across days', async () => {
    await recordSpend(
      db,
      { scope: 'build', purpose: 'eval', model: 'claude-sonnet-5-5', usage: big },
      NOON,
    )
    await recordSpend(
      db,
      { scope: 'build', purpose: 'eval', model: 'claude-sonnet-5-5', usage: big },
      new Date('2026-08-19T19:00:00Z'),
    )
    expect(await spent(db, 'build', NOON)).toBeCloseTo(8)
    expect(await spent(db, 'app', NOON)).toBe(0)

    expect((await canSpend(db, 'build', CAPS.build - 8 + 0.5, NOON)).ok).toBe(false)
    expect((await canSpend(db, 'build', CAPS.build - 8, NOON)).ok).toBe(true)
  })
})

describe('holds against their $5/day cap', () => {
  let db: Db
  beforeEach(async () => {
    db = await openTestDb()
  })

  const running = async (now = NOON) => {
    const [row] = await db
      .select()
      .from(counters)
      .where(eq(counters.key, spendKey(now)))
    return row?.value
  }
  const record = (usage: { input_tokens: number; output_tokens: number }, hold?: Hold) =>
    recordSpend(
      db,
      { scope: 'app', purpose: 'card-grade', model: 'claude-sonnet-5-5', usage },
      NOON,
      hold,
    )

  it('starts from the day’s ledger and holds only what fits under the cap', async () => {
    await record(big)
    expect(await reserveSpend(db, 1.5, NOON)).toBeNull()
    expect(await running()).toBeUndefined()
    const hold = await reserveSpend(db, 0.9, NOON)
    expect(hold).toEqual({ key: 'spend:app:2026-08-17', usd: 0.9 })
    expect(await running()).toBeCloseTo(4.9)
    expect(await reserveSpend(db, 0.2, NOON)).toBeNull()
    expect(await reserveSpend(db, 0.1, NOON)).not.toBeNull()
    expect(await running()).toBeCloseTo(5)
  })

  it('gives a hold back, and settles one to the real cost in the ledger', async () => {
    await record(big)
    const failed = await reserveSpend(db, 0.5, NOON)
    if (!failed) throw new Error('expected a hold')
    await releaseSpend(db, failed, NOON)
    expect(await running()).toBeCloseTo(4)
    const hold = await reserveSpend(db, 0.5, NOON)
    if (!hold) throw new Error('expected a hold')
    const usd = await record({ input_tokens: 125_000, output_tokens: 0 }, hold)
    expect(usd).toBeCloseTo(0.25)
    expect(await running()).toBeCloseTo(4.25)
    expect(await spent(db, 'app', NOON)).toBeCloseTo(4.25)
  })

  it('holds calls at the same moment one at a time: only what fits gets a hold', async () => {
    await record({ input_tokens: 2_496_500, output_tokens: 0 })
    const holds = await Promise.all(Array.from({ length: 10 }, () => reserveSpend(db, 0.005, NOON)))
    expect(holds.filter((hold) => hold !== null)).toHaveLength(1)
    expect(await running()).toBeCloseTo(4.998)
  })

  it('moves the running total for spend recorded without a hold, once the day has one', async () => {
    await record(big)
    await reserveSpend(db, 0.5, NOON)
    await record({ input_tokens: 125_000, output_tokens: 0 })
    expect(await running()).toBeCloseTo(4.75)
  })

  it('keeps each Pacific day, and the build budget, out of their running total', async () => {
    await record(big)
    const tomorrow = new Date('2026-08-18T19:00:00Z')
    expect(await reserveSpend(db, 4.5, tomorrow)).not.toBeNull()
    expect(await running(tomorrow)).toBeCloseTo(4.5)
    await recordSpend(
      db,
      { scope: 'build', purpose: 'eval', model: 'claude-sonnet-5-5', usage: big },
      NOON,
    )
    expect(await reserveSpend(db, 1, NOON)).not.toBeNull()
    expect(await running()).toBeCloseTo(5)
  })
})
