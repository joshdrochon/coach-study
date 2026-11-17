import { eq, inArray } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { recordSpend, spent } from '../budget/ledger'
import { openTestDb, type Db } from '../db/client'
import { apiSpend, traces } from '../db/schema'

import { STATUS, TutorError, errorBody } from './errors'
import { RATE_LIMIT_PER_MINUTE, runTutorCall } from './run'

const NOON = new Date('2026-08-17T19:00:00Z')
const usage = { input_tokens: 1500, output_tokens: 200 }
let n = 0
const id = () => `trace-${String(++n)}`

describe('runTutorCall', () => {
  let db: Db
  beforeEach(async () => {
    db = await openTestDb()
  })

  const options = (over: Partial<Parameters<typeof runTutorCall>[0]> = {}) => ({
    db,
    kind: 'card-grade' as const,
    traceId: id(),
    estimateUsd: 0.01,
    timeoutMs: 1000,
    now: () => NOON,
    ...over,
  })

  it('returns the value, records the real cost and writes an ok trace', async () => {
    const opts = options()
    const result = await runTutorCall(opts, () =>
      Promise.resolve({ value: { rating: 'Got it' }, model: 'claude-haiku-4-5' as const, usage }),
    )
    expect(result.value).toEqual({ rating: 'Got it' })
    expect(result.usd).toBeCloseTo(0.0025)
    const [row] = await db.select().from(traces).where(eq(traces.id, opts.traceId))
    expect(row).toMatchObject({ outcome: 'ok', kind: 'card-grade' })
  })

  it('times out a slow call as a typed error and leaves a fallback trace', async () => {
    const opts = options({ timeoutMs: 20, now: () => new Date() })
    const slow = (signal: AbortSignal) =>
      new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => {
          reject(new Error('aborted'))
        })
      })
    await expect(runTutorCall(opts, slow)).rejects.toMatchObject({ kind: 'timeout' })
    const [row] = await db.select().from(traces).where(eq(traces.id, opts.traceId))
    expect(row).toMatchObject({ outcome: 'fallback', error: 'timeout' })
  })

  it('maps an API failure to upstream, and keeps typed errors as they are', async () => {
    await expect(
      runTutorCall(options(), () => Promise.reject(new Error('529 overloaded'))),
    ).rejects.toMatchObject({
      kind: 'upstream',
    })
    await expect(
      runTutorCall(options(), () => Promise.reject(new TutorError('refused', 'declined'))),
    ).rejects.toMatchObject({ kind: 'refused' })
  })

  it('stops at the $5/day cap before calling the model', async () => {
    await recordSpend(
      db,
      {
        scope: 'app',
        purpose: 'practice-grade',
        model: 'claude-sonnet-5-5',
        usage: { input_tokens: 2_000_000, output_tokens: 100_000 },
      },
      NOON,
    )
    let called = false
    await expect(
      runTutorCall(options({ estimateUsd: 0.5 }), () => {
        called = true
        return Promise.resolve({ value: 1, model: 'claude-haiku-4-5' as const, usage })
      }),
    ).rejects.toMatchObject({ kind: 'daily-cap' })
    expect(called).toBe(false)
  })

  it('rate-limits more than the allowed calls in a minute', async () => {
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i++) {
      await runTutorCall(options(), () =>
        Promise.resolve({ value: i, model: 'claude-haiku-4-5' as const, usage }),
      )
    }
    await expect(
      runTutorCall(options(), () =>
        Promise.resolve({ value: 0, model: 'claude-haiku-4-5' as const, usage }),
      ),
    ).rejects.toMatchObject({ kind: 'rate-limited' })
  })

  const slowly = (cost: typeof usage) => async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
    return { value: 1, model: 'claude-haiku-4-5' as const, usage: cost }
  }
  const outcomes = (calls: Promise<unknown>[]) =>
    Promise.all(
      calls.map((call) =>
        call.then(
          () => 'ok',
          (error: unknown) => (error instanceof TutorError ? error.kind : 'crashed'),
        ),
      ),
    )

  it('lets no more than the limit through when calls arrive at the same moment', async () => {
    const results = await outcomes(
      Array.from({ length: RATE_LIMIT_PER_MINUTE + 1 }, () =>
        runTutorCall(options(), slowly(usage)),
      ),
    )
    expect(results.filter((r) => r === 'ok')).toHaveLength(RATE_LIMIT_PER_MINUTE)
    expect(results.filter((r) => r === 'rate-limited')).toHaveLength(1)
  })

  it('counts calls in fixed one-minute windows: the next minute starts fresh', async () => {
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i++) {
      await runTutorCall(options(), slowly(usage))
    }
    await expect(runTutorCall(options(), slowly(usage))).rejects.toMatchObject({
      kind: 'rate-limited',
    })
    const nextMinute = new Date(NOON.getTime() + 60_000)
    await expect(
      runTutorCall(options({ now: () => nextMinute }), slowly(usage)),
    ).resolves.toMatchObject({ value: 1 })
  })

  const spendToday = (usd: number) =>
    recordSpend(
      db,
      {
        scope: 'app',
        purpose: 'card-grade',
        model: 'claude-haiku-4-5',
        usage: { input_tokens: Math.round(usd * 1_000_000), output_tokens: 0 },
      },
      NOON,
    )
  const halfCent = { input_tokens: 5_000, output_tokens: 0 }

  it('holds the cap for calls in flight: of 10 at the same moment, only the one that fits runs', async () => {
    await spendToday(4.993)
    let calledModel = 0
    const results = await outcomes(
      Array.from({ length: 10 }, () =>
        runTutorCall(options({ estimateUsd: 0.005 }), async () => {
          calledModel += 1
          return slowly(halfCent)()
        }),
      ),
    )
    expect(results.filter((r) => r === 'ok')).toHaveLength(1)
    expect(results.filter((r) => r === 'daily-cap')).toHaveLength(9)
    expect(calledModel).toBe(1)
    expect(await spent(db, 'app', NOON)).toBeLessThanOrEqual(5)
  })

  const hangs = (signal: AbortSignal) =>
    new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => {
        reject(new Error('aborted'))
      })
    })

  it('gives the hold back when no answer came back (API error, timeout), so the next call still fits', async () => {
    await spendToday(4.99)
    await expect(
      runTutorCall(options({ estimateUsd: 0.01 }), () =>
        Promise.reject(new TutorError('upstream', 'API error 529', 'nothing')),
      ),
    ).rejects.toMatchObject({ kind: 'upstream' })
    await expect(
      runTutorCall(options({ estimateUsd: 0.01, timeoutMs: 20 }), hangs),
    ).rejects.toMatchObject({ kind: 'timeout' })
    await expect(
      runTutorCall(options({ estimateUsd: 0.01 }), slowly(halfCent)),
    ).resolves.toMatchObject({ value: 1 })
    expect(await spent(db, 'app', NOON)).toBeCloseTo(4.995)
  })

  it('charges a call that failed after an answer came back (a refusal, invalid output) at its real cost', async () => {
    await spendToday(4.98)
    const opts = options({ estimateUsd: 0.01 })
    const refused = new TutorError('refused', 'the model declined', {
      model: 'claude-haiku-4-5',
      usage: halfCent,
    })
    await expect(runTutorCall(opts, () => Promise.reject(refused))).rejects.toBe(refused)

    expect(await spent(db, 'app', NOON)).toBeCloseTo(4.985)
    const [row] = await db.select().from(traces).where(eq(traces.id, opts.traceId))
    expect(row).toMatchObject({ outcome: 'fallback', error: 'refused' })
    expect(row?.costUsd).toBeCloseTo(0.005)
    expect(row?.steps).toEqual([
      expect.objectContaining({ name: 'model', model: 'claude-haiku-4-5', inputTokens: 5_000 }),
    ])

    await expect(
      runTutorCall(options({ estimateUsd: 0.02 }), slowly(halfCent)),
    ).rejects.toMatchObject({ kind: 'daily-cap' })
    await expect(
      runTutorCall(options({ estimateUsd: 0.01 }), slowly(halfCent)),
    ).resolves.toMatchObject({ value: 1 })
  })

  it('charges its estimate when what a failed call cost isn’t known, in the cap and the ledger', async () => {
    await spendToday(4.98)
    const opts = options({ estimateUsd: 0.01 })
    await expect(
      runTutorCall(opts, () => Promise.reject(new Error('failed after the answer'))),
    ).rejects.toMatchObject({ kind: 'upstream' })
    expect(await spent(db, 'app', NOON)).toBeCloseTo(4.99)
    const rows = await db.select().from(apiSpend).where(eq(apiSpend.traceId, opts.traceId))
    expect(rows).toEqual([
      expect.objectContaining({
        purpose: 'card-grade',
        model: 'unknown',
        inputTokens: 0,
        outputTokens: 0,
      }),
    ])

    await expect(
      runTutorCall(options({ estimateUsd: 0.015 }), slowly(halfCent)),
    ).rejects.toMatchObject({ kind: 'daily-cap' })
  })

  it('keeps a caller’s correlation ID in the trace as data, never as its key', async () => {
    const first = options({ correlationId: 'from-the-ipad' })
    const second = options({ correlationId: 'from-the-ipad' })
    await runTutorCall(first, slowly(usage))
    await expect(
      runTutorCall(second, () => Promise.reject(new TutorError('timeout', 'slow', 'nothing'))),
    ).rejects.toMatchObject({ kind: 'timeout' })
    const rows = await db
      .select()
      .from(traces)
      .where(inArray(traces.id, [first.traceId, second.traceId]))
    expect(rows.map((row) => row.result)).toEqual([
      { correlationId: 'from-the-ipad' },
      { correlationId: 'from-the-ipad' },
    ])
  })

  it('settles a hold to the real cost: a call cheaper than its estimate leaves room', async () => {
    await spendToday(4.985)

    await runTutorCall(options({ estimateUsd: 0.01 }), slowly(halfCent))
    await expect(
      runTutorCall(options({ estimateUsd: 0.01 }), slowly(halfCent)),
    ).resolves.toMatchObject({ value: 1 })
    expect(await spent(db, 'app', NOON)).toBeCloseTo(4.995)
  })
})

describe('error bodies', () => {
  it('tell the client to fall back to self-grading, with no upstream detail', () => {
    expect(errorBody('timeout')).toEqual({ error: 'timeout', fallback: 'self-grade' })
    expect(STATUS['daily-cap']).toBe(429)
  })

  it('answer the spend limit with its own kind, so it shows in the trace and to the client', () => {
    expect(errorBody('spend-limit')).toEqual({ error: 'spend-limit', fallback: 'self-grade' })
    expect(STATUS['spend-limit']).toBe(429)
  })
})
