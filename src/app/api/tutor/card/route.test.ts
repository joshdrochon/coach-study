import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { loadBank } from '@/lib/content/bank'
import type { Db } from '@/lib/db/client'
import { traces } from '@/lib/db/schema'

import { TEST_ENV } from '../../../../../e2e/test-env'

let db: Db

beforeAll(async () => {
  for (const [key, value] of Object.entries(TEST_ENV)) {
    if (key !== 'NODE_ENV') vi.stubEnv(key, value)
  }
  vi.stubEnv('ANTHROPIC_API_KEY', '')
  const { getDb } = await import('@/lib/db/client')
  db = await getDb()
  await import('./route')
}, 60_000)

afterAll(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/tutor/card', () => {
  it('keys every trace on the server: a reused x-correlation-id is kept as data and never collides', async () => {
    const { POST } = await import('./route')
    const [item] = loadBank().items
    if (!item) throw new Error('the bank is empty')

    const body = { itemId: item.id, answer: 'xyzzy', answerMs: 3000, hintUsed: false }
    const send = () =>
      POST(
        new NextRequest('http://127.0.0.1:3000/api/tutor/card', {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'x-correlation-id': 'same-id-twice' },
        }),
      )
    const first = await send()
    const second = await send()
    expect([first.status, second.status]).toEqual([503, 503])
    expect(await second.json()).toEqual({ error: 'misconfigured', fallback: 'self-grade' })
    const rows = await db.select().from(traces)
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((row) => row.id)).size).toBe(2)
    expect(rows.some((row) => row.id === 'same-id-twice')).toBe(false)
    expect(rows.map((row) => row.result)).toEqual([
      { correlationId: 'same-id-twice' },
      { correlationId: 'same-id-twice' },
    ])
  })

  it('rejects chat without item or practice id', async () => {
    const { POST } = await import('./route')
    const before = (await db.select().from(traces)).length
    const send = (body: unknown) =>
      POST(
        new NextRequest('http://127.0.0.1:3000/api/tutor/card', {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      )
    const chat = { answer: 'What should I eat before a workout?', answerMs: 3000, hintUsed: false }
    expect((await send(chat)).status).toBe(400)
    expect((await send({ ...chat, itemId: '' })).status).toBe(404)
    expect((await send({ ...chat, itemId: 'not-a-card' })).status).toBe(404)
    expect((await db.select().from(traces)).length).toBe(before)
  })
})
