import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Db } from '@/lib/db/client'
import { counters, traces, ttsClips } from '@/lib/db/schema'
import { TTS_MAX_CHARS } from '@/lib/tts/line'

import { TEST_ENV } from '../../../../e2e/test-env'

const KEY = 'test-elevenlabs-key-not-real' // gitleaks:allow (a fake key; fetch is stubbed)
const MP3 = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 9, 8, 7, 6])

let db: Db
let calls: { url: string; init: RequestInit }[] = []
let answer: (init: RequestInit) => Promise<Response> = () => Promise.resolve(new Response(MP3))
const seen: string[] = []

beforeAll(async () => {
  for (const [key, value] of Object.entries(TEST_ENV)) {
    if (key !== 'NODE_ENV') vi.stubEnv(key, value)
  }
  const { getDb } = await import('@/lib/db/client')
  db = await getDb()
  await import('./route')
  await import('./[clip]/route')
}, 60_000)

afterAll(() => {
  vi.unstubAllEnvs()
})

beforeEach(async () => {
  await db.delete(ttsClips)
  await db.delete(traces)
  await db.delete(counters)
  calls = []
  answer = () => Promise.resolve(new Response(MP3))
  seen.length = 0
  vi.stubEnv('ELEVENLABS_API_KEY', KEY)
  vi.stubEnv('TTS_DAILY_CHARS', '')
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    if (!url.startsWith('https://api.elevenlabs.io/')) throw new Error(`unexpected fetch ${url}`)
    calls.push({ url, init })
    return answer(init)
  })
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      seen.push(args.map(String).join(' '))
    })
  }
})

afterEach(() => {
  expect(seen.join('\n')).not.toContain(KEY)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function say(body: unknown): Promise<Response> {
  const { POST } = await import('./route')
  const response = await POST(
    new NextRequest('http://127.0.0.1:3000/api/tts', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )
  await record(response)
  return response
}

async function clip(id: string): Promise<Response> {
  const { GET } = await import('./[clip]/route')
  const response = await GET(new NextRequest(`http://127.0.0.1:3000/api/tts/${id}`), {
    params: Promise.resolve({ clip: id }),
  })
  await record(response)
  return response
}

async function record(response: Response): Promise<void> {
  const body = Buffer.from(await response.clone().arrayBuffer()).toString('latin1')
  seen.push(body, JSON.stringify([...response.headers.entries()]))
}

describe('POST /api/tts', () => {
  it('makes a line once, then serves it from the cache', async () => {
    const first = await say({ text: 'Sample move a: which parts carry it?' })
    expect(first.status).toBe(200)
    expect(first.headers.get('Content-Type')).toBe('audio/mpeg')
    expect(first.headers.get('X-Tts-Cache')).toBe('miss')
    expect(first.headers.get('Cache-Control')).toBe('no-store')
    const id = first.headers.get('X-Tts-Clip') ?? ''
    expect(id).toMatch(/^[0-9a-f]{64}$/)
    expect(first.headers.get('X-Tts-Voice')).toMatch(/^[0-9a-f]{16}$/)
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(MP3)

    const second = await say({ text: 'Sample move a:  which parts carry it? ' })
    expect(second.status).toBe(200)
    expect(second.headers.get('X-Tts-Cache')).toBe('hit')
    expect(second.headers.get('X-Tts-Clip')).toBe(id)
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(MP3)
    expect(calls).toHaveLength(1)
  })

  it('refuses what isn’t a line: 400 invalid, nothing sent', async () => {
    for (const body of ['not json', {}, { text: 42 }, { text: '  ' }]) {
      const response = await say(body)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'invalid', fallback: 'system-voice' })
    }
    expect((await say({ text: 'x'.repeat(TTS_MAX_CHARS + 1) })).status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it('without a key: 503 no-key for every request, nothing sent', async () => {
    vi.stubEnv('ELEVENLABS_API_KEY', '')
    const response = await say({ text: 'Got it.' })
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'no-key', fallback: 'system-voice' })
    expect((await say('not json')).status).toBe(503)
    expect((await clip('a'.repeat(64))).status).toBe(503)
    expect(calls).toHaveLength(0)
  })

  it('over the day’s character budget: 429 budget', async () => {
    vi.stubEnv('TTS_DAILY_CHARS', '10')
    expect((await say({ text: 'Got it.' })).status).toBe(200)
    const over = await say({ text: 'Not quite.' })
    expect(over.status).toBe(429)
    expect(await over.json()).toEqual({ error: 'budget', fallback: 'system-voice' })
    expect(calls).toHaveLength(1)
  })

  it('ElevenLabs failing: 502 upstream, its message kept out', async () => {
    answer = () => Promise.resolve(new Response(`bad key ${KEY}`, { status: 401 }))
    const response = await say({ text: 'Got it.' })
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'upstream', fallback: 'system-voice' })
  })

  it('ElevenLabs too slow: 504 at about 5 s, then the line is saved and the next ask is a hit', async () => {
    answer = (init) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve(new Response(MP3))
        }, 5400)
        init.signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new DOMException('aborted', 'AbortError'))
        })
      })
    const started = Date.now()
    const response = await say({ text: 'Got it.' })
    expect(response.status).toBe(504)
    expect(await response.json()).toEqual({ error: 'timeout', fallback: 'system-voice' })
    expect(Date.now() - started).toBeGreaterThanOrEqual(4900)

    await vi.waitFor(
      async () => {
        expect(await db.select().from(ttsClips)).toHaveLength(1)
      },
      { timeout: 3000, interval: 50 },
    )
    const again = await say({ text: 'Got it.' })
    expect(again.status).toBe(200)
    expect(again.headers.get('X-Tts-Cache')).toBe('hit')
    expect(new Uint8Array(await again.arrayBuffer())).toEqual(MP3)
    expect(calls).toHaveLength(1)
  })

  it('gives the function room to keep making a line after the 5 s answer', async () => {
    const route = await import('./route')
    const { TTS_KEEP_MAKING_MS, TTS_TIMEOUT_MS } = await import('@/lib/tts/elevenlabs')
    expect(TTS_TIMEOUT_MS).toBe(5000)
    expect(TTS_KEEP_MAKING_MS).toBe(15_000)
    expect(route.maxDuration * 1000).toBeGreaterThan(TTS_TIMEOUT_MS + TTS_KEEP_MAKING_MS)
  })

  it('sends the key only to ElevenLabs, in its header', async () => {
    await say({ text: 'Got it.' })
    expect(calls[0]?.init.headers).toMatchObject({ 'xi-api-key': KEY })
    const body = calls[0]?.init.body
    expect(typeof body === 'string' ? body : '').not.toContain(KEY)
    expect(typeof body).toBe('string')
  })
})

describe('GET /api/tts/<clip>', () => {
  it('serves a made clip for a year, private to their iPad', async () => {
    const made = await say({ text: 'Take five.' })
    const id = made.headers.get('X-Tts-Clip') ?? ''
    const response = await clip(id)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('audio/mpeg')
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable')
    expect(response.headers.get('ETag')).toBe(`"${id}"`)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(MP3)
    expect(calls).toHaveLength(1)
  })

  it('404 for a clip it doesn’t have, or an id that isn’t one', async () => {
    for (const id of ['f'.repeat(64), 'not-a-clip', 'F'.repeat(64)]) {
      const response = await clip(id)
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: 'not-found', fallback: 'system-voice' })
    }
  })
})
