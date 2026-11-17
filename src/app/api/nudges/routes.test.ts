import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Db } from '@/lib/db/client'
import { nudges, pushSubscriptions } from '@/lib/db/schema'
import { nudgeRunSchema } from '@/lib/nudges/contract'
import { recentNudges } from '@/lib/nudges/log'
import { listSubscriptions } from '@/lib/nudges/subscriptions'
import { fakeDevice, fakePushService, throwawayPushKeys } from '@/test/web-push'

import { TEST_ENV } from '../../../../e2e/test-env'

const BASE = 'http://127.0.0.1:3000'
const SECRET = 'nudge-secret-for-this-test-only-0123456789abcdef'
const keys = throwawayPushKeys()
let db: Db

function useEnv(overrides: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = {
    ...TEST_ENV,
    VAPID_PUBLIC_KEY: keys.publicKey,
    VAPID_PRIVATE_KEY: keys.privateKey,
    VAPID_SUBJECT: keys.subject,
    NUDGE_SECRET: SECRET,
    ...overrides,
  }
  for (const [key, value] of Object.entries(env)) {
    if (key !== 'NODE_ENV') vi.stubEnv(key, value)
  }
}

beforeAll(async () => {
  useEnv()
  const { getDb } = await import('@/lib/db/client')
  db = await getDb()
  await Promise.all([import('./send/route'), import('./subscription/route')])
  vi.useFakeTimers({ toFake: ['Date'] })
}, 60_000)

afterAll(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

beforeEach(async () => {
  useEnv()
  await db.delete(nudges)
  await db.delete(pushSubscriptions)
  vi.setSystemTime(new Date('2026-08-17T16:07:00Z'))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function send(headers: Record<string, string> = {}) {
  const { POST } = await import('./send/route')
  const response = await POST(
    new NextRequest(`${BASE}/api/nudges/send`, { method: 'POST', headers }),
  )
  return { status: response.status, body: (await response.json()) as unknown, response }
}

async function subscription(method: 'POST' | 'DELETE', body: unknown) {
  const route = await import('./subscription/route')
  const handler = method === 'POST' ? route.POST : route.DELETE
  const response = await handler(
    new NextRequest(`${BASE}/api/nudges/subscription`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )
  return { status: response.status, body: (await response.json()) as unknown }
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

describe('POST /api/nudges/send (the hourly job)', () => {
  it('refuses a call without the right token: no header, wrong token, wrong scheme', async () => {
    for (const headers of [
      {},
      bearer('not-the-secret'),
      bearer(`${SECRET}x`),
      { authorization: `Basic ${SECRET}` },
      { authorization: SECRET },
    ]) {
      const { status, body, response } = await send(headers)
      expect(status).toBe(401)
      expect(body).toEqual({ error: 'unauthorized' })
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
  })

  it('refuses every call when the server has no NUDGE_SECRET', async () => {
    useEnv({ NUDGE_SECRET: undefined })
    expect((await send(bearer(SECRET))).status).toBe(401)
    expect((await send(bearer(''))).status).toBe(401)
  })

  it('answers 503 when the push keys aren’t set', async () => {
    useEnv({ VAPID_PRIVATE_KEY: undefined })
    expect(await send(bearer(SECRET))).toMatchObject({
      status: 503,
      body: { error: 'push-not-configured' },
    })
  })

  it('sends their reminder through the push service, encrypted for their device', async () => {
    const device = fakeDevice()
    expect(await subscription('POST', device.subscription)).toEqual({
      status: 200,
      body: { ok: true },
    })
    const service = fakePushService()
    vi.stubGlobal('fetch', service.fetch)

    const { status, body } = await send(bearer(SECRET))
    expect(status).toBe(200)
    expect(nudgeRunSchema.parse(body)).toEqual({
      outcome: 'sent',
      reason: 'not-studied',
      delivered: 1,
      failed: 0,
      removed: 0,
    })

    expect(JSON.stringify(body)).not.toContain(device.subscription.endpoint)
    expect(JSON.stringify(body)).not.toContain(SECRET)

    const [push] = service.received
    if (!push) throw new Error('nothing was pushed')
    expect(push.endpoint).toBe(device.subscription.endpoint)
    expect(JSON.parse(device.decrypt(push.body))).toEqual({
      title: 'Two days to practice day.',

      body: '100 cards for today. Start when you’re ready.',
      url: '/',
      tag: 'coach-study-reminder',
    })
    expect((await recentNudges(db))[0]).toMatchObject({ status: 'sent', delivered: 1 })

    vi.setSystemTime(new Date('2026-08-17T17:07:00Z'))
    expect((await send(bearer(SECRET))).body).toMatchObject({
      outcome: 'skipped',
      reason: 'too-soon',
    })
    expect(service.received).toHaveLength(1)
  })

  it('removes a device Apple says is gone', async () => {
    const device = fakeDevice()
    await subscription('POST', device.subscription)
    vi.stubGlobal('fetch', fakePushService(() => 410).fetch)
    expect((await send(bearer(SECRET))).body).toMatchObject({
      outcome: 'failed',
      removed: 1,
    })
    expect(await listSubscriptions(db)).toEqual([])
  })

  it('stays quiet at night', async () => {
    await subscription('POST', fakeDevice().subscription)
    const service = fakePushService()
    vi.stubGlobal('fetch', service.fetch)
    vi.setSystemTime(new Date('2026-08-18T04:30:00Z'))
    expect((await send(bearer(SECRET))).body).toMatchObject({
      outcome: 'skipped',
      reason: 'quiet-hours',
    })
    expect(service.received).toEqual([])
  })
})

describe('/api/nudges/subscription (Turn on reminders, Turn off reminders)', () => {
  it('saves their device and turns it off again', async () => {
    const device = fakeDevice()
    expect((await subscription('POST', device.subscription)).status).toBe(200)
    expect((await listSubscriptions(db)).map((s) => s.endpoint)).toEqual([
      device.subscription.endpoint,
    ])
    expect(await subscription('DELETE', { endpoint: device.subscription.endpoint })).toEqual({
      status: 200,
      body: { ok: true },
    })
    expect(await listSubscriptions(db)).toEqual([])

    expect((await subscription('DELETE', { endpoint: device.subscription.endpoint })).status).toBe(
      200,
    )
  })

  it('refuses what isn’t a push subscription from a known push service', async () => {
    const { subscription: valid } = fakeDevice()
    for (const body of [
      'not json',
      {},
      { ...valid, endpoint: 'https://example.com/collect' },
      { ...valid, endpoint: 'http://web.push.apple.com/abc' },
      { ...valid, keys: { ...valid.keys, auth: 'short' } },
    ]) {
      expect(await subscription('POST', body)).toEqual({ status: 400, body: { error: 'invalid' } })
    }
    expect(await subscription('DELETE', {})).toEqual({ status: 400, body: { error: 'invalid' } })
    expect(await listSubscriptions(db)).toEqual([])
  })

  it('answers 503 when the server has no push keys, so the iPad doesn’t think it worked', async () => {
    useEnv({ VAPID_PUBLIC_KEY: undefined })
    expect(await subscription('POST', fakeDevice().subscription)).toEqual({
      status: 503,
      body: { error: 'push-not-configured' },
    })
  })
})

describe('GET /api/nudges/subscription (the key Progress asks for)', () => {
  it('answers the public key, never the private one, and null when push is off', async () => {
    const { GET } = await import('./subscription/route')
    const on = GET()
    expect(on.headers.get('cache-control')).toBe('no-store')
    const body = (await on.json()) as unknown
    expect(body).toEqual({ publicKey: keys.publicKey })
    expect(JSON.stringify(body)).not.toContain(keys.privateKey)
    useEnv({ VAPID_PRIVATE_KEY: undefined })
    expect(await GET().json()).toEqual({ publicKey: null })
  })
})
