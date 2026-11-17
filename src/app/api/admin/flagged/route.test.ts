import { randomUUID } from 'node:crypto'

import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { loadBank } from '@/lib/content/bank'
import type { Db } from '@/lib/db/client'
import { disputes, evalCaseDrafts, itemFlags } from '@/lib/db/schema'
import { MODELS } from '@/lib/grader/models'
import { flaggedViewSchema, recordDraftCase } from '@/lib/study/flag-cases'
import { T0 } from '@/test/study-fixtures'

import { TEST_ENV } from '../../../../../e2e/test-env'

let db: Db
const ITEM = 'term-range'
const WORDS = 'a mat a strapAnd rollers… on the front whale '

beforeAll(async () => {
  for (const [key, value] of Object.entries(TEST_ENV)) {
    if (key !== 'NODE_ENV') vi.stubEnv(key, value)
  }
  const { getDb } = await import('@/lib/db/client')
  db = await getDb()
}, 60_000)

afterAll(() => {
  vi.unstubAllEnvs()
})

beforeEach(async () => {
  await db.delete(evalCaseDrafts)
  await db.delete(disputes)
  await db.delete(itemFlags)
})

async function seedDraft(): Promise<string> {
  const item = loadBank().byId.get(ITEM)
  if (!item) throw new Error('no item')

  await db.insert(itemFlags).values({ itemId: ITEM, reason: 'this-looks-wrong' })
  const [dispute] = await db
    .insert(disputes)
    .values({ kind: 'card', itemId: ITEM, note: 'heard me wrong' })
    .returning()
  if (!dispute) throw new Error('no dispute')
  await recordDraftCase(db, {
    dispute: { id: dispute.id, flagId: randomUUID(), flaggedAt: dispute.createdAt },
    item,
    words: { text: WORDS, from: 'answer' },
    answer: { reviewedAt: T0.toISOString(), entry: 'voice' },
    note: 'heard me wrong',
    regrade: {
      model: MODELS.opus,
      was: 'partial',
      now: 'right',
      reason: 'Every part named.',
      traceId: 't',
    },
  })
  const [draft] = await db.select().from(evalCaseDrafts)
  if (!draft) throw new Error('no draft')
  return draft.id
}

async function get() {
  const { GET } = await import('./route')
  const response = await GET()
  return { status: response.status, body: (await response.json()) as unknown }
}

async function post(body: unknown) {
  const { POST } = await import('./route')
  const response = await POST(
    new NextRequest('http://127.0.0.1:3000/api/admin/flagged', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )
  return { status: response.status, body: (await response.json()) as unknown }
}

describe('/api/admin/flagged', () => {
  it('GET lists the drafts in the page’s own shape, their words exactly', async () => {
    const id = await seedDraft()
    const { status, body } = await get()
    expect(status).toBe(200)
    const view = flaggedViewSchema.parse(body)
    expect(view.drafts.map((draft) => [draft.id, draft.words])).toEqual([[id, WORDS]])
  })

  it('POST approve, then a second review is 409', async () => {
    const id = await seedDraft()
    expect(await post({ id, action: 'approve' })).toEqual({
      status: 200,
      body: { ok: true, status: 'approved', returned: true },
    })
    expect((await post({ id, action: 'reject' })).status).toBe(409)
    expect(flaggedViewSchema.parse((await get()).body).reviewed.approved).toBe(1)
  })

  it('POST fix stores the reviewer’s result and reason; their words stay as recorded', async () => {
    const id = await seedDraft()
    const { status } = await post({
      id,
      action: 'fix',
      expected: 'partial',
      reason: 'Rollers are missing.',
    })
    expect(status).toBe(200)
    const [row] = await db.select().from(evalCaseDrafts)
    expect(row).toMatchObject({ status: 'fixed', expected: 'partial', words: WORDS })
  })

  it('refuses malformed bodies, their words in a body, and unknown cases', async () => {
    const id = await seedDraft()
    expect((await post('not json')).status).toBe(400)
    expect((await post({ id, action: 'delete' })).status).toBe(400)
    expect(
      (await post({ id, action: 'fix', expected: 'right', reason: 'Fine now.', words: 'x' }))
        .status,
    ).toBe(400)
    expect((await post({ id: randomUUID(), action: 'approve' })).status).toBe(404)
    const [row] = await db.select().from(evalCaseDrafts)
    expect(row).toMatchObject({ status: 'draft', words: WORDS })
  })
})
