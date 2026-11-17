import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SoundId } from '../sound/catalog'

import {
  asCommand,
  commandIn,
  END_WAIT_MS,
  RELEASE_GRACE_MS,
  RESTART_RETRY_MS,
  RESTART_TRIES,
  retime,
  SpeechController,
  words,
  type Clock,
  type ListenOptions,
  type MicIssue,
  type Synth,
} from './controller'
import { AppVoice } from './voice'

describe('retime', () => {
  const said = (...pairs: [string, number][]) => pairs.map(([text, atMs]) => ({ text, atMs }))
  it('times new words now and keeps the rest', () => {
    expect(retime(said(['row', 100], ['2', 200]), ['row', '2', 'robin'], 900)).toEqual(
      said(['row', 100], ['2', 200], ['robin', 900]),
    )
  })
  it('keeps the times after a word Safari slipped in or revised mid-way', () => {
    const before = said(['hands', 100], ['front', 200], ['rail', 300], ['feet', 400])
    expect(retime(before, ['hands', 'on', 'front', 'rail', 'feet'], 900)).toEqual(
      said(['hands', 100], ['on', 900], ['front', 200], ['rail', 300], ['feet', 400]),
    )
    expect(retime(before, ['hands', 'green', 'rail', 'feet'], 900)).toEqual(
      said(['hands', 100], ['green', 900], ['rail', 300], ['feet', 400]),
    )
  })
  it('never gives new words that repeat the old ones the old times', () => {
    expect(retime(said(['one', 1], ['two', 2]), ['won', 'two', 'one', 'two'], 9)).toEqual(
      said(['won', 9], ['two', 2], ['one', 9], ['two', 9]),
    )
  })
  it('handles words dropped from the end and a fresh start', () => {
    expect(retime(said(['a', 1], ['b', 2], ['c', 3]), ['a', 'b'], 9)).toEqual(
      said(['a', 1], ['b', 2]),
    )
    expect(retime([], ['a', 'b'], 9)).toEqual(said(['a', 9], ['b', 9]))
    expect(retime(said(['a', 1]), [], 9)).toEqual([])
  })
})

class FakeRecognition {
  static last: FakeRecognition | undefined
  static failStart = false

  static onStart: (() => void) | null = null
  continuous = false
  interimResults = false
  lang = ''
  maxAlternatives = 1
  starts = 0
  aborted = 0
  stops = 0
  onresult: ((event: SpeechRecognitionEvent) => void) | null = null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null = null
  onend: ((event: Event) => void) | null = null
  onstart = null
  onaudiostart = null
  onsoundstart = null
  onspeechstart = null
  constructor() {
    FakeRecognition.last = this
  }
  start() {
    if (FakeRecognition.failStart) throw new Error('InvalidStateError')
    this.starts += 1
    FakeRecognition.onStart?.()
  }
  stop() {
    this.stops += 1
  }
  abort() {
    this.aborted += 1
  }
  say(text: string) {
    this.sayChunks([text])
  }

  sayChunks(chunks: readonly string[]) {
    const list = chunks.map((text) => {
      const alternative = { transcript: text, confidence: 0.9 }
      return Object.assign([alternative], { isFinal: true, item: () => alternative })
    })
    const results = Object.assign(list, { item: (i: number) => list[i] })
    this.onresult?.({ resultIndex: 0, results } as unknown as SpeechRecognitionEvent)
  }
  end() {
    this.onend?.(new Event('end'))
  }
  fail(error: string) {
    this.onerror?.({ error, message: '' } as unknown as SpeechRecognitionErrorEvent)
  }
}

const clock: Clock = {
  now: () => Date.now(),
  setTimeout: (run, ms) => Number(setTimeout(run, ms)),
  clearTimeout: (id) => {
    clearTimeout(id)
  },
}

function make(synth?: Synth) {
  const speak = synth ?? {
    speak: vi.fn(() => Promise.resolve({ ok: true, ms: 10 })),
    cancel: vi.fn(),
  }
  const controller = new SpeechController(
    FakeRecognition as unknown as SpeechRecognitionConstructor,
    speak,
    clock,
  )
  return { controller, speak }
}

const rec = () => {
  if (!FakeRecognition.last) throw new Error('no recognizer')
  return FakeRecognition.last
}

describe('helpers', () => {
  it('normalizes words and spoken numbers', () => {
    expect(words('In Fifteen, Ana: glidera!')).toEqual(['in', '15', 'ana', 'glidera'])
  })
  it('recognizes the six spoken commands, and only a whole utterance', () => {
    expect(asCommand('Show source.')).toBe('show source')
    expect(asCommand('I don’t know')).toBe("i don't know")
    expect(asCommand('skip the hold')).toBeUndefined()
  })
})

describe('SpeechController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeRecognition.failStart = false
    FakeRecognition.last = undefined
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('ends an answer after 2.5 s of silence, with first-heard word times', async () => {
    const { controller } = make()
    const result = controller.listen({ endOn: 'silence', commands: true })
    vi.advanceTimersByTime(800)
    rec().say('mats')
    vi.advanceTimersByTime(700)
    rec().say('mats with straps')
    vi.advanceTimersByTime(2499)
    expect(controller.isListening).toBe(true)
    vi.advanceTimersByTime(1)
    const r = await result
    expect(r).toMatchObject({
      transcript: 'mats with straps',
      endedBy: 'silence',
      stalled: false,
    })
    expect(r.words).toEqual([
      { text: 'mats', atMs: 800 },
      { text: 'with', atMs: 1500 },
      { text: 'straps', atMs: 1500 },
    ])
    expect(r.firstResultMs).toBe(800)
  })

  it('turns a whole-utterance command into a command result', async () => {
    const { controller } = make()
    const result = controller.listen({ endOn: 'silence', commands: true })
    rec().say('repeat')
    vi.advanceTimersByTime(2500)
    expect(await result).toMatchObject({ endedBy: 'command', command: 'repeat' })
  })

  it('reports every change in what it hears, for the live "You’re saying" box', async () => {
    const { controller } = make()
    const heard: { transcript: string; words: string[] }[] = []
    const starts: number[] = []
    const before = Date.now()
    const result = controller.listen({
      endOn: 'silence',
      onStart: (at) => starts.push(at),
      onHeard: (h) => heard.push({ transcript: h.transcript, words: h.words.map((w) => w.text) }),
    })
    expect(starts).toEqual([before])
    rec().say('hands front')
    vi.advanceTimersByTime(400)
    rec().say('hands front rail')
    vi.advanceTimersByTime(2500)
    await result
    expect(heard).toEqual([
      { transcript: 'hands front', words: ['hands', 'front'] },
      { transcript: 'hands front rail', words: ['hands', 'front', 'rail'] },
    ])
  })

  it('waits for an aborted session to end before the next listen starts', async () => {
    const { controller } = make()
    const first = controller.listen({ endOn: 'silence' })
    const recognizer = rec()
    recognizer.say('hands front rail')
    controller.stop()
    await first
    const second = controller.listen({ endOn: 'silence' })
    expect(recognizer.starts).toBe(1)
    recognizer.end()
    expect(recognizer.starts).toBe(2)
    recognizer.say('bags zone 1')
    vi.advanceTimersByTime(2500)
    expect(await second).toMatchObject({ transcript: 'bags zone 1', autoRestarts: 0 })
  })

  it('starts the next listen anyway when the aborted session never reports its end', async () => {
    const { controller } = make()
    const first = controller.listen({ endOn: 'silence' })
    controller.stop()
    await first
    const starts: number[] = []
    const asked = Date.now()
    const second = controller.listen({ endOn: 'silence', onStart: (at) => starts.push(at) })
    expect(rec().starts).toBe(1)
    expect(starts).toEqual([])
    vi.advanceTimersByTime(END_WAIT_MS)
    expect(rec().starts).toBe(2)

    expect(starts).toEqual([asked + END_WAIT_MS])
    controller.stop()
    await second
  })

  it('leaves a listen the learner ends with Space or Return as stopped, and commandIn still reads its command', async () => {
    const { controller } = make()

    const skipped = controller.listen({ endOn: 'silence', commands: true })
    rec().say('Skip.')
    controller.stop()
    const heard = await skipped
    expect(heard).toMatchObject({ endedBy: 'stopped', transcript: 'Skip.' })
    expect(heard.command).toBeUndefined()
    expect(commandIn(heard)).toBe('skip')

    vi.advanceTimersByTime(END_WAIT_MS)
    const unsure = controller.listen({ endOn: 'silence', commands: true })
    rec().say('I don’t know')
    controller.stop()
    expect(commandIn(await unsure)).toBe("i don't know")

    expect(commandIn({ transcript: 'skip the hold' })).toBeUndefined()
    expect(commandIn({ transcript: 'a mat' })).toBeUndefined()
    expect(commandIn({ transcript: '', command: 'pause' })).toBe('pause')
  })

  it('reads a whole-utterance command when a listen hits its time limit', async () => {
    const { controller } = make()
    const result = controller.listen({
      endOn: 'silence',
      commands: true,
      maxMs: 2000,
      silenceMs: 5000,
    })
    rec().say('pause')
    vi.advanceTimersByTime(2000)
    expect(await result).toMatchObject({ endedBy: 'command', command: 'pause' })
  })

  it('keeps what was heard and listens again when Safari stops on its own', async () => {
    const { controller } = make()
    const result = controller.listen({ endOn: 'silence' })
    rec().say('hands front rail')
    rec().end()
    expect(rec().starts).toBe(2)
    rec().say('bags zone 1')
    vi.advanceTimersByTime(2500)
    expect(await result).toMatchObject({
      transcript: 'hands front rail bags zone 1',
      autoRestarts: 1,
    })
  })

  it('marks a stall when nothing is heard, then ends at the time limit', async () => {
    const { controller } = make()
    const result = controller.listen({ endOn: 'silence', stallMs: 12_000, maxMs: 30_000 })
    vi.advanceTimersByTime(30_000)
    expect(await result).toMatchObject({ endedBy: 'max', stalled: true, transcript: '' })
  })

  it('reports a blocked microphone, and which kind of blocked', async () => {
    const { controller } = make()
    const result = controller.listen({ endOn: 'silence' })
    rec().fail('not-allowed')
    expect(await result).toMatchObject({
      endedBy: 'error',
      error: 'microphone-blocked',
      cause: 'not-allowed',
    })
    const off = controller.listen({ endOn: 'silence' })
    vi.advanceTimersByTime(END_WAIT_MS)
    rec().fail('service-not-allowed')
    expect(await off).toMatchObject({ error: 'microphone-blocked', cause: 'service-not-allowed' })
  })

  it('treats Safari pauses (no-speech) as normal and other errors as errors', async () => {
    const { controller } = make()
    const result = controller.listen({ endOn: 'silence' })
    rec().fail('no-speech')
    expect(controller.isListening).toBe(true)
    rec().fail('network')
    expect(await result).toMatchObject({ endedBy: 'error', error: 'network' })
  })

  it('never listens while speaking: speak() stops the current listen first', async () => {
    const { controller, speak } = make()
    const result = controller.listen({ endOn: 'silence' })
    await controller.speak('Next card.')
    expect(await result).toMatchObject({ endedBy: 'stopped', stalled: false })
    expect(speak.speak).toHaveBeenCalledWith('Next card.')
  })

  it('fails cleanly when listening cannot start', async () => {
    const { controller } = make()
    FakeRecognition.failStart = true
    expect(await controller.listen({ endOn: 'silence' })).toMatchObject({
      endedBy: 'error',
      stalled: true,
      error: 'could not start listening',
    })
  })

  it('fails cleanly when listening cannot restart', async () => {
    const { controller } = make()
    const result = controller.listen({ endOn: 'silence' })
    FakeRecognition.failStart = true
    rec().end()
    vi.advanceTimersByTime(RESTART_RETRY_MS * RESTART_TRIES)
    expect(await result).toMatchObject({ endedBy: 'error', error: 'could not restart listening' })
  })
})

describe('SpeechController: held answers (endOn release)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeRecognition.failStart = false
    FakeRecognition.last = undefined
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('never ends on silence: only their letting go ends it, with the last words in', async () => {
    const { controller, speak } = make()
    const result = controller.listen({ endOn: 'release' })

    expect(speak.cancel).toHaveBeenCalledTimes(1)
    rec().say('a mat')
    vi.advanceTimersByTime(60_000)
    expect(controller.isListening).toBe(true)
    controller.release()

    expect(rec().stops).toBe(1)
    expect(rec().aborted).toBe(0)
    rec().say('a mat a strap')
    rec().end()
    expect(await result).toMatchObject({
      transcript: 'a mat a strap',
      endedBy: 'stopped',
    })
    expect(rec().starts).toBe(1)
  })

  it('ends within the grace time if the recognizer never hands over', async () => {
    const { controller } = make()
    const result = controller.listen({ endOn: 'release' })
    rec().say('a mat')
    controller.release()
    vi.advanceTimersByTime(RELEASE_GRACE_MS)
    expect(await result).toMatchObject({ transcript: 'a mat', endedBy: 'stopped' })
  })

  it('a quick new hold right after one ended starts at once (nothing left to wait for)', async () => {
    const { controller } = make()
    const first = controller.listen({ endOn: 'release' })
    rec().say('one')
    controller.release()
    rec().end()
    await first
    const second = controller.listen({ endOn: 'release' })
    expect(rec().starts).toBe(2)
    controller.release()
    rec().end()
    expect(await second).toMatchObject({ endedBy: 'stopped' })
  })

  it('restarts when Safari ends on its own while the learner holds, keeps the words, and reports it', async () => {
    const issues: MicIssue[] = []
    const { controller } = make()
    const result = controller.listen({
      endOn: 'release',
      onIssue: (issue) => issues.push(issue),
    })
    vi.advanceTimersByTime(500)
    rec().say('a mat')
    vi.advanceTimersByTime(1000)
    rec().end()
    expect(rec().starts).toBe(2)
    expect(issues).toEqual([
      { reason: 'ended-early', endOn: 'release', atMs: 1500, restarts: 0, firstResultMs: 500 },
    ])
    rec().say('a strap')
    controller.release()
    rec().end()
    const r = await result
    expect(r.transcript).toBe('a mat a strap')
    expect(r.autoRestarts).toBe(1)
  })

  it('retries a refused restart, then gives up with a report', async () => {
    const issues: MicIssue[] = []
    const { controller } = make()
    const result = controller.listen({ endOn: 'release', onIssue: (issue) => issues.push(issue) })
    FakeRecognition.failStart = true
    rec().end()
    vi.advanceTimersByTime(RESTART_RETRY_MS)
    FakeRecognition.failStart = false
    vi.advanceTimersByTime(RESTART_RETRY_MS)
    expect(controller.isListening).toBe(true)
    expect(rec().starts).toBe(2)
    FakeRecognition.failStart = true
    rec().end()
    vi.advanceTimersByTime(RESTART_RETRY_MS * RESTART_TRIES)
    expect(await result).toMatchObject({ endedBy: 'error', error: 'could not restart listening' })
    expect(issues.map((issue) => issue.reason)).toEqual([
      'ended-early',
      'ended-early',
      'restart-failed',
    ])
  })

  it('reports errors, a blocked mic and a refused start; a quiet tap reports nothing', async () => {
    const issues: MicIssue[] = []
    const onIssue = (issue: MicIssue) => issues.push(issue)
    const { controller } = make()

    const noSpeech = controller.listen({ endOn: 'release', onIssue })
    rec().fail('no-speech')
    controller.release()
    rec().end()
    await noSpeech
    const blocked = controller.listen({ endOn: 'release', onIssue })
    rec().fail('not-allowed')
    expect(await blocked).toMatchObject({ endedBy: 'error', error: 'microphone-blocked' })
    vi.advanceTimersByTime(END_WAIT_MS)
    FakeRecognition.failStart = true
    expect(await controller.listen({ endOn: 'release', onIssue })).toMatchObject({
      endedBy: 'error',
      error: 'could not start listening',
    })
    expect(issues.map((issue) => issue.reason)).toEqual(['error-not-allowed', 'start-failed'])
  })

  it('Safari pausing on its own while the learner holds is one report, not two', async () => {
    const issues: MicIssue[] = []
    const { controller } = make()
    const result = controller.listen({ endOn: 'release', onIssue: (issue) => issues.push(issue) })
    rec().fail('no-speech')
    rec().end()
    expect(issues.map((issue) => issue.reason)).toEqual(['ended-early'])
    expect(rec().starts).toBe(2)
    controller.release()
    rec().end()
    await result
  })

  it('pressed again within the grace: the same listen carries on, nothing reported', async () => {
    const issues: MicIssue[] = []
    const { controller } = make()
    const result = controller.listen({ endOn: 'release', onIssue: (issue) => issues.push(issue) })
    rec().say('a mat')
    controller.release()
    expect(rec().stops).toBe(1)
    expect(controller.resume()).toBe(true)

    vi.advanceTimersByTime(RELEASE_GRACE_MS * 2)
    expect(controller.isListening).toBe(true)

    rec().end()
    expect(rec().starts).toBe(2)
    expect(issues).toEqual([])
    rec().say('a strap')
    controller.release()
    rec().end()
    expect(await result).toMatchObject({
      transcript: 'a mat a strap',
      endedBy: 'stopped',
    })

    expect(controller.resume()).toBe(false)
  })

  it('release() does nothing to a listen that ends on silence', async () => {
    const { controller } = make()
    const result = controller.listen({ endOn: 'silence' })
    rec().say('next')
    controller.release()
    expect(rec().stops).toBe(0)
    vi.advanceTimersByTime(2500)
    expect(await result).toMatchObject({ endedBy: 'silence' })
  })
})

function cueSynth(options: { auto?: boolean; played?: boolean } = {}) {
  const log: string[] = []
  let playing: { id: string; end: () => void } | null = null
  const synth: Synth & { endCue: () => void; playing: () => string | null } = {
    speak: vi.fn((text: string) => {
      log.push(`speak ${text}`)
      return Promise.resolve({ ok: true, ms: 10 })
    }),
    cancel: vi.fn(() => {
      log.push('cancel')
      const cut = playing
      playing = null
      cut?.end()
    }),
    cue: vi.fn(
      (id: SoundId) =>
        new Promise<{ played: boolean }>((resolve) => {
          log.push(`cue ${id}`)
          if (options.auto) {
            resolve({ played: options.played ?? true })
            return
          }
          playing = {
            id,
            end: () => {
              resolve({ played: options.played ?? true })
            },
          }
        }),
    ),
    endCue: () => {
      const ended = playing
      playing = null
      ended?.end()
    },
    playing: () => playing?.id ?? null,
  }
  return { synth, log }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

describe('SpeechController: the audio session around the mic', () => {
  let log: string[]
  let type: string
  beforeEach(() => {
    vi.useFakeTimers()
    FakeRecognition.failStart = false
    FakeRecognition.last = undefined
    log = []
    type = 'auto'
    FakeRecognition.onStart = () => log.push('start')
    vi.stubGlobal('navigator', {
      audioSession: {
        get type() {
          return type
        },
        set type(value: string) {
          log.push(value)
          type = value
        },
      },
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    FakeRecognition.onStart = null
  })

  it("a hold: 'auto' before the recognizer starts, 'playback' once the learner lets go", async () => {
    const { controller } = make()

    const first = controller.listen({ endOn: 'release' })
    expect(log).toEqual(['start'])
    rec().say('a mat')
    controller.release()

    expect(type).toBe('auto')
    rec().end()
    await first
    expect(log).toEqual(['start', 'playback'])

    const second = controller.listen({ endOn: 'release' })
    expect(log).toEqual(['start', 'playback', 'auto', 'start'])
    controller.release()
    rec().end()
    await second
    expect(type).toBe('playback')
  })

  it("Safari's own restart mid-hold keeps 'auto'", async () => {
    const { controller } = make()
    const result = controller.listen({ endOn: 'release' })
    rec().end()
    expect(rec().starts).toBe(2)
    expect(type).toBe('auto')
    controller.release()
    rec().end()
    await result
    expect(log).toEqual(['start', 'start', 'playback'])
  })

  it("an app stop or a silence end also leaves 'playback'; a listen that never started touches nothing", async () => {
    const { controller } = make()
    const stopped = controller.listen({ endOn: 'release' })
    controller.stop()
    await stopped
    expect(log).toEqual(['start', 'playback'])

    rec().end()
    const silent = controller.listen({ endOn: 'silence' })
    rec().say('skip')
    vi.advanceTimersByTime(3000)
    await silent
    expect(log).toEqual(['start', 'playback', 'auto', 'start', 'playback'])
    rec().end()
    FakeRecognition.failStart = true
    const refused = controller.listen({ endOn: 'release' })
    expect(await refused).toMatchObject({ endedBy: 'error' })

    expect(log).toEqual(['start', 'playback', 'auto', 'start', 'playback', 'auto', 'playback'])

    FakeRecognition.failStart = false
    const aborted = controller.listen({ endOn: 'release' })
    controller.stop()
    await aborted
    const before = log.length
    const waiting = controller.listen({ endOn: 'release', cue: { start: true } })
    controller.stop()
    await waiting
    vi.advanceTimersByTime(END_WAIT_MS)
    await flush()
    expect(log.length).toBe(before)
  })

  it("with the sound effects: a cue after their hold plays under 'playback'; the next hold cuts it, then 'auto'", async () => {
    const typeAtCue: string[] = []
    let endCue: (() => void) | undefined
    const { controller } = make({
      speak: () => Promise.resolve({ ok: true, ms: 0 }),
      cancel: () => {
        log.push('cancel')
        endCue?.()
      },
      cue: () =>
        new Promise((resolve) => {
          typeAtCue.push(type)
          endCue = () => {
            resolve({ played: true })
          }
        }),
    })
    const hold = controller.listen({ endOn: 'release', cue: { end: true } })
    controller.release()
    rec().end()
    await hold
    void controller.cue('right')
    await flush()
    expect(typeAtCue).toEqual(['playback'])

    void controller.listen({ endOn: 'release', cue: { end: true } })
    expect(log.slice(-3)).toEqual(['cancel', 'auto', 'start'])
  })

  it('works the same without navigator.audioSession', async () => {
    vi.stubGlobal('navigator', {})
    const { controller } = make()
    const result = controller.listen({ endOn: 'release' })
    controller.release()
    rec().end()
    expect(await result).toMatchObject({ endedBy: 'stopped' })
  })
})

describe('SpeechController: sound effects', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeRecognition.failStart = false
    FakeRecognition.last = undefined
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('a hold: the recognizer at once, and no listen-off when the learner lets go', async () => {
    const { synth, log } = cueSynth({ auto: true })
    const { controller } = make(synth)
    const result = controller.listen({ endOn: 'release', cue: { end: true } })

    expect(rec().starts).toBe(1)
    rec().say('a mat')
    controller.release()
    rec().end()
    expect(await result).toMatchObject({ endedBy: 'stopped', transcript: 'a mat' })
    await flush()

    expect(log).toEqual(['cancel'])
  })

  it('listen-on is off: a listen that asks for it starts the recognizer at once, with no cue', async () => {
    for (const endOn of ['release', 'silence', 'tap'] as const) {
      FakeRecognition.last = undefined
      const { synth, log } = cueSynth()
      const { controller } = make(synth)
      void controller.listen({ endOn, cue: { start: true, end: true } })

      expect(rec().starts, endOn).toBe(1)
      await flush()
      expect(
        log.filter((entry) => entry.startsWith('cue')),
        endOn,
      ).toEqual([])
    }
  })

  it('a hold drops a line still queued behind a sound, so nothing plays over their', async () => {
    const { synth, log } = cueSynth()
    const { controller } = make(synth)
    void controller.cue('right')
    const queued = controller.speak('Got it.')
    await flush()
    expect(synth.playing()).toBe('right')
    void controller.listen({ endOn: 'release', cue: { start: true, end: true } })
    expect(rec().starts).toBe(1)
    expect(await queued).toEqual({ ok: false, ms: 0 })
    await flush()
    expect(log).toEqual(['cue right', 'cancel'])
  })

  it('the mic never waits on a sound: any listen cuts the cue in flight and starts at once', async () => {
    const { synth, log } = cueSynth()
    const { controller } = make(synth)
    void controller.cue('right')
    const queued = controller.speak('Got it.')
    await flush()
    expect(synth.playing()).toBe('right')
    void controller.listen({ endOn: 'silence' })

    expect(rec().starts).toBe(1)
    expect(synth.playing()).toBeNull()
    expect(await queued).toEqual({ ok: false, ms: 0 })
    expect(controller.isListening).toBe(true)
    await flush()
    expect(log).toEqual(['cue right', 'cancel'])
  })

  it('passive listens play no listen-on', () => {
    const { synth, log } = cueSynth()
    const { controller } = make(synth)
    void controller.listen({ endOn: 'silence', commands: true, maxMs: 3000 })

    expect(rec().starts).toBe(1)
    expect(log).toEqual([])
  })

  it('no listen-off after a listen the learner ended, however it ended', async () => {
    const ends: [string, (c: SpeechController) => void, ListenOptions][] = [
      [
        'silence',
        () => {
          rec().say('a mat')
          vi.advanceTimersByTime(2500)
        },
        { endOn: 'silence', cue: { end: true } },
      ],
      [
        'command',
        () => {
          rec().say('repeat')
          vi.advanceTimersByTime(2500)
        },
        { endOn: 'silence', commands: true, cue: { end: true } },
      ],
      [
        'max',
        () => {
          vi.advanceTimersByTime(5000)
        },
        { endOn: 'silence', maxMs: 5000, cue: { end: true } },
      ],
      [
        'stopped',
        (c) => {
          c.finishListen()
        },
        { endOn: 'silence', cue: { end: true } },
      ],
    ]
    for (const [endedBy, end, options] of ends) {
      const { synth, log } = cueSynth({ auto: true })
      const { controller } = make(synth)
      const result = controller.listen(options)
      end(controller)
      expect(await result).toMatchObject({ endedBy })
      await flush()
      expect(log, endedBy).toEqual([])
      expect(rec().aborted).toBeGreaterThan(0)
    }
  })

  it('no listen-off after an app stop or an error', async () => {
    const stopped = cueSynth({ auto: true })
    const a = make(stopped.synth)
    const first = a.controller.listen({ endOn: 'silence', cue: { end: true } })
    a.controller.stop()
    expect(await first).toMatchObject({ endedBy: 'stopped' })
    const failed = cueSynth({ auto: true })
    const b = make(failed.synth)
    const second = b.controller.listen({ endOn: 'silence', cue: { end: true } })
    rec().fail('network')
    expect(await second).toMatchObject({ endedBy: 'error' })
    await flush()
    expect(stopped.log).toEqual([])
    expect(failed.log).toEqual([])
  })

  it('speak waits for the cue in flight', async () => {
    const { synth, log } = cueSynth()
    const { controller } = make(synth)
    void controller.cue('right')
    const said = controller.speak('Got it.')
    await flush()
    expect(log).toEqual(['cue right'])
    synth.endCue()
    await said
    expect(log).toEqual(['cue right', 'speak Got it.'])
  })

  it('restarts within a listen play no cue', () => {
    const { synth, log } = cueSynth({ auto: true })
    const { controller } = make(synth)
    void controller.listen({ endOn: 'silence', cue: { start: true, end: true } })
    expect(rec().starts).toBe(1)

    rec().end()
    rec().end()
    expect(rec().starts).toBe(3)
    expect(log).toEqual([])
  })

  it('a stop drops a line or a cue still queued behind a sound', async () => {
    const { synth, log } = cueSynth()
    const { controller } = make(synth)
    void controller.cue('break')
    const queued = controller.speak('Take five.')
    const queuedCue = controller.cue('done')
    await flush()
    expect(synth.playing()).toBe('break')

    controller.stop()
    synth.cancel()
    expect(await queued).toEqual({ ok: false, ms: 0 })
    expect(await queuedCue).toEqual({ played: false })
    await flush()
    expect(log).toEqual(['cue break', 'cancel'])

    await controller.speak('Next card.')
    expect(log.at(-1)).toBe('speak Next card.')
  })

  it('idle() resolves at once after a command answer: no listen-off to wait for', async () => {
    const { synth } = cueSynth()
    const { controller } = make(synth)
    const result = controller.listen({ endOn: 'silence', commands: true, cue: { end: true } })
    rec().say('skip')
    vi.advanceTimersByTime(2500)
    expect(await result).toMatchObject({ endedBy: 'command', command: 'skip' })
    let idle = false
    void controller.idle().then(() => (idle = true))
    await flush()
    expect(synth.playing()).toBeNull()
    expect(idle).toBe(true)
  })

  it('sounds off plays nothing', async () => {
    const player = {
      start: vi.fn(() => Promise.resolve()),
      stop: vi.fn(),
      unlock: vi.fn(),
      playing: false,
    }
    const voice = new AppVoice({
      fetch: vi.fn(() => Promise.reject(new Error('no network in this test'))),
      player,
      system: { speak: vi.fn(), cancel: vi.fn(), speaking: () => false },
      clock,
      now: () => Date.now(),
      objectUrl: { create: () => 'blob:x', revoke: vi.fn() },
      sounds: { on: () => false, url: () => Promise.resolve('blob:sound'), lengthMs: () => 150 },
    })
    const { controller } = make(voice)
    expect(await controller.cue('right')).toEqual({ played: false })
    const result = controller.listen({ endOn: 'silence', cue: { start: true, end: true } })
    await flush()
    expect(rec().starts).toBe(1)
    controller.finishListen()
    await result
    await flush()
    expect(player.start).not.toHaveBeenCalled()
  })
})
