import { sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { SESSION_COOKIE, signSession } from '@/lib/auth/session'
import type { Db } from '@/lib/db/client'
import { counters, traces } from '@/lib/db/schema'
import { FALLBACK_REPORTS_PER_MINUTE } from '@/lib/tts/clips'
import { FALLBACK_REPORT_PATH, type FallbackReport } from '@/lib/tts/fallback'
import { proxy } from '@/proxy'

import { TEST_ENV } from '../../../../../e2e/test-env'

const KEY = 'test-elevenlabs-key-not-real' // gitleaks:allow (a fake key; nothing is called)
const NOON = new Date('2026-08-18T19:00:20Z')

const REPORT: FallbackReport = {
  reason: 'start-timeout',
  chars: 36,
  atMs: 2500,
  replayMs: null,
  requestMs: 4,
  headersMs: null,
  blobMs: null,
  playMs: null,
}

let db: Db

beforeAll(async () => {
  for (const [key, value] of Object.entries(TEST_ENV)) {
    if (key !== 'NODE_ENV') vi.stubEnv(key, value)
  }
  const { getDb } = await import('@/lib/db/client')
  db = await getDb()
  await import('./route')
}, 60_000)

afterAll(() => {
  vi.unstubAllEnvs()
})

beforeEach(async () => {
  await db.delete(traces)
  await db.delete(counters)
  vi.stubEnv('ELEVENLABS_API_KEY', KEY)

  vi.stubEnv('VERCEL_ENV', '')

  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOON)
})

afterEach(() => {
  vi.useRealTimers()
})

async function send(body: unknown): Promise<Response> {
  const { POST } = await import('./route')
  return POST(
    new NextRequest(`http://127.0.0.1:3000${FALLBACK_REPORT_PATH}`, {
      method: 'POST',

      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )
}

describe('POST /api/tts/fallback', () => {
  it('keeps the report as a tts fallback trace: the reason, the steps reached, the line’s length', async () => {
    const response = await send({ ...REPORT, headersMs: 2100, blobMs: 2300, playMs: 2301 })
    expect(response.status).toBe(204)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const rows = await db.select().from(traces)
    expect(rows).toEqual([
      {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
        kind: 'tts',

        startedAt: new Date(NOON.getTime() - 2500),
        totalMs: 2500,
        costUsd: 0,
        outcome: 'fallback',
        steps: [
          { name: 'request sent', ms: 4 },
          { name: 'headers received', ms: 2100 },
          { name: 'blob received', ms: 2300 },
          { name: 'play called', ms: 2301 },
        ],
        result: { source: 'ipad', env: 'local', reason: 'start-timeout', chars: 36 },
        error: 'start-timeout',
      },
    ])
  })

  it('stamps the server that kept it, from its own environment, never from the report', async () => {
    expect((await send({ ...REPORT, env: 'production', source: 'server' })).status).toBe(204)
    vi.stubEnv('VERCEL_ENV', 'production')
    expect((await send({ ...REPORT, reason: 'status-503', env: 'local' })).status).toBe(204)
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect((await send({ ...REPORT, reason: 'network' })).status).toBe(204)
    const kept = (await db.select({ result: traces.result }).from(traces)).map((row) => row.result)
    expect(kept).toHaveLength(3)
    expect(kept).toEqual(
      expect.arrayContaining([
        { source: 'ipad', env: 'local', reason: 'start-timeout', chars: 36 },
        { source: 'ipad', env: 'production', reason: 'status-503', chars: 36 },
        { source: 'ipad', env: 'preview', reason: 'network', chars: 36 },
      ]),
    )
  })

  it('The read query finds the reports production kept and leaves out a local server’s', async () => {
    expect((await send({ ...REPORT, reason: 'network' })).status).toBe(204)
    vi.stubEnv('VERCEL_ENV', 'production')
    expect((await send({ ...REPORT, reason: 'status-503' })).status).toBe(204)

    const own = await db
      .select({ error: traces.error })
      .from(traces)
      .where(sql`kind = 'tts' and result->>'source' = 'ipad' and result->>'env' = 'production'`)
    expect(own).toEqual([{ error: 'status-503' }])
  })

  it('keeps every reason the iPad can give, a status among them', async () => {
    const reasons = [
      'start-timeout',
      'status-503',
      'status-429',
      'not-audio',
      'play-refused',
      'play-error',
      'mid-line',
      'network',
      'too-long',
    ] as const
    for (const reason of reasons) expect((await send({ ...REPORT, reason })).status).toBe(204)
    const kept = await db.select({ error: traces.error }).from(traces)
    expect(kept.map((row) => row.error).sort()).toEqual([...reasons].sort())
  })

  it('never keeps the line’s words, even when a report carries them', async () => {
    const words = 'Sample move a: which parts carry it?'
    expect((await send({ ...REPORT, text: words })).status).toBe(204)
    const rows = await db.select().from(traces)
    expect(rows).toHaveLength(1)
    expect(JSON.stringify(rows)).not.toContain('Sample move a')
  })

  it('refuses what isn’t a report: 400, nothing kept', async () => {
    const bad: unknown[] = [
      'not json',
      {},
      { ...REPORT, reason: 'because' },
      { ...REPORT, reason: 'status-99' },
      { ...REPORT, reason: 'status-5031' },
      { ...REPORT, atMs: -1 },
      { ...REPORT, atMs: 2.5 },
      { ...REPORT, requestMs: undefined },
      { ...REPORT, chars: '36' },
    ]
    for (const body of bad) {
      const response = await send(body)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'invalid' })
    }
    expect(await db.select().from(traces)).toEqual([])
  })

  it(`rate-limited like the other routes: ${String(FALLBACK_REPORTS_PER_MINUTE)} a minute, then 429 and nothing kept`, async () => {
    for (let i = 0; i < FALLBACK_REPORTS_PER_MINUTE; i++) {
      expect((await send(REPORT)).status).toBe(204)
    }
    const over = await send(REPORT)
    expect(over.status).toBe(429)
    expect(await over.json()).toEqual({ error: 'rate-limited' })
    expect(await db.select().from(traces)).toHaveLength(FALLBACK_REPORTS_PER_MINUTE)

    vi.setSystemTime(new Date(NOON.getTime() + 60_000))
    expect((await send(REPORT)).status).toBe(204)
  })

  it('without a voice key: 204 and nothing kept (every line is the iPad’s own voice by design)', async () => {
    vi.stubEnv('ELEVENLABS_API_KEY', '')
    expect((await send(REPORT)).status).toBe(204)
    expect((await send('not json')).status).toBe(204)
    expect(await db.select().from(traces)).toEqual([])
    expect(await db.select().from(counters)).toEqual([])
  })

  it('is behind their passcode like every route: 401 without a session', async () => {
    const url = `http://127.0.0.1:3000${FALLBACK_REPORT_PATH}`
    const stranger = await proxy(new NextRequest(url, { method: 'POST' }))
    expect(stranger.status).toBe(401)
    const cookie = `${SESSION_COOKIE.app}=${await signSession('app', TEST_ENV.SESSION_SECRET ?? '')}`
    const learner = await proxy(new NextRequest(url, { method: 'POST', headers: { cookie } }))
    expect(learner.headers.get('x-middleware-next')).toBe('1')
  })
})
