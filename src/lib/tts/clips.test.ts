import { createHash } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { openTestDb, type Db } from '../db/client'
import { counters, traces, ttsClips } from '../db/schema'
import { claimCallSlot } from '../tutor/run'

import {
  charsKey,
  clipId,
  dailyCharBudget,
  DEFAULT_DAILY_CHARS,
  findClip,
  holdChars,
  lineClip,
  reportingServer,
  TTS_RATE_PER_MINUTE,
  voiceKey,
} from './clips'
import { synthesize, VOICE, type Fetch, type Voice } from './elevenlabs'
import { TtsError } from './errors'
import { TTS_MAX_CHARS } from './line'
import { SPOKEN_VERSION } from './spoken'

const KEY = 'test-elevenlabs-key-not-real' // gitleaks:allow (a fake key; fetch is stubbed)
const ENV = { ELEVENLABS_API_KEY: KEY }
const NOON = new Date('2026-08-17T19:00:00Z')
const MP3 = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 1, 2, 3, 4])

type Call = { url: string; init: RequestInit }

function elevenLabs(answer: () => Response | Promise<Response> = () => new Response(MP3)): {
  fetch: Fetch
  calls: Call[]
} {
  const calls: Call[] = []
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init })
      return answer()
    },
  }
}

describe('the app voice on the server', () => {
  let db: Db
  const logged: string[] = []

  beforeEach(async () => {
    db = await openTestDb()
    vi.stubGlobal('fetch', () => {
      throw new Error('a test tried to reach the network')
    })
    logged.length = 0
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '))
      })
    }
  })

  afterEach(() => {
    expect(logged.join('\n')).not.toContain(KEY)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('names a clip by the voice, its settings and the words', () => {
    const line = 'Take five.'
    expect(clipId(line)).toMatch(/^[0-9a-f]{64}$/)
    expect(clipId(line)).toBe(clipId(line))
    expect(clipId(line)).not.toBe(clipId('Take five'))

    const s = VOICE.voiceSettings
    const changed: Voice[] = [
      { ...VOICE, voiceId: 'OTHER_VOICE_ID' },
      { ...VOICE, modelId: 'eleven_multilingual_v2' },
      { ...VOICE, outputFormat: 'mp3_44100_64' },
      { ...VOICE, voiceSettings: { ...s, stability: 0.4 } },
      { ...VOICE, voiceSettings: { ...s, similarity_boost: 0.75 } },
    ]
    const keys = new Set([voiceKey(), ...changed.map((voice) => voiceKey(voice))])
    expect(keys.size).toBe(changed.length + 1)
    for (const voice of changed) expect(clipId(line, voice)).not.toBe(clipId(line))
  })

  it('names a clip by the spoken-text rules too: a rule change makes every line new', () => {
    const line = 'Take five.'
    expect(clipId(line, VOICE, SPOKEN_VERSION + 1)).not.toBe(clipId(line))

    const before = createHash('sha256').update(`${voiceKey()}\n${line}`).digest('hex')
    expect(before).not.toBe(clipId(line))
  })

  it('makes and keys a line by its spoken words: "3:00" is said as 3 minutes', async () => {
    const voice = elevenLabs()
    const clip = await lineClip(db, 'Wait 3:00, then 30+ people move to room 2.', {
      env: ENV,
      fetch: voice.fetch,
      now: () => NOON,
    })
    const said = 'Wait 3 minutes, then 30 plus people move to room 2.'
    const body = voice.calls[0]?.init.body
    expect(JSON.parse(typeof body === 'string' ? body : 'null')).toMatchObject({ text: said })
    expect(clip.id).toBe(clipId(said))

    expect(await lineClip(db, said, { env: ENV, fetch: voice.fetch })).toMatchObject({
      id: clip.id,
      cached: true,
    })
    expect(voice.calls).toHaveLength(1)
  })

  it('sends the configured voice: Eleven v4, two settings, 128 kbps', async () => {
    expect(VOICE).toEqual({
      voiceId: 'YOUR_VOICE_ID',
      modelId: 'eleven_v4',
      outputFormat: 'mp3_44100_128',
      voiceSettings: { stability: 0.5, similarity_boost: 0.85 },
    })
    const voice = elevenLabs()
    await synthesize('Got it.', KEY, new AbortController().signal, voice.fetch)
    const call = voice.calls[0]

    const url = new URL(call?.url ?? '')
    expect(url.pathname).toBe('/v1/text-to-speech/YOUR_VOICE_ID')
    expect([...url.searchParams.entries()]).toEqual([['output_format', 'mp3_44100_128']])

    const body = call?.init.body
    const sent = JSON.parse(typeof body === 'string' ? body : 'null') as Record<string, unknown>
    expect(sent).toEqual({
      text: 'Got it.',
      model_id: 'eleven_v4',
      voice_settings: { stability: 0.5, similarity_boost: 0.85 },
    })
    expect(sent).not.toHaveProperty('language_code')
    expect(sent).not.toHaveProperty('apply_language_text_normalization')
    expect(Object.keys(sent.voice_settings as object).sort()).toEqual([
      'similarity_boost',
      'stability',
    ])
  })

  it('never replays a clip made with the old settings: a settings change misses it', async () => {
    const firstVoice: Voice = {
      voiceId: 'OTHER_VOICE_ID',
      modelId: 'eleven_flash_v2_5',
      outputFormat: 'mp3_44100_64',
      voiceSettings: { stability: 0.92, similarity_boost: 0.75 },
    }
    const line = 'Take five.'
    const OLD_MP3 = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0])
    await db.insert(ttsClips).values({
      id: clipId(line, firstVoice),
      voiceKey: voiceKey(firstVoice),
      chars: line.length,
      audio: OLD_MP3,
    })

    expect(await findClip(db, clipId(line, firstVoice))).toBeNull()
    expect(await findClip(db, clipId(line, firstVoice), firstVoice)).toEqual(OLD_MP3)

    const voice = elevenLabs()
    const clip = await lineClip(db, line, { env: ENV, fetch: voice.fetch })
    expect(clip).toMatchObject({ cached: false })
    expect(clip.id).not.toBe(clipId(line, firstVoice))
    expect(clip.audio).toEqual(MP3)
    expect(voice.calls).toHaveLength(1)

    const keyOf = (voice: unknown) =>
      createHash('sha256').update(JSON.stringify(voice)).digest('hex').slice(0, 16)
    const secondVoice = {
      voiceId: 'OTHER_VOICE_ID',
      modelId: 'eleven_multilingual_v2',
      outputFormat: 'mp3_44100_64',
      voiceSettings: {
        stability: 0.4,
        similarity_boost: 0.75,
        style: 0.35,
        use_speaker_boost: true,
        speed: 0.9,
      },
    }
    expect(keyOf(firstVoice)).toBe(voiceKey(firstVoice))
    for (const old of [firstVoice, secondVoice]) expect(keyOf(old)).not.toBe(voiceKey())
    await db.insert(ttsClips).values({
      id: createHash('sha256')
        .update(`${keyOf(secondVoice)}\n${line}`)
        .digest('hex'),
      voiceKey: keyOf(secondVoice),
      chars: line.length,
      audio: OLD_MP3,
    })
    expect(await findClip(db, clipId(line))).toEqual(MP3)

    const s = VOICE.voiceSettings
    for (const other of [
      { ...VOICE, voiceId: 'OTHER_VOICE_ID' },
      { ...VOICE, modelId: 'eleven_multilingual_v2' },
      { ...VOICE, outputFormat: 'mp3_44100_64' },
      { ...VOICE, voiceSettings: { ...s, stability: 0.4 } },
      { ...VOICE, voiceSettings: { ...s, similarity_boost: 0.75 } },
    ] satisfies Voice[]) {
      expect(await findClip(db, clip.id, other)).toBeNull()
      expect(await findClip(db, clipId(line, other), other)).toBeNull()
    }
  })

  it('serves a clip only for the voice that made it', async () => {
    const voice = elevenLabs()
    const clip = await lineClip(db, 'Got it.', { env: ENV, fetch: voice.fetch })
    expect(await findClip(db, clip.id)).toEqual(MP3)
    const other = { ...VOICE, voiceId: 'another-voice' }
    expect(await findClip(db, clip.id, other)).toBeNull()
    expect(await findClip(db, 'f'.repeat(64))).toBeNull()
  })

  it('without a key, refuses before anything else (the iPad speaks every line itself)', async () => {
    const voice = elevenLabs()
    for (const env of [{}, { ELEVENLABS_API_KEY: '' }, { ELEVENLABS_API_KEY: '[SENSITIVE]' }]) {
      await expect(lineClip(db, 'Got it.', { env, fetch: voice.fetch })).rejects.toMatchObject({
        kind: 'no-key',
      })
    }
    expect(voice.calls).toHaveLength(0)
    expect(await db.select().from(traces)).toHaveLength(0)
  })

  it('refuses an empty line and one too long to say', async () => {
    const voice = elevenLabs()
    for (const text of ['', '   ', 'x'.repeat(TTS_MAX_CHARS + 1)]) {
      await expect(lineClip(db, text, { env: ENV, fetch: voice.fetch })).rejects.toMatchObject({
        kind: 'invalid',
      })
    }
    await expect(
      lineClip(db, 'x'.repeat(TTS_MAX_CHARS), { env: ENV, fetch: voice.fetch }),
    ).resolves.toMatchObject({ cached: false })
    expect(voice.calls).toHaveLength(1)
  })

  it('stops at the daily character budget: 429 budget, no call, a fallback trace', async () => {
    const voice = elevenLabs()
    const env = { ...ENV, TTS_DAILY_CHARS: '20' }
    await lineClip(db, 'Ten chars.', { env, fetch: voice.fetch, now: () => NOON })
    await lineClip(db, 'Take five.', { env, fetch: voice.fetch, now: () => NOON })
    await expect(
      lineClip(db, 'One more line.', { env, fetch: voice.fetch, now: () => NOON }),
    ).rejects.toMatchObject({ kind: 'budget' })
    expect(voice.calls).toHaveLength(2)
    const refused = await db.select().from(traces).where(eq(traces.outcome, 'fallback'))
    expect(refused).toEqual([expect.objectContaining({ kind: 'tts', error: 'budget' })])

    await expect(
      lineClip(db, 'Take five.', { env, fetch: voice.fetch, now: () => NOON }),
    ).resolves.toMatchObject({ cached: true })

    const tomorrow = new Date(NOON.getTime() + 86_400_000)
    await expect(
      lineClip(db, 'One more line.', { env, fetch: voice.fetch, now: () => tomorrow }),
    ).resolves.toMatchObject({ cached: false })
  })

  it('holds the budget atomically: lines at the same moment can’t all fit', async () => {
    const holds = await Promise.all(Array.from({ length: 10 }, () => holdChars(db, 100, 450, NOON)))
    expect(holds.filter(Boolean)).toHaveLength(4)
    const [row] = await db
      .select()
      .from(counters)
      .where(eq(counters.key, charsKey(NOON)))
    expect(row?.value).toBe(400)
  })

  it('reads the budget from TTS_DAILY_CHARS, else 40,000 characters', () => {
    expect(DEFAULT_DAILY_CHARS).toBe(40_000)
    expect(dailyCharBudget({})).toBe(40_000)
    expect(dailyCharBudget({ TTS_DAILY_CHARS: ' 60000 ' })).toBe(60_000)
    expect(dailyCharBudget({ TTS_DAILY_CHARS: '0' })).toBe(0)
    for (const bad of ['', 'lots', '-5', '1.5']) {
      expect(dailyCharBudget({ TTS_DAILY_CHARS: bad })).toBe(40_000)
    }
  })

  it('names the server a fallback report came to: Vercel’s environment, else local', () => {
    expect(reportingServer({ VERCEL_ENV: 'production' })).toBe('production')
    expect(reportingServer({ VERCEL_ENV: ' preview ' })).toBe('preview')
    expect(reportingServer({})).toBe('local')
    for (const empty of ['', '   ']) expect(reportingServer({ VERCEL_ENV: empty })).toBe('local')
  })

  it('rate-limits lines sent to ElevenLabs per minute, apart from the tutor’s limit', async () => {
    for (let i = 0; i < TTS_RATE_PER_MINUTE; i++) {
      expect(await claimCallSlot(db, NOON, 'tts-calls', TTS_RATE_PER_MINUTE)).toBe(true)
    }
    const voice = elevenLabs()
    await expect(
      lineClip(db, 'Got it.', { env: ENV, fetch: voice.fetch, now: () => NOON }),
    ).rejects.toMatchObject({ kind: 'rate-limited' })
    expect(voice.calls).toHaveLength(0)

    expect(await claimCallSlot(db, NOON)).toBe(true)
  })

  it('an error status gives the characters back; no upstream text reaches the error', async () => {
    const voice = elevenLabs(() => new Response(`{"detail":"invalid key ${KEY}"}`, { status: 401 }))
    const failure = await lineClip(db, 'Got it.', {
      env: ENV,
      fetch: voice.fetch,
      now: () => NOON,
    }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(TtsError)
    expect(failure).toMatchObject({ kind: 'upstream' })
    expect(String(failure)).not.toContain(KEY)
    const [held] = await db
      .select()
      .from(counters)
      .where(eq(counters.key, charsKey(NOON)))
    expect(held?.value).toBe(0)
    const [trace] = await db.select().from(traces)
    expect(trace).toMatchObject({ kind: 'tts', outcome: 'fallback', error: 'upstream' })
    expect(JSON.stringify(trace)).not.toContain(KEY)
    expect(await db.select().from(ttsClips)).toHaveLength(0)
  })

  it('a network failure or an empty answer is upstream too', async () => {
    const offline = elevenLabs(() => Promise.reject(new TypeError('fetch failed')))
    await expect(lineClip(db, 'Got it.', { env: ENV, fetch: offline.fetch })).rejects.toMatchObject(
      { kind: 'upstream' },
    )
    const empty = elevenLabs(() => new Response(new Uint8Array()))
    await expect(lineClip(db, 'Got it.', { env: ENV, fetch: empty.fetch })).rejects.toMatchObject({
      kind: 'upstream',
    })
  })

  it('times out after its limit and keeps the characters (ElevenLabs may have made it)', async () => {
    const slow: Fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      })
    const kept: Promise<void>[] = []
    await expect(
      lineClip(db, 'Got it.', {
        env: ENV,
        fetch: slow,
        timeoutMs: 20,
        keepMakingMs: 30,
        keepMaking: (rest) => kept.push(rest),
        now: () => NOON,
      }),
    ).rejects.toMatchObject({ kind: 'timeout' })

    expect(kept).toHaveLength(1)
    expect(await db.select().from(traces)).toHaveLength(0)

    await kept[0]
    const [held] = await db
      .select()
      .from(counters)
      .where(eq(counters.key, charsKey(NOON)))
    expect(held?.value).toBe(7)
    const rows = await db.select().from(traces)
    expect(rows).toEqual([
      expect.objectContaining({
        outcome: 'fallback',
        error: 'timeout',
        result: expect.objectContaining({ late: true }) as unknown,
      }),
    ])
    expect(await db.select().from(ttsClips)).toHaveLength(0)
  })

  it('a slow line is still made after the iPad’s fallback and saved: the next ask is a hit', async () => {
    let calls = 0
    const late: Fetch = async (_url, init) => {
      calls += 1
      await new Promise((resolve) => setTimeout(resolve, 60))
      if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError')
      return new Response(MP3)
    }
    const kept: Promise<void>[] = []
    const failure = await lineClip(db, 'Take five.', {
      env: ENV,
      fetch: late,
      timeoutMs: 20,
      keepMakingMs: 1000,
      keepMaking: (rest) => kept.push(rest),
      now: () => NOON,
    }).catch((error: unknown) => error)

    expect(failure).toMatchObject({ kind: 'timeout' })
    expect(await db.select().from(ttsClips)).toHaveLength(0)

    expect(kept).toHaveLength(1)
    await kept[0]
    const [row] = await db.select().from(ttsClips)
    expect(row).toMatchObject({ id: clipId('Take five.'), voiceKey: voiceKey(), chars: 10 })
    expect(await db.select().from(traces)).toEqual([
      expect.objectContaining({
        outcome: 'ok',
        result: expect.objectContaining({ late: true, bytes: MP3.byteLength }) as unknown,
      }),
    ])

    const next = await lineClip(db, 'Take five.', { env: ENV, fetch: late, now: () => NOON })
    expect(next).toMatchObject({ id: clipId('Take five.'), cached: true })
    expect(next.audio).toEqual(MP3)
    expect(calls).toBe(1)
    const [held] = await db
      .select()
      .from(counters)
      .where(eq(counters.key, charsKey(NOON)))
    expect(held?.value).toBe(10)
  })

  it('a line made in time is not marked late, and nothing is left running', async () => {
    const kept: Promise<void>[] = []
    const voice = elevenLabs()
    const clip = await lineClip(db, 'Got it.', {
      env: ENV,
      fetch: voice.fetch,
      keepMaking: (rest) => kept.push(rest),
    })
    expect(clip.cached).toBe(false)
    expect(kept).toHaveLength(0)
    const [trace] = await db.select().from(traces)
    expect(trace?.result).not.toHaveProperty('late')
  })

  it('a body cut off mid-line is a timeout once the limit has passed', async () => {
    const controller = new AbortController()
    const cutOff: Fetch = () =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(stream) {
              controller.signal.addEventListener('abort', () => {
                stream.error(new Error('aborted'))
              })
            },
          }),
        ),
      )
    const pending = synthesize('Got it.', KEY, controller.signal, cutOff)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ kind: 'timeout' })
  })
})
