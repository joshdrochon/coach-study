import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { loadBank } from '@/lib/content/bank'
import type { Db } from '@/lib/db/client'
import { cardStates, disputes, itemFlags, reviewEvents } from '@/lib/db/schema'
import { posted, T0 } from '@/test/study-fixtures'

import { TEST_ENV } from '../../../../e2e/test-env'

vi.mock('@/lib/tutor/card', async (original) => ({
  ...(await original<typeof import('@/lib/tutor/card')>()),
  askCardRegrade: vi.fn(() =>
    Promise.resolve({
      value: {
        result: 'right',
        missing: [],
        reason: 'The learner named every part the card names.',
      },
      model: 'claude-opus-5-5',
      usage: { input_tokens: 2000, output_tokens: 300 },
    }),
  ),
}))

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
  await db.delete(disputes)
  await db.delete(itemFlags)
  await db.delete(reviewEvents)
  await db.delete(cardStates)
})

const itemId = (): string => {
  const [item] = loadBank().items
  if (!item) throw new Error('the bank is empty')
  return item.id
}

async function send(body: unknown): Promise<number> {
  const { POST } = await import('./route')
  const response = await POST(
    new NextRequest('http://127.0.0.1:3000/api/flags', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  )
  return response.status
}

describe('POST /api/flags', () => {
  it('stores a note sent again with the same ID once (their outbox retries after a timeout)', async () => {
    const note = {
      itemId: itemId(),
      note: 'my trainer said sample move a works the groupB too',
      flagId: '0b7c6a8e-3f2d-4c1b-9a5e-6d4f3e2a1b0c',
    }
    expect([await send(note), await send(note), await send(note)]).toEqual([200, 200, 200])
    const rows = await db.select().from(disputes)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'card', itemId: note.itemId, note: note.note })
    expect(rows[0]?.flagId).toBe(note.flagId)
    expect(await db.select().from(itemFlags)).toHaveLength(1)

    await send({ ...note, note: 'and the side', flagId: '1c8d7b9f-4e3a-4d2c-8b6f-7e5a4f3b2c1d' })
    expect(await db.select().from(disputes)).toHaveLength(2)
  })

  it('still takes notes from an older copy of the app that sends no ID, as they come', async () => {
    const note = { itemId: itemId(), note: 'no id' }
    expect([await send(note), await send(note)]).toEqual([200, 200])
    const rows = await db.select().from(disputes)
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.flagId)).toEqual([null, null])
  })

  it('re-grades a note sent with their answer, and corrects their grade once their answer arrives', async () => {
    const item = 'term-range'
    const answer = {
      text: 'a mat, a strap and the rollers',
      reviewedAt: T0.toISOString(),
      result: 'partial',
      gradedBy: 'tutor',
    }
    const flagId = '2d9e8c0a-5f4b-4e3d-9c7a-8f6b5a4c3d2e'
    expect(await send({ itemId: item, note: 'it heard me wrong', flagId, answer })).toBe(200)

    await vi.waitFor(async () => {
      const [row] = await db.select().from(disputes)
      expect(row?.regrade).toMatchObject({ status: 'done' })
    })
    const [row] = await db.select().from(disputes)
    expect(row?.regrade).toMatchObject({
      was: 'partial',
      now: 'right',
      reason: 'The learner named every part the card names.',
      correction: { status: 'waiting', reviewedAt: T0.toISOString() },
    })

    const { POST } = await import('../study/review/route')
    const review = await POST(
      new NextRequest('http://127.0.0.1:3000/api/study/review', {
        method: 'POST',
        body: JSON.stringify(
          posted({ itemId: item, result: 'partial', rating: 2, proposedRating: 2 }),
        ),
      }),
    )
    expect(review.status).toBe(200)
    const events = await db.select().from(reviewEvents)
    expect(events).toHaveLength(2)
    expect(events.find((event) => event.overridden)).toMatchObject({
      deviceId: 'opus-regrade',
      result: 'right',
      rating: 3,
    })
    expect((await db.select().from(disputes))[0]?.regrade).toMatchObject({
      correction: { status: 'applied', rating: 3 },
    })

    expect((await db.select().from(itemFlags))[0]?.resolvedAt).toBeNull()
  })

  it('keeps a note whose answer doesn’t parse, without a re-grade (their flag is never lost)', async () => {
    const answer = { text: 'x', reviewedAt: 'yesterday', result: 'partial', gradedBy: 'tutor' }
    expect(await send({ itemId: itemId(), note: 'x', answer })).toBe(200)
    expect(
      await send({ itemId: itemId(), note: 'y', answer: { ...answer, result: 'great' } }),
    ).toBe(200)
    const rows = await db.select().from(disputes)
    expect(rows.map((row) => [row.note, row.regrade])).toEqual([
      ['x', null],
      ['y', null],
    ])
    expect(await db.select().from(itemFlags)).toHaveLength(1)
  })

  it('turns away an ID that isn’t one the app makes, and a card it doesn’t have', async () => {
    expect(await send({ itemId: itemId(), note: 'x', flagId: 'not-a-uuid' })).toBe(400)
    expect(await send({ itemId: 'no-such-card', note: 'x' })).toBe(404)
    expect(await db.select().from(disputes)).toHaveLength(0)
  })
})
