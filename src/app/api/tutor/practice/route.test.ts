import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Db } from '@/lib/db/client'
import { gateResults, practices } from '@/lib/db/schema'
import { practiceReportSchema, sceneViewSchema } from '@/lib/practice/contract'
import { typedRequest } from '@/lib/practice/client'

import { TEST_ENV } from '../../../../../e2e/test-env'

let db: Db

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
  await db.delete(gateResults)
  await db.delete(practices)
})

const post = async (body: unknown) => {
  const { POST } = await import('./route')
  const response = await POST(
    new NextRequest('http://app.test/api/tutor/practice', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  return { status: response.status, body: (await response.json()) as unknown }
}

const getScene = async (query = '') => {
  const { GET } = await import('../../practice/scene/route')
  const response = await GET(new NextRequest(`http://app.test/api/practice/scene${query}`))
  return { status: response.status, body: (await response.json()) as unknown }
}

describe('mic practice, end to end on the sample method', () => {
  it('serves a scene, grades a typed practice of it, and stores the verdicts', async () => {
    const scene = sceneViewSchema.parse((await getScene()).body)
    expect(scene.id).toBe('warm-up-1')
    const request = typedRequest(scene, [
      'Sample Move A. Hands on the front rail, feet on the sliding deck. Slow count of four.',
      'Sample Move B. Stand on the back step, facing the rail. Steady pace.',
    ])
    const { status, body } = await post(request)
    expect(status).toBe(200)
    const report = practiceReportSchema.parse(body)
    expect(report.tutor).toBe('unavailable')
    expect(report.allMustPass).toBe(true)
    expect(report.checks.find((c) => c.gateId === 'A2')?.quote).toContain('front rail')
    const stored = await db.select().from(gateResults)
    expect(stored.length).toBeGreaterThan(0)
    expect(sceneViewSchema.parse((await getScene()).body).id).toBe('main-set-1')
  })

  it('refuses a body that does not fit, an unknown scene, and the wrong number of marks', async () => {
    expect((await post({ nope: true })).status).toBe(400)
    const scene = sceneViewSchema.parse((await getScene('?id=main-set-1')).body)
    const request = typedRequest(scene, ['a', 'b'])
    expect((await post({ ...request, sceneId: 'no-such-scene' })).status).toBe(404)
    expect((await post({ ...request, marks: [0] })).status).toBe(400)
    expect((await getScene('?id=no-such-scene')).status).toBe(404)
  })
})
