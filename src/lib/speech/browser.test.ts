import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  appMode,
  appVoice,
  browserClipMemory,
  holdWakeLock,
  mediaPlayer,
  primeVoice,
  recognitionConstructor,
  reportFallback,
  reportMic,
  SILENT_WAV,
  speak,
  transcriptOf,
  VOICE_SETTINGS,
  voicePrimed,
  type MediaElement,
} from './browser'
import { FALLBACK_REPORT_PATH, fallbackReportSchema, type FallbackReport } from '../tts/fallback'

import { MIC_REPORT_PATH, micReportSchema } from './mic-report'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function stubWindow(extra: Record<string, unknown> = {}) {
  const win = {
    matchMedia: () => ({ matches: false }),
    setTimeout: (run: () => void, ms: number) => setTimeout(run, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => {
      clearTimeout(id)
    },
    ...extra,
  }
  vi.stubGlobal('window', win)
  return win
}

describe('transcriptOf', () => {
  it('joins final text and the current interim guess', () => {
    const alt = (t: string) => ({ transcript: t, confidence: 1 })
    const results = [
      Object.assign([alt('hands front rail ')], { isFinal: true }),
      Object.assign([alt('feet line')], { isFinal: false }),
    ]
    expect(transcriptOf({ results } as unknown as SpeechRecognitionEvent)).toEqual({
      final: 'hands front rail',
      interim: 'feet line',
    })
  })
  it("joins Safari's chunks, which carry no leading space, with one space", () => {
    const alt = (t: string) => ({ transcript: t, confidence: 1 })
    const results = [
      Object.assign([alt('Turn left')], { isFinal: true }),
      Object.assign([alt('at the gate')], { isFinal: true }),
      Object.assign([alt('then walk')], { isFinal: false }),
      Object.assign([alt('to the corner')], { isFinal: false }),
    ]
    expect(transcriptOf({ results } as unknown as SpeechRecognitionEvent)).toEqual({
      final: 'Turn left at the gate',
      interim: 'then walk to the corner',
    })
  })
})

describe('recognitionConstructor and appMode', () => {
  it('finds Safari’s prefixed recognizer', () => {
    const Fake = function FakeRecognition() {
      return undefined
    }
    stubWindow({ webkitSpeechRecognition: Fake })
    expect(recognitionConstructor()).toBe(Fake)
  })

  it('is undefined on the server', () => {
    expect(recognitionConstructor()).toBeUndefined()
  })

  it('detects the Home Screen app', () => {
    stubWindow({ matchMedia: () => ({ matches: true }) })
    vi.stubGlobal('navigator', {})
    expect(appMode()).toBe('home-screen')
    vi.stubGlobal('navigator', { standalone: false })
    stubWindow()
    expect(appMode()).toBe('safari-tab')
  })
})

describe('speak', () => {
  it('resolves ok when the line finishes, preferring an enhanced US voice', async () => {
    let spoken: { voice?: { name: string }; onend?: () => void } | undefined
    stubWindow({
      speechSynthesis: {
        getVoices: () => [
          { name: 'Fred', lang: 'en-US' },
          { name: 'Samantha (Enhanced)', lang: 'en-US' },
        ],
        cancel: () => undefined,
        speak: (u: { voice?: { name: string }; onend?: () => void }) => {
          spoken = u
          setTimeout(() => u.onend?.(), 0)
        },
      },
    })
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        constructor(public text: string) {}
      },
    )
    const result = await speak('Sentence 1.')
    expect(result.ok).toBe(true)
    expect(spoken?.voice?.name).toBe('Samantha (Enhanced)')
  })

  it('without an enhanced voice, uses the default voice, never just the first one listed', async () => {
    type Utterance = { voice?: { name: string }; lang?: string; onend?: () => void }
    const sayWith = async (voices: { name: string; lang: string; default?: boolean }[]) => {
      let spoken: Utterance | undefined
      stubWindow({
        speechSynthesis: {
          getVoices: () => voices,
          cancel: () => undefined,
          speak: (u: Utterance) => {
            spoken = u
            setTimeout(() => u.onend?.(), 0)
          },
        },
      })
      vi.stubGlobal(
        'SpeechSynthesisUtterance',
        class {
          constructor(public text: string) {}
        },
      )
      await speak('Sentence 1.')
      return spoken
    }
    const withDefault = await sayWith([
      { name: 'Albert', lang: 'en-US' },
      { name: 'Samantha', lang: 'en-US', default: true },
    ])
    expect(withDefault?.voice?.name).toBe('Samantha')

    const noEnglishDefault = await sayWith([
      { name: 'Albert', lang: 'en-US' },
      { name: 'Fred', lang: 'en-US' },
      { name: 'Amélie', lang: 'fr-CA', default: true },
    ])
    expect(noEnglishDefault?.voice).toBeUndefined()
    expect(noEnglishDefault?.lang).toBe('en-US')
  })

  it('resolves not ok when there is no speech synthesis', async () => {
    stubWindow()
    expect(await speak('hello')).toEqual({ ok: false, ms: 0 })
  })

  it('times out a line that never finishes', async () => {
    vi.useFakeTimers()
    stubWindow({
      speechSynthesis: { getVoices: () => [], cancel: () => undefined, speak: () => undefined },
    })
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        constructor(public text: string) {}
      },
    )
    const pending = speak('hi')
    vi.advanceTimersByTime(5000)
    expect((await pending).ok).toBe(false)
  })
})

describe('holdWakeLock', () => {
  it('releases the lock it took', async () => {
    const release = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { wakeLock: { request: () => Promise.resolve({ release }) } })
    const done = await holdWakeLock()
    done()
    expect(release).toHaveBeenCalled()
  })

  it('carries on without a lock where it is unsupported', async () => {
    vi.stubGlobal('navigator', {})
    const done = await holdWakeLock()
    expect(() => {
      done()
    }).not.toThrow()
  })
})

class FakeAudio {
  src = ''
  paused = true
  ended = false
  plays = 0
  loads = 0
  refuse = false
  removed: string[] = []
  private listeners = new Map<string, (() => void)[]>()
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener()
  }
  play() {
    this.plays += 1
    if (this.refuse) return Promise.reject(new DOMException('not allowed', 'NotAllowedError'))
    this.paused = false
    return Promise.resolve()
  }
  pause() {
    this.paused = true
  }
  load() {
    this.loads += 1
  }
  removeAttribute(name: string) {
    this.removed.push(name)
    this.src = ''
  }
}

describe('mediaPlayer (the shared element)', () => {
  it('plays a line and reports it playing, ended, or failed', async () => {
    const audio = new FakeAudio()
    const player = mediaPlayer(audio as unknown as MediaElement)
    const events = { playing: vi.fn(), ended: vi.fn(), failed: vi.fn() }
    await player.start('blob:line', events)
    expect(audio.src).toBe('blob:line')
    expect(audio.plays).toBe(1)
    expect(player.playing).toBe(true)
    audio.emit('playing')
    audio.emit('ended')
    audio.emit('error')
    expect(events.playing).toHaveBeenCalledOnce()
    expect(events.ended).toHaveBeenCalledOnce()
    expect(events.failed).toHaveBeenCalledOnce()
  })

  it('stop() silences it and drops the line: its late events go nowhere', async () => {
    const audio = new FakeAudio()
    const player = mediaPlayer(audio as unknown as MediaElement)
    const events = { playing: vi.fn(), ended: vi.fn(), failed: vi.fn() }
    await player.start('blob:line', events)
    player.stop()
    expect(audio.paused).toBe(true)
    expect(audio.removed).toEqual(['src'])
    expect(audio.loads).toBe(1)
    expect(player.playing).toBe(false)
    audio.emit('ended')
    expect(events.ended).not.toHaveBeenCalled()
  })

  it('a refused play rejects (no tap yet); unlock plays silence and swallows a refusal', async () => {
    const audio = new FakeAudio()
    const player = mediaPlayer(audio as unknown as MediaElement)
    audio.refuse = true
    await expect(
      player.start('blob:line', { playing: vi.fn(), ended: vi.fn(), failed: vi.fn() }),
    ).rejects.toThrow('not allowed')
    player.unlock()
    expect(audio.src).toBe(SILENT_WAV)
    expect(audio.plays).toBe(2)
    await Promise.resolve()
  })

  it('the silence is a valid 10 ms WAV', () => {
    const bytes = Buffer.from(SILENT_WAV.replace('data:audio/wav;base64,', ''), 'base64')
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('RIFF')
    expect(bytes.subarray(8, 12).toString('latin1')).toBe('WAVE')
    expect(bytes.readUInt32LE(4)).toBe(bytes.length - 8)
    expect(bytes.readUInt32LE(24)).toBe(8000)
    expect(bytes.readUInt32LE(40)).toBe(160)
  })
})

class FakeStorage {
  items = new Map<string, string>()
  full = false
  getItem(key: string) {
    return this.items.get(key) ?? null
  }
  setItem(key: string, value: string) {
    if (this.full) throw new DOMException('full', 'QuotaExceededError')
    this.items.set(key, value)
  }
}

describe('reportMic (the iPad tells the server about the mic)', () => {
  it('sends reason and timing with sendBeacon, rounded, as JSON the route accepts', () => {
    const beacons: { url: string; data: unknown }[] = []
    vi.stubGlobal('navigator', {
      standalone: true,
      sendBeacon: (url: string, data: unknown) => beacons.push({ url, data }) > 0,
    })
    stubWindow({ fetch: vi.fn() })
    reportMic({
      reason: 'ended-early',
      endOn: 'release',
      atMs: 1500.4,
      restarts: 1,
      firstResultMs: 300.6,
    })
    expect(beacons[0]?.url).toBe(MIC_REPORT_PATH)
    expect(micReportSchema.parse(JSON.parse(String(beacons[0]?.data)))).toEqual({
      reason: 'ended-early',
      endOn: 'release',
      atMs: 1500,
      restarts: 1,
      firstResultMs: 301,
      app: 'home-screen',
    })
  })

  it('never throws', () => {
    vi.stubGlobal('navigator', { sendBeacon: () => false })
    stubWindow({
      fetch: () => {
        throw new TypeError('no fetch')
      },
    })
    expect(() => {
      reportMic({
        reason: 'start-failed',
        endOn: 'release',
        atMs: 0,
        restarts: 0,
        firstResultMs: null,
      })
    }).not.toThrow()
  })
})

describe('reportFallback (the iPad tells the server)', () => {
  const REPORT: FallbackReport = {
    reason: 'start-timeout',
    chars: 36,
    atMs: 2500,
    replayMs: null,
    requestMs: 4,
    headersMs: null,
    blobMs: null,
    playMs: null,
  }

  it('sends it with sendBeacon, as JSON the route accepts', () => {
    const beacons: { url: string; data: unknown }[] = []
    const fetch = vi.fn()
    vi.stubGlobal('navigator', {
      sendBeacon: (url: string, data: unknown) => beacons.push({ url, data }) > 0,
    })
    stubWindow({ fetch })
    reportFallback(REPORT)
    expect(beacons).toHaveLength(1)
    expect(beacons[0]?.url).toBe(FALLBACK_REPORT_PATH)
    expect(fallbackReportSchema.parse(JSON.parse(String(beacons[0]?.data)))).toEqual(REPORT)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('falls back to a keepalive fetch where there’s no beacon, or it refuses or throws', () => {
    for (const sendBeacon of [
      undefined,
      () => false,
      () => {
        throw new TypeError('beacon refused')
      },
    ]) {
      const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
        Promise.resolve(new Response()),
      )
      vi.stubGlobal('navigator', sendBeacon ? { sendBeacon } : {})
      stubWindow({ fetch })
      reportFallback(REPORT)
      expect(fetch).toHaveBeenCalledTimes(1)
      const [url, init] = fetch.mock.calls[0] ?? []
      expect(url).toBe(FALLBACK_REPORT_PATH)
      expect(init).toMatchObject({ method: 'POST', keepalive: true })
      const body = init?.body
      expect(JSON.parse(typeof body === 'string' ? body : '')).toEqual(REPORT)
    }
  })

  it('never throws, and never waits for an answer', async () => {
    vi.stubGlobal('navigator', { sendBeacon: () => false })
    stubWindow({ fetch: () => Promise.reject(new TypeError('offline')) })
    expect(() => {
      reportFallback(REPORT)
    }).not.toThrow()
    stubWindow({
      fetch: () => {
        throw new TypeError('no fetch')
      },
    })
    expect(() => {
      reportFallback(REPORT)
    }).not.toThrow()

    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})

describe('browserClipMemory', () => {
  it('remembers a clip by a hash of the line, never the line itself', async () => {
    const storage = new FakeStorage()
    const memory = browserClipMemory(() => storage as unknown as Storage)
    expect(await memory.recall('Take five.')).toBeNull()
    await memory.remember('Take five.', 'a'.repeat(64), 'voice-1')
    expect(await memory.recall('Take five.')).toBe('a'.repeat(64))
    expect(await memory.recall('Take five')).toBeNull()
    expect([...storage.items.values()].join('')).not.toContain('Take five')
    await memory.forget('Take five.')
    expect(await memory.recall('Take five.')).toBeNull()
  })

  it('replays nothing in a new page until the server has named its voice there', async () => {
    const storage = new FakeStorage()
    await browserClipMemory(() => storage as unknown as Storage).remember(
      'Take five.',
      'a'.repeat(64),
      'voice-1',
    )

    const page = browserClipMemory(() => storage as unknown as Storage)
    expect(await page.recall('Take five.')).toBeNull()
    await page.remember('Got it.', 'b'.repeat(64), 'voice-1')
    expect(await page.recall('Take five.')).toBe('a'.repeat(64))

    const later = browserClipMemory(() => storage as unknown as Storage)
    await later.remember('Not quite.', 'c'.repeat(64), 'voice-2')
    expect(await later.recall('Take five.')).toBeNull()
    expect(await later.recall('Not quite.')).toBe('c'.repeat(64))
  })

  it('forgets everything when the voice or its settings change', async () => {
    const storage = new FakeStorage()
    const memory = browserClipMemory(() => storage as unknown as Storage)
    await memory.remember('Got it.', 'a'.repeat(64), 'voice-1')
    await memory.remember('Take five.', 'b'.repeat(64), 'voice-2')
    expect(await memory.recall('Got it.')).toBeNull()
    expect(await memory.recall('Take five.')).toBe('b'.repeat(64))
  })

  it('shrugs off storage that can’t even be reached (site data blocked)', async () => {
    const memory = browserClipMemory(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    expect(await memory.recall('Got it.')).toBeNull()
    await expect(memory.remember('Got it.', 'a'.repeat(64), 'v')).resolves.toBeUndefined()
    await expect(memory.forget('Got it.')).resolves.toBeUndefined()
  })

  it('shrugs off broken or full storage', async () => {
    const storage = new FakeStorage()
    storage.items.set('coach-study:voice-clips', '{not json')
    const memory = browserClipMemory(() => storage as unknown as Storage)
    expect(await memory.recall('Got it.')).toBeNull()
    storage.full = true
    await expect(memory.remember('Got it.', 'a'.repeat(64), 'v')).resolves.toBeUndefined()
  })

  it('keeps at most 3,000 lines, dropping the oldest', async () => {
    const storage = new FakeStorage()
    const clips = Object.fromEntries(
      Array.from({ length: 3000 }, (_, i) => [`h${String(i)}`, 'a'.repeat(64)]),
    )
    storage.items.set('coach-study:voice-clips', JSON.stringify({ voice: 'v', clips }))
    const memory = browserClipMemory(() => storage as unknown as Storage)
    await memory.remember('Got it.', 'b'.repeat(64), 'v')
    const kept = JSON.parse(storage.items.get('coach-study:voice-clips') ?? '{}') as {
      clips: Record<string, string>
    }
    expect(Object.keys(kept.clips)).toHaveLength(3000)
    expect(kept.clips.h0).toBeUndefined()
    expect(await memory.recall('Got it.')).toBe('b'.repeat(64))
  })
})

describe('appVoice and primeVoice', () => {
  it('one voice per page; the prime unlocks both voices inside the tap', () => {
    const said: string[] = []
    const audio = new FakeAudio()
    stubWindow({
      speechSynthesis: {
        speak: (utterance: { text: string }) => said.push(utterance.text),
        cancel: () => undefined,
        speaking: false,
      },
      localStorage: new FakeStorage(),
      fetch: () => Promise.reject(new Error('offline')),
    })
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        constructor(public text: string) {}
      },
    )
    vi.stubGlobal('Audio', function FakeAudioElement() {
      return audio
    })
    expect(appVoice()).toBe(appVoice())
    expect(voicePrimed()).toBe(false)
    primeVoice()

    expect(voicePrimed()).toBe(true)
    expect(said).toEqual([''])
    expect(audio.src).toBe(SILENT_WAV)
    expect(audio.plays).toBe(1)
    expect(appVoice().audible()).toBe(false)
  })

  it('asks for every line without its clip memory (off) and reports a fallback', async () => {
    expect(VOICE_SETTINGS.clipMemory).toBe(false)
    const asked: { url: string; body: string }[] = []
    const spoken: string[] = []
    const win = stubWindow({
      speechSynthesis: {
        getVoices: () => [],
        speak: (utterance: { text: string; onend?: () => void }) => {
          spoken.push(utterance.text)
          setTimeout(() => utterance.onend?.(), 0)
        },
        cancel: () => undefined,
        speaking: false,
      },
      fetch: (url: string, init: RequestInit) => {
        asked.push({ url, body: typeof init.body === 'string' ? init.body : '' })
        return Promise.resolve(
          Response.json({ error: 'no-key', fallback: 'system-voice' }, { status: 503 }),
        )
      },
    })
    let storageRead = false
    Object.defineProperty(win, 'localStorage', {
      get: () => {
        storageRead = true
        return new FakeStorage()
      },
    })

    vi.stubGlobal('navigator', {})
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        constructor(public text: string) {}
      },
    )
    vi.stubGlobal('Audio', function FakeAudioElement() {
      return new FakeAudio()
    })
    expect(await appVoice().speak('Got it.')).toMatchObject({ ok: true })
    expect(spoken).toEqual(['Got it.'])
    expect(asked.map((request) => request.url)).toEqual(['/api/tts', FALLBACK_REPORT_PATH])
    expect(JSON.parse(asked[1]?.body ?? '')).toMatchObject({ reason: 'status-503', chars: 7 })
    expect(storageRead).toBe(false)
  })
})
