import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { SESSION_COOKIE, signSession } from '@/lib/auth/session'
import type { Db } from '@/lib/db/client'
import { counters, traces } from '@/lib/db/schema'
import { MIC_REPORT_PATH, MIC_REPORTS_PER_MINUTE, type MicReport } from '@/lib/speech/mic-report'
import { proxy } from '@/proxy'

import { TEST_ENV } from '../../../../../e2e/test-env'

const NOON = new Date('2026-08-18T19:00:20Z')

const REPORT: MicReport = {
  reason: 'ended-early',
  endOn: 'release',
  atMs: 2400,
  restarts: 0,
  firstResultMs: 700,
  app: 'home-screen',
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
    new NextRequest(`http://127.0.0.1:3000${MIC_REPORT_PATH}`, {
      method: 'POST',

      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )
}

describe('POST /api/mic/report', () => {
  it('keeps the report as a mic trace: reason, timing, how it was listening, the server', async () => {
    const response = await send(REPORT)
    expect(response.status).toBe(204)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await db.select().from(traces)).toEqual([
      {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
        kind: 'mic',
        startedAt: new Date(NOON.getTime() - 2400),
        totalMs: 2400,
        costUsd: 0,
        outcome: 'error',
        steps: [{ name: 'first word', ms: 700 }],
        result: {
          source: 'ipad',
          env: 'local',
          reason: 'ended-early',
          endOn: 'release',
          restarts: 0,
          app: 'home-screen',
        },
        error: 'ended-early',
      },
    ])
  })

  it('keeps every reason the iPad can give, a recognizer error among them', async () => {
    const reasons = ['ended-early', 'restart-failed', 'start-failed', 'error-no-speech'] as const
    for (const reason of reasons) {
      expect((await send({ ...REPORT, reason, firstResultMs: null })).status).toBe(204)
    }
    const kept = await db.select({ error: traces.error, steps: traces.steps }).from(traces)
    expect(kept.map((row) => row.error).sort()).toEqual([...reasons].sort())
    expect(kept.every((row) => Array.isArray(row.steps) && row.steps.length === 0)).toBe(true)
  })

  it('never keeps their words, even when a report carries them', async () => {
    expect((await send({ ...REPORT, transcript: 'a mat' })).status).toBe(204)
    expect(JSON.stringify(await db.select().from(traces))).not.toContain('a mat')
  })

  it('refuses what isn’t a report: 400, nothing kept', async () => {
    const bad: unknown[] = [
      'not json',
      {},
      { ...REPORT, reason: 'because' },
      { ...REPORT, reason: 'error-' },
      { ...REPORT, reason: 'error-Has Words In It' },
      { ...REPORT, endOn: 'forever' },
      { ...REPORT, atMs: -1 },
      { ...REPORT, atMs: 2.5 },
      { ...REPORT, app: 'android' },
    ]
    for (const body of bad) {
      const response = await send(body)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'invalid' })
    }
    expect(await db.select().from(traces)).toEqual([])
  })

  it(`rate-limited: ${String(MIC_REPORTS_PER_MINUTE)} a minute, then 429 and nothing kept`, async () => {
    for (let i = 0; i < MIC_REPORTS_PER_MINUTE; i++) expect((await send(REPORT)).status).toBe(204)
    const over = await send(REPORT)
    expect(over.status).toBe(429)
    expect(await db.select().from(traces)).toHaveLength(MIC_REPORTS_PER_MINUTE)
    vi.setSystemTime(new Date(NOON.getTime() + 60_000))
    expect((await send(REPORT)).status).toBe(204)
  })

  it('is behind their passcode like every route: 401 without a session', async () => {
    const url = `http://127.0.0.1:3000${MIC_REPORT_PATH}`
    const stranger = await proxy(new NextRequest(url, { method: 'POST' }))
    expect(stranger.status).toBe(401)
    const cookie = `${SESSION_COOKIE.app}=${await signSession('app', TEST_ENV.SESSION_SECRET ?? '')}`
    const learner = await proxy(new NextRequest(url, { method: 'POST', headers: { cookie } }))
    expect(learner.headers.get('x-middleware-next')).toBe('1')
  })
})
