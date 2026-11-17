// Per-tab cache of server reads. Each write route lists the views it makes stale, and
// the cache drops them after the write.

import type { ApiError, ApiResult } from '../dashboard/http'
import { dayKey, TIME_ZONE } from '../scheduler/calendar'

export type TabKey = 'home' | 'progress' | 'reminders'

export type Loaded<T> =
  { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; error: ApiError }

export const LOADING: Loaded<never> = { status: 'loading' }

export const WRITE_EFFECTS: Readonly<Record<string, readonly TabKey[]>> = {
  '/api/study/review': ['home', 'progress'],
  '/api/flags': ['home', 'progress'],
  '/api/tutor/practice': ['home', 'progress'],
  '/api/tutor/practice/coaching': ['home', 'progress'],
  '/api/practice/dispute': ['home', 'progress'],
  '/api/profile': ['home', 'progress'],

  '/api/tutor/card': [],

  '/api/session': [],

  '/api/nudges/subscription': [],
  '/api/voice-test': [],
  '/api/mic/report': [],
  '/api/tts': [],
  '/api/tts/fallback': [],
}

function deviceZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return TIME_ZONE
  }
}

export function dayStamp(now: Date): string {
  return `${dayKey(now, deviceZone())}|${dayKey(now, TIME_ZONE)}`
}

export type Cached<T> = {
  get: () => Loaded<T>
  subscribe: (listener: () => void) => () => void

  revalidate: () => Promise<T | null>
  retry: () => void
  set: (data: T) => void
  drop: () => void
}

type Entry = {
  key: TabKey
  drop: () => void
  revalidate: () => Promise<unknown>
  shown: () => boolean
}

const registry = new Set<Entry>()

export function invalidate(keys: readonly TabKey[]): void {
  for (const entry of registry) if (keys.includes(entry.key)) entry.drop()
}

export function invalidateAll(): void {
  invalidate(['home', 'progress', 'reminders'])
}

let lastReset: number | null = null

export function invalidateForReset(epoch: number): void {
  if (epoch === lastReset) return
  lastReset = epoch
  invalidateAll()
}

export function noteWrite(url: string): void {
  const keys = WRITE_EFFECTS[url.split('?')[0] ?? url]
  if (keys && keys.length > 0) invalidate(keys)
}

export function refreshShown(now: Date = new Date()): void {
  const day = dayStamp(now)
  const turned = lastDay !== null && day !== lastDay
  lastDay = day
  for (const entry of registry) {
    if (turned) entry.drop()
    else if (entry.shown()) void entry.revalidate()
  }
}

let lastDay: string | null = null
let watching = false

const DAY_CHECK_MS = 60_000

function watch(): void {
  if (watching || typeof window === 'undefined' || typeof document === 'undefined') return
  watching = true
  lastDay = dayStamp(new Date())
  window.addEventListener('focus', () => {
    refreshShown()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshShown()
  })
  window.setInterval(() => {
    if (dayStamp(new Date()) !== lastDay) refreshShown()
  }, DAY_CHECK_MS)
}

export function cached<T>(key: TabKey, load: () => Promise<ApiResult<T>>): Cached<T> {
  let snapshot: Loaded<T> = LOADING
  let day: string | null = null
  let generation = 0
  let inflight: { generation: number; promise: Promise<T | null> } | null = null
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of [...listeners]) listener()
  }
  const current = () => snapshot.status === 'ready' && day === dayStamp(new Date())

  const self: Cached<T> = {
    get: () => (snapshot.status === 'ready' && !current() ? LOADING : snapshot),
    subscribe(listener) {
      listeners.add(listener)
      watch()
      return () => {
        listeners.delete(listener)

        if (listeners.size === 0 && snapshot.status === 'error') snapshot = LOADING
      }
    },
    revalidate() {
      if (inflight?.generation === generation) return inflight.promise
      const mine = generation
      const asked = dayStamp(new Date())
      const promise = load()
        .catch((): ApiResult<T> => ({ ok: false, error: 'network' }))
        .then((result) => {
          if (mine !== generation) return null
          inflight = null
          if (result.ok) {
            snapshot = { status: 'ready', data: result.data }
            day = asked
          } else if (current() && result.error !== 'unauthorized') {
            return null
          } else {
            snapshot = listeners.size > 0 ? { status: 'error', error: result.error } : LOADING
            day = null
          }
          notify()
          return result.ok ? result.data : null
        })
      inflight = { generation: mine, promise }
      return promise
    },
    retry() {
      if (snapshot.status === 'error') {
        snapshot = LOADING
        notify()
      }
      void self.revalidate()
    },
    set(data) {
      generation += 1
      inflight = null
      snapshot = { status: 'ready', data }
      day = dayStamp(new Date())
      notify()
    },

    drop() {
      generation += 1
      inflight = null
      if (listeners.size > 0) {
        void self.revalidate()
      } else {
        snapshot = LOADING
        day = null
      }
      notify()
    },
  }
  registry.add({
    key,
    drop: self.drop,
    revalidate: self.revalidate,
    shown: () => listeners.size > 0,
  })
  return self
}
