// Wraps the browser's speech recognition: restarts it when it stops on its own,
// times each word, and ends a turn on silence, a tap or a release.

import type { SoundId } from '../sound/catalog'

import { browserAudioSession, type AudioSessionPort } from './audio-session'

export const COMMANDS = ['repeat', 'hint', "i don't know", 'skip', 'show source', 'pause'] as const
export type Command = (typeof COMMANDS)[number]

export type TimedWord = { text: string; atMs: number }

export type EndReason = 'silence' | 'command' | 'max' | 'stopped' | 'error'

export type MicIssue = {
  reason: 'ended-early' | 'restart-failed' | 'start-failed' | `error-${string}`
  endOn: ListenOptions['endOn']

  atMs: number

  restarts: number
  firstResultMs: number | null
}

export type ListenResult = {
  transcript: string
  words: TimedWord[]
  endedBy: EndReason
  command?: Command

  stalled: boolean
  firstResultMs: number | null
  durationMs: number
  autoRestarts: number
  error?: string

  cause?: string
}

export type ListenOptions = {
  endOn: 'silence' | 'tap' | 'release'
  silenceMs?: number
  maxMs?: number
  stallMs?: number

  commands?: boolean

  onStart?: (startedAt: number) => void

  onHeard?: (heard: { transcript: string; words: readonly TimedWord[] }) => void

  onIssue?: (issue: MicIssue) => void

  cue?: { start?: boolean; end?: boolean }
}

export type CuePlayed = { played: boolean }

export type Synth = {
  speak: (text: string) => Promise<{ ok: boolean; ms: number }>
  cancel: () => void

  cue?: (id: SoundId) => Promise<CuePlayed>
}

export type Clock = {
  now: () => number
  setTimeout: (run: () => void, ms: number) => number
  clearTimeout: (id: number) => void
}

export const DEFAULTS = {
  silenceMs: 2500,
  maxMs: 30_000,
  practiceMaxMs: 300_000,

  holdMaxMs: 120_000,
  stallMs: 12_000,
}

export const RELEASE_GRACE_MS = 600

export const RESTART_RETRY_MS = 250
export const RESTART_TRIES = 3

export const END_WAIT_MS = 1000

const NUMBER_WORDS: Record<string, string> = {
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  twelve: '12',
  fifteen: '15',
  twenty: '20',
}

export function joinChunks(chunks: Iterable<string>): string {
  let text = ''
  for (const chunk of chunks) {
    if (chunk === '') continue
    if (text !== '' && !/\s$/.test(text) && !/^\s/.test(chunk)) text += ' '
    text += chunk
  }
  return text
}

export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => NUMBER_WORDS[w] ?? w)
}

export function asCommand(transcript: string): Command | undefined {
  const said = words(transcript).join(' ')
  return COMMANDS.find((command) => said === command)
}

export function commandIn(
  heard: Pick<ListenResult, 'command' | 'transcript'>,
): Command | undefined {
  return heard.command ?? asCommand(heard.transcript)
}

// Recognition rewrites its guess as it goes. Words that stay the same keep their
// original time; only new or changed words get the current time.
export function retime(
  prior: readonly TimedWord[],
  heard: readonly string[],
  now: number,
): TimedWord[] {
  let head = 0
  while (head < prior.length && head < heard.length && prior[head]?.text === heard[head]) head++
  let tail = 0
  while (
    tail < prior.length - head &&
    tail < heard.length - head &&
    prior[prior.length - 1 - tail]?.text === heard[heard.length - 1 - tail]
  ) {
    tail++
  }

  if (heard.length - head - tail > prior.length - head - tail + 1) {
    return heard.map((text, i) => {
      const same = prior[i]
      return same?.text === text ? same : { text, atMs: now }
    })
  }
  return heard.map((text, i) => {
    const kept =
      i < head
        ? prior[i]
        : i >= heard.length - tail
          ? prior[prior.length - (heard.length - i)]
          : undefined
    return kept ?? { text, atMs: now }
  })
}

export class SpeechController {
  private recognition: SpeechRecognition | null = null
  private listening = false
  private endCurrent:
    ((reason: EndReason, error?: string, cause?: string, byLearner?: boolean) => void) | null = null

  private releaseListen: (() => void) | null = null

  private resumeListen: (() => boolean) | null = null

  private endPending = false
  private endWait: number | undefined
  private afterEnd: (() => void)[] = []

  private audio: Promise<void> | null = null

  private generation = 0

  constructor(
    private readonly Recognition: SpeechRecognitionConstructor,
    private readonly synth: Synth,
    private readonly clock: Clock,

    private readonly session: AudioSessionPort = browserAudioSession(),
  ) {}

  get isListening(): boolean {
    return this.listening
  }

  async speak(text: string): Promise<{ ok: boolean; ms: number }> {
    this.endListen()
    if (this.audio) {
      const generation = this.generation
      await this.audio
      if (this.generation !== generation) return { ok: false, ms: 0 }
    }
    return this.synth.speak(text)
  }

  idle(): Promise<void> {
    return this.audio ?? Promise.resolve()
  }

  stop(): void {
    this.generation += 1
    this.endListen()
  }

  private endListen(): void {
    this.endCurrent?.('stopped')
  }

  finishListen(): void {
    this.endCurrent?.('stopped', undefined, undefined, true)
  }

  cue(id: SoundId): Promise<CuePlayed> {
    this.endListen()
    return this.playCue(id)
  }

  private playCue(id: SoundId): Promise<CuePlayed> {
    const synth = this.synth
    if (!synth.cue) return Promise.resolve({ played: false })
    const before = this.audio ?? Promise.resolve()
    const generation = this.generation
    const played = before.then(() =>
      this.generation === generation ? (synth.cue?.(id) ?? { played: false }) : { played: false },
    )
    const safe = played.catch((): CuePlayed => ({ played: false }))
    const settled = safe.then(() => undefined)
    this.audio = settled
    void settled.then(() => {
      if (this.audio === settled) this.audio = null
    })
    return safe
  }

  release(): void {
    this.releaseListen?.()
  }

  resume(): boolean {
    return this.resumeListen?.() ?? false
  }

  listen(options: ListenOptions): Promise<ListenResult> {
    this.endListen()
    const silenceMs = options.silenceMs ?? DEFAULTS.silenceMs
    const maxMs =
      options.maxMs ??
      (options.endOn === 'tap'
        ? DEFAULTS.practiceMaxMs
        : options.endOn === 'release'
          ? DEFAULTS.holdMaxMs
          : DEFAULTS.maxMs)

    if (options.endOn === 'release' || this.audio) {
      this.generation += 1
      this.synth.cancel()
      this.audio = null
    }
    const stallMs = options.stallMs ?? DEFAULTS.stallMs
    const clock = this.clock
    let started = clock.now()
    const rec = (this.recognition ??= new this.Recognition())
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    rec.maxAlternatives = 1

    let earlier = ''
    let current = ''
    let timed: TimedWord[] = []
    let firstResult: number | null = null
    let recStarted = false

    let recEnded = false
    let releasing = false
    let graceTimer: number | undefined

    let resumed = false

    let autoRestarts = 0
    let stalled = false
    let silenceTimer: number | undefined
    const timers: number[] = []

    return new Promise<ListenResult>((resolve) => {
      const transcriptNow = () => `${earlier} ${current}`.trim()
      const finish = (endedBy: EndReason, error?: string, cause?: string, byLearner = false) => {
        if (!this.listening) return
        this.listening = false
        this.endCurrent = null
        this.releaseListen = null
        this.resumeListen = null
        if (graceTimer !== undefined) clock.clearTimeout(graceTimer)
        if (silenceTimer !== undefined) clock.clearTimeout(silenceTimer)
        for (const t of timers) clock.clearTimeout(t)
        rec.onresult = null
        rec.onerror = null
        if (recStarted && !recEnded) {
          this.awaitEnd(rec)
          rec.abort()
        } else {
          rec.onend = null
          if (recStarted) rec.abort()
        }

        this.session.afterMic()

        const transcript = transcriptNow()
        let command: Command | undefined

        if ((endedBy === 'silence' || endedBy === 'max') && options.commands)
          command = asCommand(transcript)
        if (command) endedBy = 'command'

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const own =
          endedBy === 'silence' ||
          endedBy === 'max' ||
          endedBy === 'command' ||
          (endedBy === 'stopped' && byLearner)

        resolve({
          transcript,
          words: timed,
          endedBy,
          command,
          stalled: stalled || (firstResult === null && endedBy !== 'stopped'),
          firstResultMs: firstResult === null ? null : firstResult - started,
          durationMs: clock.now() - started,
          autoRestarts,
          error,
          cause,
        })
      }
      this.endCurrent = finish
      this.listening = true
      const issue = (reason: MicIssue['reason']) => {
        options.onIssue?.({
          reason,
          endOn: options.endOn,
          atMs: Math.max(0, clock.now() - started),
          restarts: autoRestarts,
          firstResultMs: firstResult === null ? null : firstResult - started,
        })
      }
      if (options.endOn === 'release') {
        this.releaseListen = () => {
          if (this.endCurrent !== finish || releasing) return
          releasing = true
          if (!recStarted || recEnded) {
            finish('stopped', undefined, undefined, true)
            return
          }
          graceTimer = clock.setTimeout(() => {
            finish('stopped', undefined, undefined, true)
          }, RELEASE_GRACE_MS)
          try {
            rec.stop()
          } catch {
            finish('stopped', undefined, undefined, true)
          }
        }
        this.resumeListen = () => {
          if (this.endCurrent !== finish || !releasing) return false
          releasing = false
          if (graceTimer !== undefined) clock.clearTimeout(graceTimer)
          graceTimer = undefined

          if (!recEnded) resumed = true
          else restart(RESTART_TRIES)
          return true
        }
      }

      const restart = (triesLeft: number) => {
        if (this.endCurrent !== finish || releasing) return
        try {
          this.session.forMic()
          rec.start()
          recEnded = false
        } catch {
          if (triesLeft > 1) {
            timers.push(
              clock.setTimeout(() => {
                restart(triesLeft - 1)
              }, RESTART_RETRY_MS),
            )
            return
          }
          stalled = true
          issue('restart-failed')
          finish('error', 'could not restart listening')
        }
      }

      const begin = () => {
        if (this.endCurrent !== finish) return
        started = clock.now()
        options.onStart?.(started)
        rec.onresult = (event) => {
          const at = clock.now()
          firstResult ??= at
          const text = joinChunks(
            Array.from(event.results, (result) => result[0]?.transcript ?? ''),
          )
          current = text.trim()

          timed = retime(timed, words(transcriptNow()), at - started)
          options.onHeard?.({ transcript: transcriptNow(), words: timed })

          if (options.endOn === 'tap' || options.endOn === 'release') return

          if (silenceTimer !== undefined) clock.clearTimeout(silenceTimer)
          silenceTimer = clock.setTimeout(() => {
            finish('silence')
          }, silenceMs)
        }
        rec.onend = () => {
          recEnded = true
          if (this.endCurrent !== finish) return

          if (releasing) {
            finish('stopped', undefined, undefined, true)
            return
          }

          if (resumed) resumed = false
          else if (options.endOn === 'release') issue('ended-early')
          autoRestarts += 1
          earlier = transcriptNow()
          current = ''
          restart(RESTART_TRIES)
        }
        rec.onerror = (event) => {
          if (this.endCurrent !== finish) return

          if (event.error !== 'aborted' && event.error !== 'no-speech')
            issue(`error-${event.error}`)
          if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            finish('error', 'microphone-blocked', event.error)
          } else if (event.error === 'aborted' || event.error === 'no-speech') {
          } else {
            finish('error', event.error, event.error)
          }
        }
        timers.push(
          clock.setTimeout(() => {
            if (firstResult === null) stalled = true
          }, stallMs),
          clock.setTimeout(() => {
            finish('max')
          }, maxMs),
        )
        try {
          this.session.forMic()
          rec.start()
          recStarted = true
          recEnded = false
        } catch {
          stalled = true
          issue('start-failed')
          finish('error', 'could not start listening')
        }
      }
      const proceed = () => {
        if (this.endCurrent !== finish) return
        if (this.endPending) this.afterEnd.push(begin)
        else begin()
      }

      proceed()
    })
  }

  private awaitEnd(rec: SpeechRecognition): void {
    const clock = this.clock
    this.endPending = true
    if (this.endWait !== undefined) clock.clearTimeout(this.endWait)
    const settle = () => {
      if (!this.endPending) return
      this.endPending = false
      if (this.endWait !== undefined) clock.clearTimeout(this.endWait)
      this.endWait = undefined
      rec.onend = null
      for (const run of this.afterEnd.splice(0)) run()
    }
    rec.onend = settle
    this.endWait = clock.setTimeout(settle, END_WAIT_MS)
  }
}
