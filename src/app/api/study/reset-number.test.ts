import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Db } from '@/lib/db/client'
import {
  disputes,
  itemFlags,
  practicePhases,
  practices,
  profile,
  reviewEvents,
} from '@/lib/db/schema'
import { syncResponseSchema, type ReviewEvent } from '@/lib/study/contract'
import { loadDeck } from '@/lib/study/deck'
import { EPOCH_HEADER } from '@/lib/study/epoch'

import { TEST_ENV } from '../../../../e2e/test-env'

const BASE = 'http://127.0.0.1:3000'
const ITEM = loadDeck().metas[0]?.itemId ?? ''
let db: Db

beforeAll(async () => {
  for (const [key, value] of Object.entries(TEST_ENV)) {
    if (key !== 'NODE_ENV') vi.stubEnv(key, value)
  }

  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-that-cannot-authenticate')
  const { getDb } = await import('@/lib/db/client')
  db = await getDb()
}, 60_000)

afterAll(() => {
  vi.unstubAllEnvs()
})

type Post = (request: NextRequest) => Promise<Response>

const ROUTES: Record<string, () => Promise<{ POST: Post }>> = {
  '/api/study/review': () => import('./review/route'),
  '/api/flags': () => import('../flags/route'),
}

async function post(
  path: string,
  body: unknown,
  epoch?: string,
): Promise<{ status: number; body: unknown }> {
  const route = ROUTES[path]
  if (!route) throw new Error(`no route ${path}`)
  const { POST } = await route()
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (epoch !== undefined) headers[EPOCH_HEADER] = epoch
  const response = await POST(
    new NextRequest(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) }),
  )
  return { status: response.status, body: await response.json() }
}

function answer(): ReviewEvent {
  return {
    eventId: randomUUID(),
    itemId: ITEM,
    mode: 'start',
    result: 'right',
    rating: 3,
    proposedRating: 3,
    overridden: false,
    answerText: 'their answer',
    answerMs: 5000,
    hintUsed: false,
    gradedBy: 'self',
    traceId: null,
    reviewedAt: new Date().toISOString(),
  }
}

async function storedAnswer(id: string): Promise<boolean> {
  const rows = await db.select().from(reviewEvents).where(eq(reviewEvents.id, id))
  return rows.length === 1
}

async function syncEpoch(): Promise<number> {
  const { GET } = await import('./sync/route')
  const response = await GET(new NextRequest(`${BASE}/api/study/sync`))
  return syncResponseSchema.parse(await response.json()).epoch
}

async function bump(to: number): Promise<void> {
  await db
    .insert(profile)
    .values({ id: 1, dataEpoch: to })
    .onConflictDoUpdate({ target: profile.id, set: { dataEpoch: to } })
}

describe('the reset number on the server', () => {
  it('before any wipe (0): writes with or without a number are taken', async () => {
    expect(await syncEpoch()).toBe(0)
    const without = answer()
    expect((await post('/api/study/review', without)).status).toBe(200)
    const withZero = answer()
    expect((await post('/api/study/review', withZero, '0')).status).toBe(200)
    expect(await storedAnswer(without.eventId)).toBe(true)
    expect(await storedAnswer(withZero.eventId)).toBe(true)
  })

  it('after a wipe: an older number, none, or another is refused (409 reset) and nothing is stored', async () => {
    await bump(1)
    expect(await syncEpoch()).toBe(1)
    for (const epoch of [undefined, '0', '2', 'one']) {
      const old = answer()
      const refused = await post('/api/study/review', old, epoch)
      expect(refused).toEqual({ status: 409, body: { error: 'reset', epoch: 1 } })
      expect(await storedAnswer(old.eventId)).toBe(false)
    }
    const fresh = answer()
    expect((await post('/api/study/review', fresh, '1')).status).toBe(200)
    expect(await storedAnswer(fresh.eventId)).toBe(true)

    expect((await post('/api/study/review', fresh, '1')).status).toBe(409)
    expect((await post('/api/study/review', fresh, '1')).body).toEqual({ error: 'duplicate' })
  })

  it('every study write is refused before its body is even read: notes, practices, coaching, disputes', async () => {
    await bump(2)
    const practicesBefore = (await db.select().from(practices)).length
    const phasesBefore = (await db.select().from(practicePhases)).length
    const disputesBefore = (await db.select().from(disputes)).length
    for (const path of Object.keys(ROUTES)) {
      for (const epoch of [undefined, '1']) {
        expect(await post(path, { anything: true }, epoch)).toEqual({
          status: 409,
          body: { error: 'reset', epoch: 2 },
        })
      }
    }
    const note = { itemId: ITEM, note: 'looks wrong', flagId: randomUUID() }
    expect((await post('/api/flags', note, '1')).status).toBe(409)
    expect(await db.select().from(itemFlags).where(eq(itemFlags.itemId, ITEM))).toEqual([])
    expect((await db.select().from(practices)).length).toBe(practicesBefore)
    expect((await db.select().from(practicePhases)).length).toBe(phasesBefore)
    expect((await db.select().from(disputes)).length).toBe(disputesBefore)

    for (const path of Object.keys(ROUTES)) {
      expect((await post(path, { anything: true }, '2')).status).toBe(400)
    }
  })

  it('no route can change the number: only the wipe script writes it', async () => {
    await bump(3)
    const { POST } = await import('../profile/route')
    const response = await POST(
      new NextRequest(`${BASE}/api/profile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Practitioner', dataEpoch: 0, data_epoch: 0 }),
      }),
    )
    expect(response.status).toBeLessThan(500)
    expect(await syncEpoch()).toBe(3)
  })
})
