import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ApiResult } from '../dashboard/http'

import {
  cached,
  dayStamp,
  invalidate,
  invalidateAll,
  invalidateForReset,
  LOADING,
  noteWrite,
  refreshShown,
  WRITE_EFFECTS,
  type TabKey,
} from './tab-cache'

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void }
function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const ok = <T>(data: T): ApiResult<T> => ({ ok: true, data })
const failed: ApiResult<never> = { ok: false, error: 'network' }

function loader<T>(...answers: ApiResult<T>[]) {
  const waiting: Deferred<ApiResult<T>>[] = []
  const load = vi.fn((): Promise<ApiResult<T>> => {
    const next = answers.shift()
    if (next) return Promise.resolve(next)
    const held = deferred<ApiResult<T>>()
    waiting.push(held)
    return held.promise
  })
  return { load, waiting }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('cached', () => {
  it('a revisit shows the last answer at once, and the fresh one replaces it with no loading in between', async () => {
    const { load, waiting } = loader(ok(1))
    const tab = cached('home', load)
    expect(tab.get()).toBe(LOADING)
    expect(await tab.revalidate()).toBe(1)
    expect(tab.get()).toEqual({ status: 'ready', data: 1 })
    const again = tab.revalidate()
    expect(tab.get()).toEqual({ status: 'ready', data: 1 })
    waiting[0]?.resolve(ok(2))
    expect(await again).toBe(2)
    expect(tab.get()).toEqual({ status: 'ready', data: 2 })
  })

  it('gives the same snapshot until something changes', async () => {
    const tab = cached('home', loader(ok('a')).load)
    await tab.revalidate()
    expect(tab.get()).toBe(tab.get())
  })

  it('asks once while an answer is on its way', async () => {
    const { load, waiting } = loader<number>()
    const tab = cached('progress', load)
    const first = tab.revalidate()
    const second = tab.revalidate()
    expect(load).toHaveBeenCalledTimes(1)
    waiting[0]?.resolve(ok(5))
    expect(await first).toBe(5)
    expect(await second).toBe(5)
  })

  it('a failed refresh keeps today’s answer on screen; with none it is an error', async () => {
    const listener = vi.fn()
    const kept = cached('home', loader(ok(1), failed).load)
    kept.subscribe(listener)
    await kept.revalidate()
    listener.mockClear()
    expect(await kept.revalidate()).toBeNull()
    expect(kept.get()).toEqual({ status: 'ready', data: 1 })
    expect(listener).not.toHaveBeenCalled()

    const none = cached('home', loader<number>({ ok: false, error: 'unauthorized' }).load)
    none.subscribe(() => undefined)
    await none.revalidate()
    expect(none.get()).toEqual({ status: 'error', error: 'unauthorized' })
  })

  it('an ended session shows even over today’s answer', async () => {
    const tab = cached('progress', loader<number>(ok(1), { ok: false, error: 'unauthorized' }).load)
    tab.subscribe(() => undefined)
    await tab.revalidate()
    await tab.revalidate()
    expect(tab.get()).toEqual({ status: 'error', error: 'unauthorized' })
  })

  it('an error belongs to the visit that met it: the next visit loads again', async () => {
    const tab = cached('progress', loader<number>(failed).load)
    const leave = tab.subscribe(() => undefined)
    await tab.revalidate()
    expect(tab.get().status).toBe('error')
    leave()
    expect(tab.get()).toBe(LOADING)
  })

  it('an error that lands after the learner left is never kept: the next visit loads again', async () => {
    for (const error of ['network', 'unauthorized'] as const) {
      const { load, waiting } = loader<number>()
      const tab = cached('progress', load)
      const leave = tab.subscribe(() => undefined)
      const asking = tab.revalidate()
      leave()
      waiting[0]?.resolve({ ok: false, error })
      expect(await asking).toBeNull()
      const leaveAgain = tab.subscribe(() => undefined)
      expect(tab.get()).toBe(LOADING)
      leaveAgain()
    }
  })

  it('a loader that throws counts as no connection', async () => {
    const tab = cached('home', () => Promise.reject(new Error('boom')))
    tab.subscribe(() => undefined)
    await tab.revalidate()
    expect(tab.get()).toEqual({ status: 'error', error: 'network' })
  })

  it('retry after an error shows loading and asks again', async () => {
    const { load, waiting } = loader<number>(failed)
    const tab = cached('progress', load)
    tab.subscribe(() => undefined)
    await tab.revalidate()
    tab.retry()
    expect(tab.get()).toBe(LOADING)
    waiting[0]?.resolve(ok(3))
    await vi.waitFor(() => {
      expect(tab.get()).toEqual({ status: 'ready', data: 3 })
    })
  })

  it('drop forgets the answer and ignores one already on its way', async () => {
    const { load, waiting } = loader(ok('before'))
    const tab = cached('home', load)
    await tab.revalidate()
    const late = tab.revalidate()
    tab.drop()
    expect(tab.get()).toBe(LOADING)
    waiting[0]?.resolve(ok('stale'))
    expect(await late).toBeNull()
    expect(tab.get()).toBe(LOADING)
  })

  it('drop on screen keeps the answer in view, ignores the one on its way, and asks again', async () => {
    const { load, waiting } = loader(ok(1), ok(1))
    const tab = cached('progress', load)
    await tab.revalidate()
    tab.drop()
    expect(load).toHaveBeenCalledTimes(1)
    expect(tab.get()).toBe(LOADING)
    await tab.revalidate()
    const leave = tab.subscribe(() => undefined)
    const late = tab.revalidate()
    tab.drop()
    expect(load).toHaveBeenCalledTimes(4)
    expect(tab.get()).toEqual({ status: 'ready', data: 1 })
    waiting[0]?.resolve(ok(99))
    expect(await late).toBeNull()
    waiting[1]?.resolve(ok(2))
    await vi.waitFor(() => {
      expect(tab.get()).toEqual({ status: 'ready', data: 2 })
    })
    leave()
  })

  it('set keeps what the page shows and ignores an older answer on its way', async () => {
    const { load, waiting } = loader<string[]>()
    const tab = cached('reminders', load)
    const old = tab.revalidate()
    tab.set(['shown'])
    waiting[0]?.resolve(ok([]))
    expect(await old).toBeNull()
    expect(tab.get()).toEqual({ status: 'ready', data: ['shown'] })
  })

  it('on a new day shows loading, never yesterday’s answer', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-05T18:00:00Z'))
    const tab = cached('home', loader(ok('monday'), failed).load)
    tab.subscribe(() => undefined)
    await tab.revalidate()
    expect(tab.get()).toEqual({ status: 'ready', data: 'monday' })
    vi.setSystemTime(new Date('2026-09-06T18:00:00Z'))
    expect(tab.get()).toBe(LOADING)
    await tab.revalidate()
    expect(tab.get()).toEqual({ status: 'error', error: 'network' })
  })
})

describe('dayStamp', () => {
  it('turns with their day and with the Pacific day', () => {
    const evening = dayStamp(new Date('2026-09-05T23:00:00-07:00'))
    expect(evening).toMatch(/\|2026-09-05$/)
    expect(dayStamp(new Date('2026-09-06T00:30:00-07:00'))).not.toBe(evening)
  })
})

describe('invalidation', () => {
  async function filled(key: TabKey) {
    const tab = cached(key, loader(ok(key), ok(key), ok(key)).load)
    await tab.revalidate()
    return tab
  }

  it('a write drops the tabs it changes, and only those', async () => {
    const home = await filled('home')
    const progress = await filled('progress')
    const reminders = await filled('reminders')
    noteWrite('/api/profile')
    expect(home.get()).toBe(LOADING)
    expect(progress.get()).toBe(LOADING)
    expect(reminders.get()).toEqual({ status: 'ready', data: 'reminders' })
  })

  it('a write that changes no tab, or an unknown path, drops nothing', async () => {
    const home = await filled('home')
    noteWrite('/api/voice-test')
    noteWrite('/api/admin/flagged')
    expect(home.get()).toEqual({ status: 'ready', data: 'home' })
  })

  it('invalidate and invalidateAll', async () => {
    const home = await filled('home')
    const reminders = await filled('reminders')
    invalidate(['reminders'])
    expect(reminders.get()).toBe(LOADING)
    expect(home.get().status).toBe('ready')
    invalidateAll()
    expect(home.get()).toBe(LOADING)
  })

  it('a reset drops every tab once per number', async () => {
    const home = await filled('home')
    invalidateForReset(7)
    expect(home.get()).toBe(LOADING)
    const progress = await filled('progress')
    invalidateForReset(7)
    expect(progress.get().status).toBe('ready')
    invalidateForReset(8)
    expect(progress.get()).toBe(LOADING)
  })

  it('every card answer, practice and profile change refreshes Home and Progress', () => {
    for (const write of [
      '/api/study/review',
      '/api/flags',
      '/api/tutor/practice',
      '/api/tutor/practice/coaching',
      '/api/practice/dispute',
      '/api/profile',
    ]) {
      expect(WRITE_EFFECTS[write]).toEqual(['home', 'progress'])
    }
  })
})

describe('refreshShown', () => {
  it('asks again for the tabs on screen; a new day drops every tab', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-05T18:00:00Z'))
    refreshShown()
    const shown = cached('home', loader(ok(1), ok(2), ok(3)).load)
    const hidden = cached('progress', loader(ok(1), ok(2)).load)
    await shown.revalidate()
    await hidden.revalidate()
    const leave = shown.subscribe(() => undefined)
    refreshShown()
    await vi.waitFor(() => {
      expect(shown.get()).toEqual({ status: 'ready', data: 2 })
    })
    expect(hidden.get()).toEqual({ status: 'ready', data: 1 })

    vi.setSystemTime(new Date('2026-09-06T18:00:00Z'))
    refreshShown()
    expect(hidden.get()).toBe(LOADING)
    await vi.waitFor(() => {
      expect(shown.get()).toEqual({ status: 'ready', data: 3 })
    })
    leave()
  })
})
