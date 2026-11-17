import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { loadVoiceTestSentences } from '@/lib/content/voice-test'
import type { Db } from '@/lib/db/client'
import { voiceTestRuns } from '@/lib/db/schema'

import { TEST_ENV } from '../../../../e2e/test-env'

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
  await db.delete(voiceTestRuns)
})

function fullRun(
  mode: 'safari-tab' | 'home-screen',
  heard: boolean,
  musicPlaying: boolean | null,
): Record<string, unknown> {
  return {
    mode,
    completed: true,
    readAloudWorked: true,
    musicPlaying,
    sentences: loadVoiceTestSentences().map((sentence) => ({
      id: sentence.id,
      transcript: heard ? sentence.text : 'um something else entirely',
      stalled: false,
      autoStops: 1,
      spokeOk: true,
      firstResultMs: 600,
      listenMs: 7000,
      holdsMs: [4200],
    })),
  }
}

async function post(body: unknown): Promise<{ status: number; json: unknown }> {
  const { POST } = await import('./route')
  const response = await POST(
    new NextRequest('http://127.0.0.1:3000/api/voice-test', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  )
  return { status: response.status, json: await response.json() }
}

describe('POST /api/voice-test', () => {
  it('saves their music answer and the hold times, and waits for the other mode', async () => {
    const saved = await post(fullRun('safari-tab', true, true))
    expect(saved.status).toBe(201)
    expect(saved.json).toMatchObject({
      path: 'keep',
      decision: { decided: false, missing: ['home-screen'] },
    })
    const [row] = await db.select().from(voiceTestRuns)
    expect(row?.details).toMatchObject({ completed: true, musicPlaying: true })
    const details = z
      .object({ sentences: z.array(z.object({ holdsMs: z.array(z.number()) })) })
      .parse(row?.details)
    expect(details.sentences).toHaveLength(40)
    expect(details.sentences.every((s) => s.holdsMs.join() === '4200')).toBe(true)
  })

  it('decides a Safari tab once the Home Screen run fails and the Safari run works', async () => {
    await post(fullRun('safari-tab', true, false))
    const saved = await post(fullRun('home-screen', false, false))
    expect(saved.json).toMatchObject({
      path: 'switch',
      decision: { decided: true, use: 'safari-tab', path: 'keep' },
    })
  })

  it('stores no music answer as null', async () => {
    const withoutAnswer = fullRun('home-screen', true, null)
    delete withoutAnswer.musicPlaying
    await post(withoutAnswer)
    const [row] = await db.select().from(voiceTestRuns)
    expect(row?.details).toMatchObject({ musicPlaying: null })
  })
})
