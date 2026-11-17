import { describe, expect, it } from 'vitest'

import { RELEASE_GRACE_MS, SpeechController, type Clock } from '@/lib/speech/controller'

import { controllerPort, observeRecognition } from './speech'

class FakeClock implements Clock {
  t = 0
  private timers = new Map<number, { at: number; run: () => void }>()
  private nextId = 1
  now = (): number => this.t
  setTimeout = (run: () => void, ms: number): number => {
    const id = this.nextId++
    this.timers.set(id, { at: this.t + ms, run })
    return id
  }
  clearTimeout = (id: number): void => {
    this.timers.delete(id)
  }
  advance(ms: number): void {
    const until = this.t + ms
    for (;;) {
      const due = [...this.timers].filter(([, timer]) => timer.at <= until)
      const first = due.sort((a, b) => a[1].at - b[1].at)[0]
      if (!first) break
      this.timers.delete(first[0])
      this.t = first[1].at
      first[1].run()
    }
    this.t = until
  }
}

class SafariLike {
  static made: SafariLike[] = []
  static clock: FakeClock
  continuous = false
  interimResults = false
  lang = ''
  maxAlternatives = 1
  running = false
  starts = 0
  onresult: ((event: SpeechRecognitionEvent) => void) | null = null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null = null
  onend: ((event: Event) => void) | null = null
  constructor() {
    SafariLike.made.push(this)
  }
  start() {
    if (this.running) throw new Error('InvalidStateError: already started')
    this.running = true
    this.starts += 1
  }
  stop() {
    this.abort()
  }
  abort() {
    if (!this.running) return
    SafariLike.clock.setTimeout(() => {
      this.running = false
      this.onend?.(new Event('end'))
    }, 50)
  }
  say(text: string, isFinal = true) {
    const alternative = { transcript: text, confidence: 0.9 }
    const result = Object.assign([alternative], { isFinal, item: () => alternative })
    const results = Object.assign([result], { item: () => result })
    this.onresult?.({ resultIndex: 0, results } as unknown as SpeechRecognitionEvent)
  }
  endsOnItsOwn() {
    this.running = false
    this.onend?.(new Event('end'))
  }
  fail(error: string) {
    this.onerror?.({ error, message: '' } as unknown as SpeechRecognitionErrorEvent)
  }
}

function setup() {
  const clock = new FakeClock()
  SafariLike.clock = clock
  SafariLike.made = []
  const heard: string[] = []
  const Observed = observeRecognition(
    SafariLike as unknown as SpeechRecognitionConstructor,
    (text) => heard.push(text),
  )
  const native = () => {
    const last = SafariLike.made.at(-1)
    if (!last) throw new Error('no recognizer')
    return last
  }
  return { clock, heard, Observed, native }
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

describe('observeRecognition with held answers', () => {
  it('a hold after one the learner let go of starts fresh: no words from the hold before', async () => {
    const { clock, heard, Observed, native } = setup()
    const synth = { speak: () => Promise.resolve({ ok: true, ms: 1 }), cancel: () => undefined }
    const controller = new SpeechController(Observed, synth, clock)
    const first = controller.listen({ endOn: 'release' })
    native().say('a mat')
    controller.release()
    clock.advance(50)
    expect(await first).toMatchObject({ transcript: 'a mat', endedBy: 'stopped' })
    const second = controller.listen({ endOn: 'release' })
    await settle()
    expect(heard.at(-1)).toBe('')
    native().say('a strap')
    expect(heard.at(-1)).toBe('a strap')
    controller.release()
    clock.advance(50)
    expect(await second).toMatchObject({ transcript: 'a strap' })
  })
})

describe('observeRecognition', () => {
  it('reports the words heard so far, across Safari ending on its own, fresh after abort', () => {
    const { clock, heard, Observed, native } = setup()
    const rec = new Observed()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    rec.maxAlternatives = 1
    expect([rec.continuous, rec.interimResults, rec.lang, rec.maxAlternatives]).toEqual([
      true,
      true,
      'en-US',
      1,
    ])
    let ends = 0
    rec.onend = () => {
      ends += 1
      rec.start()
    }
    rec.start()
    native().say('a mat', false)
    native().endsOnItsOwn()
    expect(ends).toBe(1)
    native().say('a strap')
    expect(heard).toEqual(['', 'a mat', 'a mat a strap'])
    rec.onend = null
    rec.abort()
    clock.advance(50)
    rec.start()
    expect(heard.at(-1)).toBe('')
    rec.stop()
  })

  it('drops late results and errors from an aborted session but passes its end on', () => {
    const { clock, heard, Observed, native } = setup()
    const rec = new Observed()
    const results: string[] = []
    let ends = 0
    let errors = 0
    rec.onresult = () => results.push('result')
    rec.onerror = () => {
      errors += 1
    }
    rec.onend = () => {
      ends += 1
    }
    rec.start()
    native().say('hands front rail')
    rec.abort()
    native().say('late words')
    native().fail('aborted')
    clock.advance(50)
    expect(results).toEqual(['result'])
    expect(errors).toBe(0)
    expect(ends).toBe(1)
    expect(heard.at(-1)).toBe('hands front rail')
    rec.start()
    native().fail('network')
    expect(errors).toBe(1)
  })

  it('lets the shared controller run listens back to back (wait, then next)', async () => {
    const { clock, Observed, native } = setup()
    const synth = { speak: () => Promise.resolve({ ok: true, ms: 1 }), cancel: () => undefined }
    const controller = new SpeechController(Observed, synth, clock)
    const first = controller.listen({ endOn: 'silence', commands: true, maxMs: 3000 })
    native().say('wait')
    clock.advance(2500)
    expect((await first).transcript).toBe('wait')

    const second = controller.listen({ endOn: 'silence', commands: true })
    clock.advance(50)
    await settle()
    expect(controller.isListening).toBe(true)
    native().say('next')
    clock.advance(2500)
    const result = await second
    expect(result).toMatchObject({ transcript: 'next', endedBy: 'silence', autoRestarts: 0 })
  })
})

describe('the session port (sound effects)', () => {
  function portSetup() {
    const { clock, Observed, native } = setup()
    const log: string[] = []
    const synth = {
      speak: (text: string) => {
        log.push(`speak ${text}`)
        return Promise.resolve({ ok: true, ms: 1 })
      },
      cancel: () => {
        log.push('cancel')
        endCue()
      },
      stopLine: () => {
        log.push('stopLine')
      },
      cue: (id: string) => {
        log.push(`cue ${id}`)
        if (!hold.cues) return Promise.resolve({ played: false })
        return new Promise<{ played: boolean }>((resolve) => {
          playing = () => {
            log.push(`ended ${id}`)
            resolve({ played: true })
          }
        })
      },
    }

    const hold = { cues: false }
    let playing: (() => void) | null = null
    const endCue = () => {
      const end = playing
      playing = null
      end?.()
    }
    const controller = new SpeechController(Observed, synth, clock)
    return { clock, native, log, hold, endCue, port: controllerPort(controller, synth) }
  }

  it('stopKeepingSound lets a sound in flight play out, then the next line', async () => {
    const { log, endCue, port, hold } = portSetup()
    hold.cues = true
    void port.cue('break')
    await settle()
    expect(log).toEqual(['cue break'])
    port.stopKeepingSound()
    const next = port.speak('Take five.')
    await settle()
    expect(log).toEqual(['cue break', 'stopLine'])
    endCue()
    await next
    expect(log).toEqual(['cue break', 'stopLine', 'ended break', 'speak Take five.'])
  })

  it('release (the learner let go): no listen-off, and nothing cut after it', async () => {
    const { clock, native, log, port } = portSetup()
    const heard = port.listen({ endOn: 'release', cue: { end: true } })
    await settle()
    native().say('a mat')
    port.release()
    clock.advance(RELEASE_GRACE_MS)
    expect(await heard).toMatchObject({ endedBy: 'stopped', transcript: 'a mat' })
    await settle()

    expect(log).toEqual(['cancel'])
  })

  it('stop is the app’s: no listen-off, and any sound is cut', async () => {
    const { native, log, port } = portSetup()
    const heard = port.listen({ endOn: 'silence', commands: true, cue: { end: true } })
    await settle()
    native().say('a mat')
    port.stop()
    expect(await heard).toMatchObject({ endedBy: 'stopped' })
    await settle()
    expect(log).toEqual(['cancel'])
  })

  it('moment sounds go through the controller, before the line', async () => {
    const { log, port } = portSetup()
    await port.cue('right')
    await port.speak('Got it.')
    expect(log).toEqual(['cue right', 'speak Got it.'])
  })
})
