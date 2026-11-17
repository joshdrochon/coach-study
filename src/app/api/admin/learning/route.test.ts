import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { learningSchema } from '@/lib/dashboard/client'
import type { Db } from '@/lib/db/client'
import { gateResults, practices } from '@/lib/db/schema'
import { appliesIn, GATES } from '@/lib/gates'
import { insertPractice } from '@/test/practice-rows'

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

const MUST_PASS = GATES.filter((gate) => gate.mustPass)
const allPass = Object.fromEntries(
  MUST_PASS.filter((gate) => appliesIn(gate, 'warm-up')).map((gate) => [gate.id, 'pass' as const]),
)

describe('GET /api/admin/learning', () => {
  it('sends their north star run and per-must-do mastery from the stored practices', async () => {
    const start = Date.now() - 3 * 3_600_000
    for (const [index, sequence] of [2, 6].entries()) {
      await insertPractice(db, {
        doneAt: new Date(start + index * 3_600_000),
        scene: { sceneId: `sequence-0${String(sequence)}-warm-up`, sequence },
        verdicts: allPass,
      })
    }
    const { GET } = await import('./route')
    const response = await GET()
    expect(response.status).toBe(200)
    const body = learningSchema.parse(await response.json())
    expect(body.northStar.sequencesInARow).toEqual([2, 6])
    expect(body.northStar.of).toBe(3)
    expect(body.northStar.reachedOn).toBeNull()
    expect(body.northStar.target).toBe('Jan 15')
    expect(body.northStar.mastery).toHaveLength(MUST_PASS.length)
    expect(body.northStar.mastery.filter((m) => m.sequences === 2).length).toBeGreaterThan(0)
    expect(body.northStar.mastery.some((m) => m.mastered)).toBe(false)
  })
})
