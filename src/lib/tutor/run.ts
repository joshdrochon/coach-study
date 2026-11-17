// Runs one model call with the guards around it: a per-minute rate limit, a spend
// hold against the daily cap, a timeout, and a trace row for the admin pages.

import { sql } from 'drizzle-orm'

import {
  chargeEstimate,
  recordSpend,
  releaseSpend,
  reserveSpend,
  type Hold,
} from '../budget/ledger'
import type { Db } from '../db/client'
import { counters, traces } from '../db/schema'
import type { ModelId, Usage } from '../grader/models'

import { TutorError, type FailedSpend } from './errors'

export const RATE_LIMIT_PER_MINUTE = 30

export type TraceKind =
  'card-grade' | 'practice-grade' | 'practice-coaching' | 'explain' | 'chat' | 'dispute'

export type Step = {
  name: string
  ms: number
  model?: ModelId
  inputTokens?: number
  outputTokens?: number
  cacheRead?: number
  usd?: number
}

export type ModelCall<T> = (
  signal: AbortSignal,
) => Promise<{ value: T; model: ModelId; usage: Usage }>

export type RunOptions = {
  db: Db
  kind: TraceKind

  traceId: string

  correlationId?: string

  estimateUsd: number
  timeoutMs: number
  now?: () => Date

  data?: Record<string, unknown>
}

export type RunResult<T> = { value: T; traceId: string; usd: number; ms: number }

export async function claimCallSlot(
  db: Db,
  now: Date,
  prefix = 'tutor-calls',
  limit = RATE_LIMIT_PER_MINUTE,
): Promise<boolean> {
  const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString().slice(0, 16)
  const claimed = await db
    .insert(counters)
    .values({ key: `${prefix}:${minute}`, value: 1, updatedAt: now })
    .onConflictDoUpdate({
      target: counters.key,
      set: { value: sql`${counters.value} + 1`, updatedAt: now },
      setWhere: sql`${counters.value} < ${limit}`,
    })
    .returning({ value: counters.value })
  return claimed.length > 0
}

function asTutorError(error: unknown, timedOut: boolean): TutorError {
  if (error instanceof TutorError) return error
  if (timedOut) return new TutorError('timeout', 'the tutor took too long', 'nothing')
  return new TutorError('upstream', error instanceof Error ? error.message : 'unknown')
}

async function chargeFailedCall(
  db: Db,
  hold: Hold,
  spend: FailedSpend | undefined,
  entry: { purpose: TraceKind; traceId: string },
  started: Date,
  at: Date,
): Promise<number> {
  try {
    if (spend === 'nothing') {
      await releaseSpend(db, hold, at)
      return 0
    }
    if (spend) return await recordSpend(db, { scope: 'app', ...entry, ...spend }, started, hold)
    return await chargeEstimate(db, hold, entry, started)
  } catch {
    return spend === 'nothing' ? 0 : hold.usd
  }
}

function modelStep(ms: number, model: ModelId, usage: Usage, usd: number): Step {
  return {
    name: 'model',
    ms,
    model,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    usd,
  }
}

export async function runTutorCall<T>(
  options: RunOptions & { verdict?: (value: T) => Record<string, unknown> },
  call: ModelCall<T>,
): Promise<RunResult<T>> {
  const now = options.now ?? (() => new Date())
  const { db, kind, traceId } = options
  const started = now()
  const steps: Step[] = []
  const correlation = {
    ...(options.correlationId ? { correlationId: options.correlationId } : {}),
    ...options.data,
  }
  const data = Object.keys(correlation).length > 0 ? { result: correlation } : {}

  const fail = async (error: TutorError, costUsd = 0): Promise<never> => {
    await db.insert(traces).values({
      id: traceId,
      kind,
      startedAt: started,
      totalMs: now().getTime() - started.getTime(),
      costUsd,
      outcome: 'fallback',
      steps,
      error: error.kind,
      ...data,
    })
    throw error
  }

  if (!(await claimCallSlot(db, started))) {
    return fail(new TutorError('rate-limited', 'too many tutor calls this minute'))
  }
  const hold = await reserveSpend(db, options.estimateUsd, started)
  if (!hold) return fail(new TutorError('daily-cap', 'the daily cap is reached'))

  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, options.timeoutMs)
  const callStarted = now()
  let result: Awaited<ReturnType<ModelCall<T>>>
  try {
    result = await call(controller.signal)
  } catch (error) {
    const failure = asTutorError(error, controller.signal.aborted)
    const ms = now().getTime() - callStarted.getTime()
    const { spend } = failure
    const entry = { purpose: kind, traceId }
    const usd = await chargeFailedCall(db, hold, spend, entry, started, now())
    steps.push(
      typeof spend === 'object'
        ? modelStep(ms, spend.model, spend.usage, usd)
        : { name: 'model', ms, usd },
    )
    return await fail(failure, usd)
  } finally {
    clearTimeout(timer)
  }

  const usd = await recordSpend(
    db,
    { scope: 'app', purpose: kind, model: result.model, usage: result.usage, traceId },
    started,
    hold,
  )
  const ms = now().getTime() - started.getTime()
  steps.push(modelStep(now().getTime() - callStarted.getTime(), result.model, result.usage, usd))
  const recorded = { ...correlation, ...options.verdict?.(result.value) }
  await db.insert(traces).values({
    id: traceId,
    kind,
    startedAt: started,
    totalMs: ms,
    costUsd: usd,
    outcome: 'ok',
    steps,
    ...(Object.keys(recorded).length > 0 ? { result: recorded } : {}),
  })
  return { value: result.value, traceId, usd, ms }
}
