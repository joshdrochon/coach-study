import 'server-only'

// Text-to-speech clips. Each line is made once and stored; the id hashes the voice
// settings and the speaking rules, so changing either makes fresh clips.

import { createHash, randomUUID } from 'node:crypto'

import { and, eq, sql } from 'drizzle-orm'

import { pacificDay } from '../budget/ledger'
import type { Db } from '../db/client'
import { counters, traces, ttsClips } from '../db/schema'
import { claimCallSlot } from '../tutor/run'

import {
  elevenLabsKey,
  synthesize,
  TTS_KEEP_MAKING_MS,
  TTS_TIMEOUT_MS,
  VOICE,
  type Fetch,
  type Voice,
} from './elevenlabs'
import { TtsError } from './errors'
import { FALLBACK_STEPS, type FallbackReport } from './fallback'
import { TTS_MAX_CHARS, ttsLine } from './line'
import { SPOKEN_VERSION } from './spoken'

export const TTS_RATE_PER_MINUTE = 40

export const DEFAULT_DAILY_CHARS = 40_000

type EnvSource = Record<string, string | undefined>

export function dailyCharBudget(source: EnvSource = process.env): number {
  const raw = source.TTS_DAILY_CHARS?.trim()
  const chars = raw ? Number(raw) : Number.NaN
  return Number.isSafeInteger(chars) && chars >= 0 ? chars : DEFAULT_DAILY_CHARS
}

export function voiceKey(voice: Voice = VOICE): string {
  return createHash('sha256').update(JSON.stringify(voice)).digest('hex').slice(0, 16)
}

export function clipId(
  line: string,
  voice: Voice = VOICE,
  spoken: number = SPOKEN_VERSION,
): string {
  return createHash('sha256')
    .update(`${voiceKey(voice)}\nspoken-v${String(spoken)}\n${line}`)
    .digest('hex')
}

export const CLIP_ID = /^[0-9a-f]{64}$/

export async function findClip(
  db: Db,
  id: string,
  voice: Voice = VOICE,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const [row] = await db
    .select({ audio: ttsClips.audio })
    .from(ttsClips)
    .where(and(eq(ttsClips.id, id), eq(ttsClips.voiceKey, voiceKey(voice))))
    .limit(1)
  return row?.audio ?? null
}

export function charsKey(now: Date): string {
  return `tts-chars:${pacificDay(now)}`
}

export async function holdChars(
  db: Db,
  chars: number,
  budget: number,
  now: Date,
): Promise<boolean> {
  const amount = sql`${chars}::numeric`
  const cap = sql`${budget}::numeric`
  const held = await db
    .insert(counters)
    .select(
      sql`select ${charsKey(now)}::text, ${amount}, ${now.toISOString()}::timestamptz where ${amount} <= ${cap}`,
    )
    .onConflictDoUpdate({
      target: counters.key,
      set: { value: sql`${counters.value} + ${amount}`, updatedAt: now },
      setWhere: sql`${counters.value} + ${amount} <= ${cap}`,
    })
    .returning({ value: counters.value })
  return held.length > 0
}

export async function releaseChars(db: Db, chars: number, heldAt: Date): Promise<void> {
  await db
    .update(counters)
    .set({ value: sql`${counters.value} - ${sql`${chars}::numeric`}`, updatedAt: new Date() })
    .where(eq(counters.key, charsKey(heldAt)))
}

export type ClipDeps = {
  env?: EnvSource
  fetch?: Fetch
  now?: () => Date

  timeoutMs?: number
  keepMakingMs?: number

  keepMaking?: (rest: Promise<void>) => void
}

export type Clip = { id: string; audio: Uint8Array<ArrayBuffer>; cached: boolean }

type Step = { name: 'elevenlabs'; ms: number; chars: number; bytes?: number }

export async function lineClip(db: Db, text: string, deps: ClipDeps = {}): Promise<Clip> {
  const env = deps.env ?? process.env
  const key = elevenLabsKey(env)
  if (!key) throw new TtsError('no-key', 'the server has no voice key')
  const line = ttsLine(text)
  if (line === '' || line.length > TTS_MAX_CHARS) {
    throw new TtsError('invalid', 'no line, or a line too long to say')
  }
  const id = clipId(line)
  const cached = await findClip(db, id)
  if (cached) return { id, audio: cached, cached: true }

  const now = deps.now ?? (() => new Date())
  const started = now()
  const traceId = randomUUID()
  const steps: Step[] = []

  const trace = (outcome: 'ok' | 'fallback', error?: string, bytes?: number, late = false) =>
    db.insert(traces).values({
      id: traceId,
      kind: 'tts',
      startedAt: started,
      totalMs: now().getTime() - started.getTime(),

      costUsd: 0,
      outcome,
      steps,
      result: {
        chars: line.length,
        clip: id,
        ...(bytes === undefined ? {} : { bytes }),
        ...(late ? { late: true } : {}),
      },
      ...(error === undefined ? {} : { error }),
    })

  if (!(await claimCallSlot(db, started, 'tts-calls', TTS_RATE_PER_MINUTE))) {
    await trace('fallback', 'rate-limited')
    throw new TtsError('rate-limited', 'too many lines this minute')
  }
  if (!(await holdChars(db, line.length, dailyCharBudget(env), started))) {
    await trace('fallback', 'budget')
    throw new TtsError('budget', "today's character budget is used up")
  }

  const answerMs = deps.timeoutMs ?? TTS_TIMEOUT_MS
  const controller = new AbortController()
  const makeLimit = setTimeout(
    () => {
      controller.abort()
    },
    answerMs + (deps.keepMakingMs ?? TTS_KEEP_MAKING_MS),
  )
  let answeredLate = false
  const callStarted = now()
  const making = (async (): Promise<Uint8Array<ArrayBuffer>> => {
    let audio: Uint8Array<ArrayBuffer>
    try {
      audio = await synthesize(line, key, controller.signal, deps.fetch)
    } catch (error) {
      const failure =
        error instanceof TtsError ? error : new TtsError('upstream', 'the voice failed')

      if (failure.kind !== 'timeout')
        await releaseChars(db, line.length, started).catch(() => undefined)
      steps.push({
        name: 'elevenlabs',
        ms: now().getTime() - callStarted.getTime(),
        chars: line.length,
      })
      await trace('fallback', failure.kind, undefined, answeredLate).catch(() => undefined)
      throw failure
    } finally {
      clearTimeout(makeLimit)
    }
    steps.push({
      name: 'elevenlabs',
      ms: now().getTime() - callStarted.getTime(),
      chars: line.length,
      bytes: audio.byteLength,
    })

    await Promise.allSettled([
      db
        .insert(ttsClips)
        .values({ id, voiceKey: voiceKey(), chars: line.length, audio })
        .onConflictDoNothing(),
      trace('ok', undefined, audio.byteLength, answeredLate),
    ])
    return audio
  })()

  let answerTimer: ReturnType<typeof setTimeout> | undefined
  const answerLimit = new Promise<null>((resolve) => {
    answerTimer = setTimeout(() => {
      resolve(null)
    }, answerMs)
  })
  const audio = await Promise.race([making, answerLimit]).finally(() => {
    clearTimeout(answerTimer)
  })
  if (audio === null) {
    answeredLate = true
    const rest = making.then(
      () => undefined,
      () => undefined,
    )
    deps.keepMaking?.(rest)
    throw new TtsError('timeout', 'the voice took too long')
  }
  return { id, audio, cached: false }
}

export const FALLBACK_REPORTS_PER_MINUTE = TTS_RATE_PER_MINUTE

export function reportingServer(source: EnvSource = process.env): string {
  const env = source.VERCEL_ENV?.trim()
  return env === undefined || env === '' ? 'local' : env
}

export async function keepFallback(db: Db, report: FallbackReport, now: Date): Promise<boolean> {
  if (!(await claimCallSlot(db, now, 'tts-fallbacks', FALLBACK_REPORTS_PER_MINUTE))) return false
  await db.insert(traces).values({
    id: randomUUID(),
    kind: 'tts',

    startedAt: new Date(now.getTime() - report.atMs),
    totalMs: report.atMs,
    costUsd: 0,
    outcome: 'fallback',
    steps: FALLBACK_STEPS.flatMap(([field, name]) => {
      const ms = report[field]
      return ms === null ? [] : [{ name, ms }]
    }),
    result: {
      source: 'ipad',
      env: reportingServer(),
      reason: report.reason,
      chars: report.chars,
    },
    error: report.reason,
  })
  return true
}
