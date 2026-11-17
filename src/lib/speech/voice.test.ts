import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CUE_START_MS, CUE_STUCK_MS, type SoundId } from '../sound/catalog'
import { fallbackReportSchema, type FallbackReport } from '../tts/fallback'
import { TTS_MAX_CHARS } from '../tts/line'

import { SpeechController, type Clock } from './controller'
import {
  AppVoice,
  lineLimitMs,
  TTS_START_MS,
  type ClipMemory,
  type Player,
  type VoiceDeps,
} from './voice'

type Events = Parameters<Player['start']>[1]

class FakePlayer implements Player {
  src = ''
  events: Events | null = null
  started: string[] = []
  stops = 0
  unlocks = 0
  refuse: Error | null = null
  playing = false
  start(src: string, events: Events): Promise<void> {
    this.started.push(src)
    this.src = src
    this.events = events
    if (this.refuse) return Promise.reject(this.refuse)
    return Promise.resolve()
  }
  stop(): void {
    this.stops += 1
    this.events = null
    this.playing = false
  }
  unlock(): void {
    this.unlocks += 1
  }

  begin(): void {
    this.playing = true
    this.events?.playing()
  }
  end(): void {
    this.playing = false
    this.events?.ended()
  }
  fail(): void {
    this.playing = false
    this.events?.failed()
  }
}

class FakeSystem {
  said: string[] = []
  cancels = 0
  speakingNow = false
  ok = true
  private pending: ((said: { ok: boolean; ms: number }) => void) | null = null
  speak = (text: string): Promise<{ ok: boolean; ms: number }> => {
    this.said.push(text)
    this.speakingNow = true
    return new Promise((resolve) => {
      this.pending = resolve
      setTimeout(() => {
        this.finish()
      }, 1000)
    })
  }
  cancel = (): void => {
    this.cancels += 1
    this.finish(false)
  }
  speaking = (): boolean => this.speakingNow
  private finish(ok = this.ok): void {
    this.speakingNow = false
    const resolve = this.pending
    this.pending = null
    resolve?.({ ok, ms: 1000 })
  }
}

const clock: Clock = {
  now: () => Date.now(),
  setTimeout: (run, ms) => Number(setTimeout(run, ms)),
  clearTimeout: (id) => {
    clearTimeout(id)
  },
}

function audioResponse(): Response {
  return new Response(new Uint8Array([0xff, 0xfb, 1, 2]), {
    headers: { 'Content-Type': 'audio/mpeg', 'X-Tts-Clip': 'c'.repeat(64), 'X-Tts-Voice': 'v1' },
  })
}

function noKey(): Response {
  return Response.json({ error: 'no-key', fallback: 'system-voice' }, { status: 503 })
}

type Requested = { url: string; init: RequestInit }

function setup(
  answer: (init: RequestInit) => Promise<Response> = () => Promise.resolve(audioResponse()),
) {
  const player = new FakePlayer()
  const system = new FakeSystem()
  const requests: Requested[] = []
  const urls = { made: 0, revoked: [] as string[] }
  const remembered = new Map<string, string>()
  const reports: FallbackReport[] = []
  const memory: ClipMemory = {
    recall: (line) => Promise.resolve(remembered.get(line) ?? null),
    remember: (line, clip) => {
      remembered.set(line, clip)
      return Promise.resolve()
    },
    forget: (line) => {
      remembered.delete(line)
      return Promise.resolve()
    },
  }
  const deps: VoiceDeps = {
    fetch: (url, init) => {
      requests.push({ url, init })
      return answer(init)
    },
    player,
    system,
    clock,
    now: () => Date.now(),
    objectUrl: {
      create: () => `blob:line-${String(++urls.made)}`,
      revoke: (url) => {
        urls.revoked.push(url)
      },
    },
    memory,
    report: (fallback) => {
      expect(fallbackReportSchema.parse(fallback)).toEqual(fallback)
      reports.push(fallback)
    },
  }
  return { voice: new AppVoice(deps), player, system, requests, urls, remembered, reports }
}

function report(
  reason: FallbackReport['reason'],
  reached: Partial<FallbackReport> = {},
  chars = 'Got it.'.length,
): FallbackReport {
  return {
    reason,
    chars,
    atMs: 0,
    replayMs: null,
    requestMs: null,
    headersMs: null,
    blobMs: null,
    playMs: null,
    ...reached,
  }
}

const settle = () => vi.advanceTimersByTimeAsync(0)

describe('AppVoice', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('plays the line from /api/tts and resolves when it has ended', async () => {
    const { voice, player, system, requests, urls, remembered } = setup()
    let result: { ok: boolean } | null = null
    void voice.speak('Sample move a: which parts carry it?').then((r) => (result = r))
    await settle()
    expect(requests).toEqual([
      {
        url: '/api/tts',
        init: expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ text: 'Sample move a: which parts carry it?' }),
        }) as RequestInit,
      },
    ])
    expect(player.started).toEqual(['blob:line-1'])
    player.begin()
    expect(voice.audible()).toBe(true)
    await settle()
    expect(result).toBeNull()
    player.end()
    await settle()
    expect(result).toEqual({ ok: true, ms: expect.any(Number) as number })
    expect(system.said).toEqual([])
    expect(urls.revoked).toEqual(['blob:line-1'])
    expect(remembered.get('Sample move a: which parts carry it?')).toBe('c'.repeat(64))
  })

  it('plays a line heard before from its clip URL, which the iPad keeps', async () => {
    const { voice, player, requests, remembered } = setup()
    remembered.set('Take five.', 'd'.repeat(64))
    const said = voice.speak('Take five.')
    await settle()
    expect(player.started).toEqual([`/api/tts/${'d'.repeat(64)}`])
    player.begin()
    player.end()
    expect(await said).toMatchObject({ ok: true })
    expect(requests).toEqual([])
  })

  it('a remembered clip that fails is forgotten and asked for again', async () => {
    const { voice, player, requests, remembered } = setup()
    remembered.set('Take five.', 'd'.repeat(64))
    const said = voice.speak('Take five.')
    await settle()
    player.fail()
    await settle()
    expect(requests).toHaveLength(1)
    expect(player.started).toEqual([`/api/tts/${'d'.repeat(64)}`, 'blob:line-1'])
    expect(remembered.get('Take five.')).toBe('c'.repeat(64))
    player.begin()
    player.end()
    expect(await said).toMatchObject({ ok: true })
  })

  it('says the spoken words in both voices: the request and the fallback alike', async () => {
    const { voice, system, requests } = setup(() => Promise.resolve(noKey()))
    const said = voice.speak('Wait 3:00. Then salt + pepper.')
    await settle()
    const words = 'Wait 3 minutes. Then salt and pepper.'
    expect(requests[0]?.init.body).toBe(JSON.stringify({ text: words }))
    expect(system.said).toEqual([words])
    await vi.advanceTimersByTimeAsync(1000)
    expect(await said).toMatchObject({ ok: true })
  })

  describe('falls back to the iPad’s own voice for the line', () => {
    const fallsBack = async (
      answer: (init: RequestInit) => Promise<Response>,
      act: (player: FakePlayer) => void = () => undefined,
    ) => {
      const { voice, player, system, reports } = setup(answer)
      const said = voice.speak('Got it.')
      await settle()
      act(player)
      await settle()
      expect(system.said).toEqual(['Got it.'])
      await vi.advanceTimersByTimeAsync(1000)
      expect(await said).toMatchObject({ ok: true })
      return { player, system, reports }
    }
    const answered = { requestMs: 0, headersMs: 0 }
    const fetched = { ...answered, blobMs: 0, playMs: 0 }

    it('with no key on the server (503 no-key)', async () => {
      const { reports } = await fallsBack(() => Promise.resolve(noKey()))
      expect(reports).toEqual([report('status-503', answered)])
    })
    it('over the daily budget (429) or any error status', async () => {
      const budget = await fallsBack(() =>
        Promise.resolve(Response.json({ error: 'budget' }, { status: 429 })),
      )
      expect(budget.reports).toEqual([report('status-429', answered)])
      const oops = await fallsBack(() => Promise.resolve(new Response('oops', { status: 500 })))
      expect(oops.reports).toEqual([report('status-500', answered)])
    })
    it('offline (the request fails)', async () => {
      const { reports } = await fallsBack(() => Promise.reject(new TypeError('Load failed')))
      expect(reports).toEqual([report('network', { requestMs: 0 })])
    })
    it('when the answer isn’t audio', async () => {
      const { reports } = await fallsBack(() => Promise.resolve(Response.json({ ok: true })))
      expect(reports).toEqual([report('not-audio', answered)])
    })
    it('when the browser refuses to play it', async () => {
      const { voice, player, system, reports } = setup()
      player.refuse = new DOMException('not allowed', 'NotAllowedError')
      const said = voice.speak('Got it.')
      await settle()
      expect(system.said).toEqual(['Got it.'])
      await vi.advanceTimersByTimeAsync(1000)
      expect(await said).toMatchObject({ ok: true })
      expect(reports).toEqual([report('play-refused', fetched)])
    })
    it('when the element can’t play it (rejected for any other reason)', async () => {
      const { voice, player, system, reports } = setup()
      player.refuse = new DOMException('no supported source', 'NotSupportedError')
      const said = voice.speak('Got it.')
      await settle()
      expect(system.said).toEqual(['Got it.'])
      await vi.advanceTimersByTimeAsync(1000)
      expect(await said).toMatchObject({ ok: true })
      expect(reports).toEqual([report('play-error', fetched)])
    })
    it('on a playback error before it starts', async () => {
      const { reports } = await fallsBack(
        () => Promise.resolve(audioResponse()),
        (player) => {
          player.fail()
        },
      )
      expect(reports).toEqual([report('play-error', fetched)])
    })
    it('on a playback error mid-line: the whole line, from the start', async () => {
      const { player, reports } = await fallsBack(
        () => Promise.resolve(audioResponse()),
        (player) => {
          player.begin()
          player.fail()
        },
      )
      expect(player.stops).toBeGreaterThan(0)
      expect(reports).toEqual([report('mid-line', fetched)])
    })
    it('when nothing is playing TTS_START_MS after it was asked for', async () => {
      const { voice, player, system, requests, reports } = setup(
        (init) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              reject(new DOMException('aborted', 'AbortError'))
            })
          }),
      )
      const said = voice.speak('Got it.')
      await vi.advanceTimersByTimeAsync(TTS_START_MS - 1)
      expect(system.said).toEqual([])
      await vi.advanceTimersByTimeAsync(1)
      expect(system.said).toEqual(['Got it.'])
      expect(requests[0]?.init.signal?.aborted).toBe(true)

      expect(player.started).toEqual([])
      await vi.advanceTimersByTimeAsync(1000)
      expect(await said).toMatchObject({ ok: true })

      expect(reports).toEqual([report('start-timeout', { requestMs: 0, atMs: TTS_START_MS })])
    })
    it('when the audio arrives but never starts playing', async () => {
      const { voice, player, system, reports } = setup()
      const said = voice.speak('Got it.')
      await settle()
      expect(player.started).toEqual(['blob:line-1'])
      await vi.advanceTimersByTimeAsync(TTS_START_MS)
      expect(system.said).toEqual(['Got it.'])
      expect(player.stops).toBe(1)

      player.events?.playing()
      await vi.advanceTimersByTimeAsync(1000)
      expect(await said).toMatchObject({ ok: true })
      expect(reports).toEqual([report('start-timeout', { ...fetched, atMs: TTS_START_MS })])
    })
    it('when a replay from the clip URL hasn’t started by the limit (never asked again)', async () => {
      const { voice, player, system, requests, reports, remembered } = setup()
      remembered.set('Got it.', 'd'.repeat(64))
      const said = voice.speak('Got it.')
      await settle()
      expect(player.started).toEqual([`/api/tts/${'d'.repeat(64)}`])
      await vi.advanceTimersByTimeAsync(TTS_START_MS)
      expect(system.said).toEqual(['Got it.'])
      expect(requests).toEqual([])
      await vi.advanceTimersByTimeAsync(1000)
      expect(await said).toMatchObject({ ok: true })
      expect(reports).toEqual([report('start-timeout', { replayMs: 0, atMs: TTS_START_MS })])
    })
    it('and the line still ends when the system voice itself fails', async () => {
      const { voice, system, reports } = setup(() => Promise.resolve(noKey()))
      system.speak = (text: string) => {
        system.said.push(text)
        return Promise.reject(new Error('no utterance'))
      }
      const said = voice.speak('Got it.')
      await settle()
      expect(await said).toMatchObject({ ok: false })
      expect(reports).toEqual([report('status-503', answered)])
    })
    it('for a line too long to send, without asking', async () => {
      const { voice, system, requests, reports } = setup()
      const long = 'x'.repeat(TTS_MAX_CHARS + 1)
      const said = voice.speak(long)
      await settle()
      expect(requests).toEqual([])
      expect(system.said).toEqual([long])
      await vi.advanceTimersByTimeAsync(1000)
      expect(await said).toMatchObject({ ok: true })
      expect(reports).toEqual([report('too-long', {}, long.length)])
    })
  })

  describe('reports each fallback', () => {
    it('with the time of each step, in ms after the line was asked', async () => {
      const { voice, player, reports } = setup(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve(audioResponse())
            }, 300)
          }),
      )
      const said = voice.speak('Got it.')
      await vi.advanceTimersByTimeAsync(300)
      expect(player.started).toEqual(['blob:line-1'])
      await vi.advanceTimersByTimeAsync(200)
      player.fail()
      await vi.advanceTimersByTimeAsync(1000)
      await said
      expect(reports).toEqual([
        report('play-error', {
          requestMs: 0,
          headersMs: 300,
          blobMs: 300,
          playMs: 300,
          atMs: 500,
        }),
      ])
    })
    it('the line’s length, never its words', async () => {
      const { voice, reports } = setup(() => Promise.resolve(noKey()))
      const line = '  Sample move a:   which parts carry it? '
      void voice.speak(line)
      await settle()
      expect(reports).toHaveLength(1)
      expect(reports[0]?.chars).toBe('Sample move a: which parts carry it?'.length)
      expect(JSON.stringify(reports)).not.toMatch(/sample move a|which parts carry/i)
    })
    it('nothing for a line that played, was cut short, or had nothing to say', async () => {
      const { voice, player, system, reports } = setup()
      const played = voice.speak('Got it.')
      await settle()
      player.begin()
      player.end()
      await played
      const cut = voice.speak('Take five.')
      await settle()
      voice.cancel()
      await cut
      const empty = voice.speak('   ')
      await vi.advanceTimersByTimeAsync(1000)
      await empty

      expect(system.said).toEqual([''])
      expect(reports).toEqual([])
    })
    it('one report per line, however many things then fail', async () => {
      const { voice, player, reports } = setup()
      const said = voice.speak('Got it.')
      await settle()
      const events = player.events
      await vi.advanceTimersByTimeAsync(TTS_START_MS)

      events?.failed()
      await vi.advanceTimersByTimeAsync(1000)
      await said
      expect(reports.map((r) => r.reason)).toEqual(['start-timeout'])
    })
    it('a report that can’t be sent never stops the line', async () => {
      const player = new FakePlayer()
      const system = new FakeSystem()
      const voice = new AppVoice({
        fetch: () => Promise.resolve(noKey()),
        player,
        system,
        clock,
        now: () => Date.now(),
        objectUrl: { create: () => 'blob:x', revoke: () => undefined },
        report: () => {
          throw new Error('no beacon')
        },
      })
      const said = voice.speak('Got it.')
      await settle()
      expect(system.said).toEqual(['Got it.'])
      await vi.advanceTimersByTimeAsync(1000)
      expect(await said).toMatchObject({ ok: true })
    })
  })

  it('gives up on a line that started but never ended', async () => {
    const { voice, player, system } = setup()
    const said = voice.speak('Got it.')
    await settle()
    player.begin()
    await vi.advanceTimersByTimeAsync(lineLimitMs('Got it.'))
    expect(await said).toMatchObject({ ok: false })
    expect(player.stops).toBe(1)
    expect(system.said).toEqual([])
  })

  describe('cancel (Space skips the rest)', () => {
    it('while the line is being fetched: resolves, nothing plays, nothing falls back', async () => {
      let release: (response: Response) => void = () => undefined
      const { voice, player, system, requests } = setup(
        () =>
          new Promise((resolve) => {
            release = resolve
          }),
      )
      const said = voice.speak('Got it.')
      await settle()
      voice.cancel()
      expect(await said).toMatchObject({ ok: false })
      expect(requests[0]?.init.signal?.aborted).toBe(true)
      release(audioResponse())
      await vi.advanceTimersByTimeAsync(TTS_START_MS)
      expect(player.started).toEqual([])
      expect(system.said).toEqual([])
    })
    it('while it plays: stops the element at once', async () => {
      const { voice, player } = setup()
      const said = voice.speak('Got it.')
      await settle()
      player.begin()
      voice.cancel()
      expect(await said).toMatchObject({ ok: false })
      expect(player.stops).toBe(1)
      expect(voice.audible()).toBe(false)
    })
    it('while the system voice says it: quiets the system voice', async () => {
      const { voice, system } = setup(() => Promise.resolve(noKey()))
      const said = voice.speak('Got it.')
      await settle()
      expect(system.said).toEqual(['Got it.'])
      voice.cancel()
      expect(await said).toMatchObject({ ok: false })
      expect(system.cancels).toBeGreaterThan(0)
    })
    it('a new line ends the one before', async () => {
      const { voice, player } = setup()
      const first = voice.speak('First.')
      await settle()
      player.begin()
      const second = voice.speak('Second.')
      expect(await first).toMatchObject({ ok: false })
      await settle()
      player.begin()
      player.end()
      expect(await second).toMatchObject({ ok: true })
    })
  })

  it('unlocks the element inside a tap, but never over a line', async () => {
    const { voice, player } = setup()
    voice.unlock()
    expect(player.unlocks).toBe(1)
    const said = voice.speak('Got it.')
    voice.unlock()
    expect(player.unlocks).toBe(1)
    await settle()
    player.begin()
    player.end()
    await said
    voice.unlock()
    expect(player.unlocks).toBe(2)
  })

  it('settled() waits for the line to play or fall back; audible() follows either voice', async () => {
    const { voice, player, system } = setup()
    expect(voice.audible()).toBe(false)
    await voice.settled()
    void voice.speak('Got it.')
    let settled = false
    void voice.settled().then(() => (settled = true))
    await settle()
    expect(settled).toBe(false)
    player.begin()
    await settle()
    expect(settled).toBe(true)
    voice.cancel()
    system.speakingNow = true
    expect(voice.audible()).toBe(true)
  })

  it('behind the controller: listening starts only after the line has ended', async () => {
    const { voice, player } = setup()
    const starts: number[] = []
    class Recognition {
      continuous = false
      interimResults = false
      lang = ''
      maxAlternatives = 1
      onresult = null
      onerror = null
      onend = null
      start() {
        starts.push(Date.now())
      }
      stop() {
        // no-op
      }
      abort() {
        // no-op
      }
    }
    const controller = new SpeechController(
      Recognition as unknown as SpeechRecognitionConstructor,
      voice,
      clock,
    )
    const flow = (async () => {
      await controller.speak('Sample move a: which parts carry it?')
      void controller.listen({ endOn: 'silence' })
    })()
    await settle()
    player.begin()
    await vi.advanceTimersByTimeAsync(3000)
    expect(starts).toEqual([])
    player.end()
    await flow
    expect(starts).toHaveLength(1)
    controller.stop()
  })
})

function withSounds(
  url: (id: SoundId) => Promise<string | null> = (id) => Promise.resolve(`blob:${id}`),
) {
  const made = setup()
  const on = { value: true }
  const asked: SoundId[] = []
  const voice = new AppVoice({
    fetch: () => Promise.reject(new Error('no lines in these tests')),
    player: made.player,
    system: made.system,
    clock,
    now: () => Date.now(),
    objectUrl: { create: () => 'blob:line', revoke: () => undefined },
    sounds: {
      on: () => on.value,
      url: (id) => {
        asked.push(id)
        return url(id)
      },
      lengthMs: () => 150,
    },
  })
  return { ...made, voice, on, asked }
}

describe('AppVoice: sound effects', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('a cue plays on the shared player', async () => {
    const { voice, player, system } = withSounds()
    let result: { played: boolean } | null = null
    void voice.cue('right').then((r) => (result = r))
    await settle()
    expect(player.started).toEqual(['blob:right'])
    player.begin()
    expect(voice.audible()).toBe(true)
    await settle()
    expect(result).toBeNull()
    player.end()
    await settle()
    expect(result).toEqual({ played: true })
    expect(system.said).toEqual([])
  })

  it('a cue with no URL resolves at once', async () => {
    const { voice, player } = withSounds(() => Promise.resolve(null))
    expect(await voice.cue('done')).toEqual({ played: false })
    expect(player.started).toEqual([])
    expect(player.stops).toBe(0)
  })

  it('a refused cue resolves', async () => {
    const { voice, player, system } = withSounds()
    player.refuse = new Error('NotAllowedError')
    const result = voice.cue('right')
    await settle()
    expect(await result).toEqual({ played: false })
    expect(system.said).toEqual([])
  })

  it('a late cue is skipped after 300 ms', async () => {
    const { voice, player } = withSounds()
    let result: { played: boolean } | null = null
    void voice.cue('right').then((r) => (result = r))
    await vi.advanceTimersByTimeAsync(CUE_START_MS - 1)
    expect(result).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    expect(result).toEqual({ played: false })
    expect(player.stops).toBe(1)

    player.begin()
    expect(voice.audible()).toBe(false)
  })

  it('a late URL is skipped after 300 ms and never plays', async () => {
    let give: (url: string) => void = () => undefined
    const { voice, player } = withSounds(
      () =>
        new Promise((resolve) => {
          give = resolve
        }),
    )
    const result = voice.cue('listen-on')
    await vi.advanceTimersByTimeAsync(CUE_START_MS)
    expect(await result).toEqual({ played: false })
    give('blob:listen-on')
    await settle()
    expect(player.started).toEqual([])
  })

  it('a stuck cue stops at its length plus 250 ms', async () => {
    const { voice, player } = withSounds()
    let result: { played: boolean } | null = null
    void voice.cue('listen-on').then((r) => (result = r))
    await settle()
    player.begin()
    await vi.advanceTimersByTimeAsync(150 + CUE_STUCK_MS - 1)
    expect(result).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    expect(result).toEqual({ played: true })
    expect(player.stops).toBe(1)
  })

  it('a cue error resolves without the system voice', async () => {
    const { voice, player, system } = withSounds()
    const result = voice.cue('break')
    await settle()
    player.begin()
    player.fail()
    expect(await result).toEqual({ played: true })
    expect(system.said).toEqual([])
    expect(player.stops).toBe(1)
  })

  it('cancel cuts a cue', async () => {
    const { voice, player } = withSounds()
    const result = voice.cue('done')
    await settle()
    player.begin()
    voice.cancel()
    expect(await result).toEqual({ played: true })
    expect(player.stops).toBe(1)
    expect(voice.audible()).toBe(false)
  })

  it('sounds off: no URL asked, no player call', async () => {
    const { voice, player, on, asked } = withSounds()
    on.value = false
    expect(await voice.cue('right')).toEqual({ played: false })
    expect(asked).toEqual([])
    expect(player.started).toEqual([])
  })

  it('no sounds wired (the voice test, a server render): a cue does nothing', async () => {
    const { voice, player } = setup()
    expect(await voice.cue('right')).toEqual({ played: false })
    expect(player.started).toEqual([])
  })

  it('a cue with no file never cuts a line; one about to play does', async () => {
    const { voice, player, system } = withSounds((id) =>
      Promise.resolve(id === 'listen-on' ? null : `blob:${id}`),
    )
    const line = { done: false }

    void system.speak('Take five.').then(() => (line.done = true))
    expect(await voice.cue('listen-on')).toEqual({ played: false })
    expect(system.cancels).toBe(0)
    expect(line.done).toBe(false)
    void voice.cue('right')
    await settle()

    expect(system.cancels).toBe(1)
    expect(player.started).toEqual(['blob:right'])
  })

  it('a cue nothing waits on may take longer to start (its file still loading)', async () => {
    let give: (url: string) => void = () => undefined
    const { voice, player } = withSounds(
      () =>
        new Promise((resolve) => {
          give = resolve
        }),
    )
    let result: { played: boolean } | null = null
    void voice.cue('promoted', 2000).then((r) => (result = r))
    await vi.advanceTimersByTimeAsync(CUE_START_MS + 500)
    expect(result).toBeNull()
    give('blob:promoted')
    await settle()
    expect(player.started).toEqual(['blob:promoted'])
    player.begin()
    player.end()
    await settle()
    expect(result).toEqual({ played: true })
  })

  it('sounds turned off while a cue waits for its file: it never plays', async () => {
    let give: (url: string) => void = () => undefined
    const { voice, player, on } = withSounds(
      () =>
        new Promise((resolve) => {
          give = resolve
        }),
    )
    const result = voice.cue('listen-on', 2000)
    await vi.advanceTimersByTimeAsync(300)
    on.value = false
    give('blob:listen-on')
    expect(await result).toEqual({ played: false })
    expect(player.started).toEqual([])
  })

  it('stopCue cuts a sound effect, never a line', async () => {
    const { voice, player, system } = withSounds()
    const result = voice.cue('break')
    await settle()
    player.begin()
    const line = system.speak('Take five.')
    const cancelsBefore = system.cancels
    voice.stopCue()
    expect(await result).toEqual({ played: true })
    expect(player.stops).toBe(1)

    expect(system.cancels).toBe(cancelsBefore)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await line).toEqual({ ok: true, ms: 1000 })
  })

  it('stopLine cuts a line, never a sound effect playing (the learner sent their answer)', async () => {
    const { voice, player, system } = withSounds()
    let result: { played: boolean } | null = null
    void voice.cue('listen-off').then((r) => (result = r))
    await settle()
    player.begin()
    const stopsBefore = player.stops
    voice.stopLine()

    expect(system.cancels).toBeGreaterThan(0)
    expect(player.stops).toBe(stopsBefore)
    expect(voice.audible()).toBe(true)
    await settle()
    expect(result).toBeNull()
    player.end()
    await settle()
    expect(result).toEqual({ played: true })
  })

  it('a cue still waiting for its file never stops a line on the element', async () => {
    let give: (url: string) => void = () => undefined
    const made = withSounds(
      () =>
        new Promise((resolve) => {
          give = resolve
        }),
    )

    made.player.playing = true
    const stopsBefore = made.player.stops
    const result = made.voice.cue('listen-on', 2000)
    made.voice.stopCue()
    expect(await result).toEqual({ played: false })
    expect(made.player.stops).toBe(stopsBefore)
    give('blob:listen-on')
    await settle()
    expect(made.player.started).toEqual([])
  })

  it('the Turn on sounds preview waits for "Take five." to end, then plays', async () => {
    const { voice, player, system } = withSounds()

    const line = voice.speak('Take five.')
    await settle()
    expect(system.said).toEqual(['Take five.'])
    const cancelsBefore = system.cancels
    let result: { played: boolean } | null = null
    void voice.preview('listen-on').then((r) => (result = r))
    await vi.advanceTimersByTimeAsync(500)
    expect(system.cancels).toBe(cancelsBefore)
    expect(player.started).toEqual([])
    await vi.advanceTimersByTimeAsync(500)
    expect(await line).toMatchObject({ ok: true })
    await settle()
    expect(player.started).toEqual(['blob:listen-on'])
    player.begin()
    player.end()
    await settle()
    expect(result).toEqual({ played: true })
  })

  it('a preview still waiting for the line is dropped when the voice stops (Back to it)', async () => {
    const { voice, player } = withSounds()
    void voice.speak('Take five.')
    await settle()
    const result = voice.preview('listen-on')
    voice.cancel()
    expect(await result).toEqual({ played: false })
    await vi.advanceTimersByTimeAsync(2000)
    expect(player.started).toEqual([])
  })

  it('a preview with no line going plays at once', async () => {
    const { voice, player } = withSounds()
    void voice.preview('listen-on')
    await settle()
    expect(player.started).toEqual(['blob:listen-on'])
  })

  it('unlock never cuts a cue', async () => {
    const { voice, player } = withSounds()
    void voice.cue('right')
    await settle()
    voice.unlock()
    expect(player.unlocks).toBe(0)
  })
})
