import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '@/lib/db/client'
import { gateResults, practices, profile, reviewEvents } from '@/lib/db/schema'
import { progressSchema } from '@/lib/progress/client'
import { homeViewSchema } from '@/lib/study/contract'
import { DAY, photoVersion, T0 } from '@/test/study-fixtures'

import { TEST_ENV } from '../../../../e2e/test-env'

const BASE = 'http://127.0.0.1:3000'
let db: Db

beforeAll(async () => {
  for (const [key, value] of Object.entries(TEST_ENV)) {
    if (key !== 'NODE_ENV') vi.stubEnv(key, value)
  }
  const { getDb } = await import('@/lib/db/client')
  db = await getDb()
  await Promise.all([
    import('./route'),
    import('../admin/learning/route'),
    import('../profile/route'),
    import('../avatar/route'),
    import('../home/route'),
    import('../study/review/route'),
  ])
  vi.useFakeTimers({ toFake: ['Date'] })
}, 60_000)

afterAll(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

beforeEach(async () => {
  await db.delete(reviewEvents)
  await db.delete(gateResults)
  await db.delete(practices)
  await db.delete(profile)
  vi.setSystemTime(T0)
})

async function json(response: Response): Promise<unknown> {
  return response.json()
}

async function getProgress() {
  const { GET } = await import('./route')
  const response = await GET()
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  return progressSchema.parse(await json(response))
}

async function postProfile(body: unknown): Promise<{ status: number; body: unknown }> {
  const { POST } = await import('../profile/route')
  const response = await POST(
    new NextRequest(`${BASE}/api/profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )
  return { status: response.status, body: await json(response) }
}

describe('GET /api/progress', () => {
  it('is day one before the learner studies', async () => {
    const view = await getProgress()
    expect(view).toMatchObject({
      name: 'Coach Alex',
      title: 'Starter',
      avatarUrl: '/api/avatar?v=default',
      practiceSessions: { done: 0, of: 3 },
      practiceClasses: { done: 0, of: 10 },
      isDayOne: true,
      practices: [],
    })
  })
})

describe('POST /api/profile', () => {
  it('keeps the title and photo changes working, and records the welcome once', async () => {
    const photo = Buffer.from('their photo').toString('base64')
    expect((await postProfile({ title: 'Practitioner', avatarJpegBase64: photo })).status).toBe(200)
    expect((await postProfile({ welcomed: true })).status).toBe(200)
    vi.setSystemTime(new Date(T0.getTime() + DAY))
    expect((await postProfile({ welcomed: true })).status).toBe(200)
    const [row] = await db.select().from(profile)
    expect(row).toMatchObject({ title: 'Practitioner', avatarJpegBase64: photo, welcomedAt: T0 })
    expect((await getProgress()).avatarUrl).toBe(`/api/avatar?v=${photoVersion(photo)}`)
  })

  it('GET says whether the learner has seen the welcome, kept with their data', async () => {
    const { GET } = await import('../profile/route')
    const before = await GET()
    expect(before.headers.get('cache-control')).toBe('no-store')
    expect(await json(before)).toEqual({ welcomed: false })
    await postProfile({ title: 'Practitioner' })
    expect(await json(await GET())).toEqual({ welcomed: false })
    await postProfile({ welcomed: true })
    expect(await json(await GET())).toEqual({ welcomed: true })
  })

  it('refuses an empty or out-of-range change', async () => {
    for (const body of [
      {},
      { practiceSessionsDone: 4 },
      { practiceClassesDone: 11 },
      { welcomed: false },
    ]) {
      expect(await postProfile(body)).toEqual({ status: 400, body: { error: 'invalid' } })
    }
    expect((await postProfile('{oops')).status).toBe(400)
    expect(await db.select().from(profile)).toEqual([])
  })
})

describe('their photo', () => {
  async function getAvatar(search: string) {
    const { GET } = await import('../avatar/route')
    return GET(new NextRequest(`${BASE}/api/avatar${search}`))
  }

  it('answers at its versioned address, and Home links to the same one', async () => {
    const photo = Buffer.from('their photo').toString('base64')
    await postProfile({ avatarJpegBase64: photo })
    const version = photoVersion(photo)
    const current = await getAvatar(`?v=${version}`)
    expect(current.status).toBe(200)
    expect(current.headers.get('content-type')).toBe('image/jpeg')
    expect(current.headers.get('cache-control')).toContain('immutable')
    expect(Buffer.from(await current.arrayBuffer()).toString('base64')).toBe(photo)

    for (const search of ['?v=default', '']) {
      const stale = await getAvatar(search)
      expect(stale.status).toBe(200)
      expect(stale.headers.get('cache-control')).toBe('private, max-age=300')
      expect(Buffer.from(await stale.arrayBuffer()).toString('base64')).toBe(photo)
    }
    const { GET } = await import('../home/route')
    const home = homeViewSchema.parse(await json(await GET(new NextRequest(`${BASE}/api/home`))))
    expect(home.avatarUrl).toBe(`/api/avatar?v=${version}`)
  })

  it('serves the default photo before the learner picks one', async () => {
    const response = await getAvatar('?v=default')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('immutable')
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(1000)
  })
})

describe('the passcode gates', () => {
  it('Progress and the profile need their session; the Learning tab needs the admin one', async () => {
    const { proxy } = await import('@/proxy')
    const { SESSION_COOKIE, signSession } = await import('@/lib/auth/session')
    const secret = TEST_ENV.SESSION_SECRET ?? ''
    const app = `${SESSION_COOKIE.app}=${await signSession('app', secret)}`
    const admin = `${SESSION_COOKIE.admin}=${await signSession('admin', secret)}`
    const status = async (path: string, cookie?: string) =>
      (
        await proxy(
          new NextRequest(`${BASE}${path}`, cookie === undefined ? {} : { headers: { cookie } }),
        )
      ).status
    for (const path of ['/api/progress', '/api/profile', '/api/avatar?v=default']) {
      expect(await status(path)).toBe(401)
      expect(await status(path, app)).toBe(200)
    }
    expect(await status('/api/admin/learning')).toBe(401)
    expect(await status('/api/admin/learning', app)).toBe(401)
    expect(await status('/api/admin/learning', admin)).toBe(200)
  })
})
