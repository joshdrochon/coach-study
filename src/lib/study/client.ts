// The browser side of studying. Answers go into a local outbox first and are sent
// in the background, so the app keeps working offline and nothing is lost.

import { z } from 'zod'

import { invalidateForReset, noteWrite } from '../cache/tab-cache'
import type { ItemType } from '../content/schema'
import { correctionSchema, type AnswerEntry, type Correction } from '../grader/heard'
import { PROFILE_KEY, PROGRESS_KEY } from '../progress/localCopy'
import { TIME_ZONE } from '../scheduler/calendar'
import { defaultScheduler, type Scheduler } from '../scheduler/fsrs'
import { TUTOR_ERRORS, type TutorErrorKind } from '../tutor/errors'

import {
  flagAnswerSchema,
  homeViewSchema,
  nextResponseSchema,
  reviewEventSchema,
  STUDY_MODES,
  syncResponseSchema,
  type CardView,
  type FlagAnswer,
  type HomeView,
  type NextResponse,
  type ReviewEvent,
  type SessionMode,
} from './contract'
import { canonicalTimeZone } from './days'
import { decideEpoch, EPOCH_HEADER, resetEpochOf, savedEpoch, saveEpoch } from './epoch'
import { localEventFor, localHome, localNext, type LocalCopy } from './local-copy'
import { indexedDbLocalStore, type LocalStatus, type LocalStore } from './local-store'

export { STUDY_MODES }
export type StudyMode = (typeof STUDY_MODES)[number]
export type { CardView, FlagAnswer, HomeView, ItemType, ReviewEvent, SessionMode }

export type Rating = 1 | 2 | 3 | 4
export type GradeResult = 'right' | 'partial' | 'wrong'
export type GradedBy = 'tutor' | 'self' | 'code'

export type CardFormat = 'free' | 'choices'

export type Today = NextResponse['today']
export type NextCard = NextResponse

export type NextRequest = {
  mode: SessionMode
  categories: string[]

  exclude: string[]
}

export type GradeRequest = {
  itemId: string
  answer: string
  answerMs: number
  hintUsed: boolean
  entry: AnswerEntry
}

export type Grade = {
  corrections: Correction[]
  result: GradeResult
  missing: string[]
  inOrder: boolean | null
  spoken: string
  followUp: string | null
  source: 'code' | 'tutor'
  traceId: string | null
}

export type GradeFailure = TutorErrorKind | 'network' | 'timeout' | 'http' | 'invalid'
export type GradeOutcome = { ok: true; grade: Grade } | { ok: false; reason: GradeFailure }

export type StudyClient = {
  next(request: NextRequest): Promise<NextCard>

  grade(request: GradeRequest): Promise<GradeOutcome>

  review(event: ReviewEvent): Promise<void>

  flag(itemId: string, note: string, answer?: FlagAnswer): Promise<void>
  home(): Promise<HomeView>
  cachedHome(): HomeView | null

  flush(): Promise<void>
  pendingCount(): number

  sendTrouble(): boolean

  onSendChange(listener: () => void): () => void

  ready(): Promise<void>

  serverEpoch(epoch: number): Promise<void>
}

export type StudyClientErrorKind = 'network' | 'timeout' | 'http' | 'invalid'

export class StudyClientError extends Error {
  constructor(
    readonly kind: StudyClientErrorKind,
    readonly status?: number,
  ) {
    super(status === undefined ? kind : `${kind} ${String(status)}`)
    this.name = 'StudyClientError'
  }
}

function unreachable(error: unknown): boolean {
  return (
    error instanceof StudyClientError &&
    (error.kind === 'network' ||
      error.kind === 'timeout' ||
      (error.kind === 'http' && (error.status ?? 0) >= 500))
  )
}

export const gradeSchema = z.object({
  corrections: z.array(correctionSchema).default([]),
  result: z.enum(['right', 'partial', 'wrong']),
  missing: z.array(z.string()),
  inOrder: z.boolean().nullable(),
  spoken: z.string(),
  followUp: z.string().nullable(),
  source: z.enum(['code', 'tutor']),
  traceId: z.string().nullable(),
})

const errorBodySchema = z.object({ error: z.string() })

const outboxEntrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('review'), body: reviewEventSchema, savedAt: z.number().optional() }),
  z.object({
    kind: z.literal('flag'),
    savedAt: z.number().optional(),
    body: z.object({
      itemId: z.string(),
      note: z.string(),
      flagId: z.uuid().optional(),

      answer: flagAnswerSchema.optional().catch(undefined),
    }),
  }),
])
type OutboxEntry = z.infer<typeof outboxEntrySchema>

export const OUTBOX_KEY = 'coach-study:outbox:v1'
export const HOME_KEY = 'coach-study:home:v1'

export const STUDY_STORAGE_KEYS: readonly string[] = [
  OUTBOX_KEY,
  HOME_KEY,
  PROFILE_KEY,
  PROGRESS_KEY,
]

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'> &
  Partial<Pick<Storage, 'removeItem'>>
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type Timers = { after: (ms: number, run: () => void) => () => void }

export type ClientOptions = {
  fetch?: FetchLike

  storage?: StorageLike | null
  timers?: Timers

  timeoutMs?: { read: number; grade: number; write: number }

  timeZone?: () => string | undefined

  local?: LocalStore | null

  fallbackMs?: number

  now?: () => number
  scheduler?: Scheduler

  onReset?: (reload: boolean) => void
}

const DEFAULT_TIMEOUTS = { read: 10_000, grade: 12_000, write: 10_000 }

const DEFAULT_FALLBACK_MS = 2_500

export const SYNC_EVERY_MS = 10 * 60_000

export const KEEPS_FAILING = 2

type Delivery = 'delivered' | 'dropped' | 'retry' | 'offline' | 'reset'
type Pass = 'done' | 'offline' | 'reset'

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function defaultLocalStore(): LocalStore | null {
  try {
    return typeof indexedDB === 'undefined' ? null : indexedDbLocalStore(indexedDB)
  } catch {
    return null
  }
}

function defaultTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

export function createStudyClient(options: ClientOptions = {}): StudyClient {
  const doFetch: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
  const storage = options.storage === undefined ? defaultStorage() : options.storage
  const timers: Timers = options.timers ?? {
    after: (ms, run) => {
      const id = globalThis.setTimeout(run, ms)
      return () => {
        globalThis.clearTimeout(id)
      }
    },
  }
  const timeouts = options.timeoutMs ?? DEFAULT_TIMEOUTS
  const timeZone = options.timeZone ?? defaultTimeZone
  const local = options.local === undefined ? defaultLocalStore() : options.local
  const fallbackMs = options.fallbackMs ?? DEFAULT_FALLBACK_MS
  const now = options.now ?? (() => Date.now())
  const scheduler = options.scheduler ?? defaultScheduler
  const onReset = options.onReset ?? (() => undefined)
  let memory: OutboxEntry[] = []

  let memoryOnly = false
  let memoryHome: HomeView | null = null
  let flushing: Promise<Pass> | null = null
  let flushAgain = false

  let localPending = 0
  let lastSync: number | null = null
  let syncWanted = true
  let syncing: Promise<void> | null = null
  let seq = 0

  let epochChecked = false
  let firstCheck: Promise<void> | null = null
  let shownBeforeCheck = false
  let resetting: Promise<boolean> | null = null

  let failedTries = 0
  const sendListeners = new Set<() => void>()

  function sendChanged(): void {
    for (const listener of sendListeners) listener()
  }

  function readOutbox(): OutboxEntry[] {
    if (!storage || memoryOnly) return memory
    try {
      const parsed: unknown = JSON.parse(storage.getItem(OUTBOX_KEY) ?? '[]')
      if (!Array.isArray(parsed)) return []

      return parsed.flatMap((entry) => {
        const checked = outboxEntrySchema.safeParse(entry)
        return checked.success ? [checked.data] : []
      })
    } catch {
      return memory
    }
  }

  function writeOutbox(entries: OutboxEntry[]): void {
    memory = entries
    if (!storage || memoryOnly) return
    try {
      storage.setItem(OUTBOX_KEY, JSON.stringify(entries))
    } catch {
      memoryOnly = true
    }
  }

  function enqueue(entry: OutboxEntry): void {
    writeOutbox([...readOutbox(), { ...entry, savedAt: now() }])
  }

  function remove(entry: OutboxEntry): void {
    const key = JSON.stringify(entry)
    const entries = readOutbox()
    const index = entries.findIndex((candidate) => JSON.stringify(candidate) === key)
    if (index >= 0) writeOutbox([...entries.slice(0, index), ...entries.slice(index + 1)])
  }

  async function call(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController()
    const cancel = timers.after(timeoutMs, () => {
      controller.abort()
    })
    try {
      return await doFetch(path, {
        ...init,
        signal: controller.signal,
        cache: 'no-store',
        credentials: 'same-origin',
      })
    } catch {
      throw new StudyClientError(controller.signal.aborted ? 'timeout' : 'network')
    } finally {
      cancel()
    }
  }

  async function json(response: Response): Promise<unknown> {
    try {
      const body: unknown = await response.json()
      return body
    } catch {
      throw new StudyClientError('invalid', response.status)
    }
  }

  async function getJson<T>(path: string, schema: z.ZodType<T>, timeoutMs: number): Promise<T> {
    const response = await call(path, { method: 'GET' }, timeoutMs)
    if (!response.ok) throw new StudyClientError('http', response.status)
    const parsed = schema.safeParse(await json(response))
    if (!parsed.success) throw new StudyClientError('invalid', response.status)
    return parsed.data
  }

  function post(path: string, body: unknown, timeoutMs: number): Promise<Response> {
    return call(
      path,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [EPOCH_HEADER]: String(savedEpoch(storage) ?? 0),
        },
        body: JSON.stringify(body),
      },
      timeoutMs,
    ).then(async (response) => {
      if (response.ok || (response.status === 409 && (await resetEpochOf(response)) === null)) {
        noteWrite(path)
      }
      return response
    })
  }

  async function deliver(entry: OutboxEntry): Promise<Delivery> {
    const path = entry.kind === 'review' ? '/api/study/review' : '/api/flags'
    let response: Response
    try {
      response = await post(path, entry.body, timeouts.write)
    } catch {
      return 'offline'
    }

    const reset = await resetEpochOf(response)
    if (reset !== null) {
      await applyEpoch(reset, now())
      return 'reset'
    }

    if (response.ok || response.status === 409) return 'delivered'

    const appAnswer = (response.headers.get('content-type') ?? '').includes('application/json')
    if (
      response.status === 400 ||
      response.status === 413 ||
      response.status === 422 ||
      (response.status === 404 && appAnswer)
    ) {
      return 'dropped'
    }

    return 'retry'
  }

  async function deliverLocal(store: LocalStore, stuck: () => void): Promise<Pass> {
    let records
    try {
      records = await store.pending()
    } catch {
      if (localPending > 0) stuck()
      return 'done'
    }
    for (const record of records) {
      if (!record.body) continue
      const delivery = await deliver({ kind: 'review', body: record.body })
      if (delivery === 'offline' || delivery === 'reset') return delivery
      if (delivery === 'retry') {
        syncWanted = true
        stuck()
        continue
      }
      try {
        if (delivery === 'delivered') await store.markSent(record.id, now())
        else await store.drop(record.id)
      } catch {}
    }
    return 'done'
  }

  async function deliverAll(): Promise<{ pass: Pass; failed: boolean }> {
    let pass: Pass = 'done'
    let stuck = false
    const noteStuck = () => {
      stuck = true
    }
    for (const entry of readOutbox()) {
      const delivery = await deliver(entry)
      if (delivery === 'offline' || delivery === 'reset') {
        pass = delivery
        break
      }
      if (delivery === 'retry') {
        syncWanted = true
        stuck = true
      } else remove(entry)
    }
    if (pass === 'done' && local) pass = await deliverLocal(local, noteStuck)
    if (pass === 'offline') syncWanted = true
    await countPending()
    return { pass, failed: pass === 'offline' || (pass === 'done' && stuck) }
  }

  function deliverPass(): Promise<Pass> {
    if (flushing) {
      flushAgain = true
      return flushing
    }

    flushing = (async () => {
      let round: { pass: Pass; failed: boolean }
      do round = await deliverAll()
      while (takeFlushAgain())
      failedTries = round.failed ? failedTries + 1 : 0
      sendChanged()
      return round.pass
    })().finally(() => {
      flushing = null
    })
    return flushing
  }

  function takeFlushAgain(): boolean {
    const again = flushAgain
    flushAgain = false
    return again
  }

  async function countPending(): Promise<void> {
    if (!local) return
    try {
      localPending = (await local.status()).pending
    } catch {}
  }

  function sync(store: LocalStore): Promise<void> {
    syncing ??= (async () => {
      const requestedAt = now()
      try {
        const { deckVersion } = await store.status()
        const query = deckVersion === null ? '' : `?deck=${encodeURIComponent(deckVersion)}`
        const snapshot = await getJson(`/api/study/sync${query}`, syncResponseSchema, timeouts.read)

        if (!(await applyEpoch(snapshot.epoch, requestedAt))) throw new Error('reset unfinished')
        await store.replace(snapshot, requestedAt)
        lastSync = now()
        syncWanted = false
        await countPending()
        sendChanged()
      } catch {
        syncWanted = true
      }
    })().finally(() => {
      syncing = null
    })
    return syncing
  }

  function syncDue(): boolean {
    return syncWanted || lastSync === null || now() - lastSync >= SYNC_EVERY_MS
  }

  function checkEpoch(): Promise<void> {
    if (!local) {
      epochChecked = true
      return Promise.resolve()
    }
    firstCheck ??= sync(local)
    return firstCheck
  }

  // A reset on the server bumps its epoch. When ours differs, local copies are cleared
  // but answers given after the reset are kept and resent.
  function applyEpoch(epoch: number, since: number, fromPractice = false): Promise<boolean> {
    resetting ??= (async () => {
      const decision = decideEpoch(savedEpoch(storage), epoch)
      if (decision !== 'reset') {
        if (decision === 'adopt') saveEpoch(epoch, storage)
        epochChecked = true
        return true
      }
      const reloadPage = !fromPractice && (epochChecked || shownBeforeCheck)

      const kept = readOutbox().filter((entry) => (entry.savedAt ?? -1) >= since)
      for (const key of STUDY_STORAGE_KEYS) {
        try {
          storage?.removeItem?.(key)
        } catch {}
      }
      memory = []
      memoryHome = null
      if (kept.length > 0) writeOutbox(kept)
      if (local) {
        try {
          await local.clear(since)
        } catch {
          return false
        }
      }
      await countPending()
      const saved = saveEpoch(epoch, storage)
      epochChecked = true
      syncWanted = true
      failedTries = 0
      sendChanged()
      invalidateForReset(epoch)
      onReset(reloadPage && saved)
      return true
    })().finally(() => {
      resetting = null
    })
    return resetting
  }

  async function copyStatus(): Promise<LocalStatus | null> {
    const status = await localStatus()
    if (epochChecked || !canAnswer(status) || !answersWaiting(status)) return status
    await within(checkEpoch(), fallbackMs)
    return localStatus()
  }

  function shownFromCopy(): void {
    if (!epochChecked) shownBeforeCheck = true
  }

  async function sendPass(): Promise<Pass> {
    if (!epochChecked) await checkEpoch()
    const pass = await deliverPass()
    if (pass !== 'reset') return pass
    if (local) await sync(local)
    return deliverPass()
  }

  async function flush(): Promise<void> {
    const pass = await sendPass()
    if (pass !== 'done' || !local || !syncDue()) return
    const waiting = localPending
    await sync(local)

    if (localPending > waiting) await deliverPass()
  }

  function within(work: Promise<unknown>, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const cancel = timers.after(ms, resolve)
      const settle = () => {
        cancel()
        resolve()
      }
      work.then(settle, settle)
    })
  }

  async function localStatus(): Promise<LocalStatus | null> {
    if (!local) return null
    try {
      return await local.status()
    } catch {
      return null
    }
  }

  function canAnswer(status: LocalStatus | null): status is LocalStatus {
    return status !== null && status.deckVersion !== null
  }

  function answersWaiting(status: LocalStatus): boolean {
    return status.pending > 0 || readOutbox().some((entry) => entry.kind === 'review')
  }

  async function readLocalCopy(): Promise<LocalCopy | null> {
    if (!local) return null
    try {
      const stored = await local.read()
      if (!stored.deck) return null
      const outbox = readOutbox()
      return {
        deck: stored.deck.cards,
        events: [
          ...stored.events.map((record) => record.event),
          ...outbox.flatMap((entry) =>
            entry.kind === 'review' ? [localEventFor(entry.body, 0).event] : [],
          ),
        ],
        quarantined: [
          ...stored.quarantined,
          ...outbox.flatMap((entry) => (entry.kind === 'flag' ? [entry.body.itemId] : [])),
        ],
      }
    } catch {
      return null
    }
  }

  function standIn(): void {
    syncWanted = true
    void flush()
  }

  async function nextFromCopy(
    request: NextRequest,
    read: Promise<LocalCopy | null> = readLocalCopy(),
  ): Promise<NextCard | null> {
    const copy = await read
    if (!copy) return null
    standIn()
    shownFromCopy()
    const view = localNext(
      copy,
      { mode: request.mode, categories: request.categories, exclude: request.exclude },
      new Date(now()),
      scheduler,
    )

    if (view === null) throw new StudyClientError('http', 400)
    return view
  }

  async function homeFromCopy(zone: string | undefined): Promise<HomeView | null> {
    const last = readCachedHome()
    const copy = last ? await readLocalCopy() : null
    if (!last || !copy) return null
    standIn()
    shownFromCopy()
    const timeZoneName = (zone === undefined ? null : canonicalTimeZone(zone)) ?? TIME_ZONE
    return localHome(copy, last, new Date(now()), timeZoneName, scheduler)
  }

  function readCachedHome(): HomeView | null {
    if (!storage) return memoryHome
    try {
      const raw = storage.getItem(HOME_KEY)
      if (raw === null) return memoryHome
      const parsed = homeViewSchema.safeParse(JSON.parse(raw))
      return parsed.success ? parsed.data : memoryHome
    } catch {
      return memoryHome
    }
  }

  return {
    async next(request) {
      const params = new URLSearchParams({ mode: request.mode })
      if (request.categories.length > 0) params.set('categories', request.categories.join(','))
      if (request.exclude.length > 0) params.set('exclude', request.exclude.join(','))

      const status = local ? await copyStatus() : null
      const copyReady = canAnswer(status)
      if (copyReady && answersWaiting(status)) {
        const view = await nextFromCopy(request)
        if (view) return view
      }

      const early = copyReady ? readLocalCopy() : null
      try {
        return await getJson(
          `/api/study/next?${params.toString()}`,
          nextResponseSchema,
          copyReady ? fallbackMs : timeouts.read,
        )
      } catch (error) {
        if (early && unreachable(error)) {
          const view = await nextFromCopy(request, early)
          if (view) return view
        }
        throw error
      }
    },

    async grade(request) {
      let response: Response
      try {
        response = await post('/api/tutor/card', request, timeouts.grade)
      } catch (error) {
        return {
          ok: false,
          reason: error instanceof StudyClientError ? error.kind : 'network',
        }
      }
      let body: unknown
      try {
        body = await json(response)
      } catch {
        return { ok: false, reason: response.ok ? 'invalid' : 'http' }
      }
      if (!response.ok) {
        const parsed = errorBodySchema.safeParse(body)
        const kind = parsed.success
          ? TUTOR_ERRORS.find((known) => known === parsed.data.error)
          : undefined
        return { ok: false, reason: kind ?? 'http' }
      }
      const parsed = gradeSchema.safeParse(body)
      return parsed.success ? { ok: true, grade: parsed.data } : { ok: false, reason: 'invalid' }
    },

    async review(event) {
      let saved = false
      if (local) {
        seq = Math.max(seq + 1, now())
        try {
          await local.add(localEventFor(event, seq))
          saved = true
        } catch {}
      }
      if (!saved) enqueue({ kind: 'review', body: event })
      noteWrite('/api/study/review')
      const sent = sendPass()
      void sent.then((pass) => (pass === 'done' && local && syncDue() ? sync(local) : undefined))

      if (!canAnswer(await localStatus())) {
        await sent
        return
      }
      await within(sent, fallbackMs)
    },

    async flag(itemId, note, answer) {
      const flagId = globalThis.crypto.randomUUID()
      enqueue({ kind: 'flag', body: { itemId, note, flagId, ...(answer ? { answer } : {}) } })
      if (local) await local.quarantine(itemId).catch(() => undefined)
      noteWrite('/api/flags')
      await flush()
    },

    async home() {
      const zone = timeZone()
      const path = zone ? `/api/home?tz=${encodeURIComponent(zone)}` : '/api/home'

      const status = local ? await copyStatus() : null
      const copyReady = canAnswer(status)
      if (copyReady && answersWaiting(status)) {
        const view = await homeFromCopy(zone)
        if (view) return view
      }
      let view: HomeView
      try {
        view = await getJson(path, homeViewSchema, copyReady ? fallbackMs : timeouts.read)
      } catch (error) {
        const stand = copyReady && unreachable(error) ? await homeFromCopy(zone) : null
        if (stand) return stand
        throw error
      }
      memoryHome = view
      if (storage) {
        try {
          storage.setItem(HOME_KEY, JSON.stringify(view))
        } catch {}
      }
      return view
    },

    cachedHome: readCachedHome,
    flush,
    pendingCount: () => readOutbox().length + localPending,
    sendTrouble: () => failedTries >= KEEPS_FAILING && readOutbox().length + localPending > 0,
    onSendChange(listener) {
      sendListeners.add(listener)
      return () => {
        sendListeners.delete(listener)
      }
    },
    ready: checkEpoch,

    async serverEpoch(epoch) {
      const before = savedEpoch(storage)
      await applyEpoch(epoch, now(), true)

      if (local && before !== savedEpoch(storage)) void sync(local)
    },
  }
}
