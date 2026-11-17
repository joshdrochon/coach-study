// The app voice: plays stored clips when it can and falls back to the device voice.

import type { SoundId } from '../sound/catalog'
import { CUE_LOAD_MS, CUE_START_MS, CUE_STUCK_MS } from '../sound/timing'
import type { FallbackReason, FallbackReport } from '../tts/fallback'
import { sendableLine, ttsLine } from '../tts/line'

import type { Clock, CuePlayed, Synth } from './controller'

export type Spoken = { ok: boolean; ms: number }

export type SystemVoice = Synth & { speaking: () => boolean }

export type Player = {
  start: (
    src: string,
    events: { playing: () => void; ended: () => void; failed: () => void },
  ) => Promise<void>
  stop: () => void

  unlock: () => void
  readonly playing: boolean
}

export type ClipMemory = {
  recall: (line: string) => Promise<string | null>
  remember: (line: string, clip: string, voice: string) => Promise<void>
  forget: (line: string) => Promise<void>
}

export type CueSource = {
  on: () => boolean
  url: (id: SoundId) => Promise<string | null>
  lengthMs: (id: SoundId) => number
}

export type VoiceDeps = {
  fetch: (url: string, init: RequestInit) => Promise<Response>
  player: Player
  system: SystemVoice
  clock: Clock
  now: () => number
  objectUrl: { create: (blob: Blob) => string; revoke: (url: string) => void }
  memory?: ClipMemory

  report?: (fallback: FallbackReport) => void
  sounds?: CueSource
}

type Cue = {
  id: SoundId

  started: boolean
  playing: boolean
  done: boolean
  timers: number[]
  end: (played: boolean) => void
}

export const TTS_START_MS = 5000

export function lineLimitMs(text: string): number {
  return 4000 + text.length * 150
}

type Fallback = FallbackReason | 'empty'

type Played = 'playing' | 'play-refused' | 'play-error'

type Phases = Pick<FallbackReport, 'replayMs' | 'requestMs' | 'headersMs' | 'blobMs' | 'playMs'>

type Line = {
  text: string

  chars: number

  asked: number
  phases: Phases

  by: 'app' | 'system'

  settled: boolean
  done: boolean
  abort: AbortController
  timers: number[]
  url: string | null
  whenSettled: Promise<void>
  settle: () => void
  end: (ok: boolean) => void

  whenDone: Promise<void>
}

export class AppVoice implements Synth {
  private line: Line | null = null

  private cueNow: Cue | null = null

  private stops = 0

  constructor(private readonly deps: VoiceDeps) {}

  async preview(id: SoundId): Promise<CuePlayed> {
    const stops = this.stops
    const line = this.line
    if (line) await line.whenDone
    if (this.stops !== stops) return { played: false }
    return this.cue(id, CUE_LOAD_MS)
  }

  cue(id: SoundId, startMs: number = CUE_START_MS): Promise<CuePlayed> {
    const sounds = this.deps.sounds
    if (!sounds?.on()) return Promise.resolve({ played: false })

    const before = this.cueNow
    if (before) this.endCue(before, true)
    const { deps } = this
    let end: (played: boolean) => void = () => undefined
    const finished = new Promise<CuePlayed>((resolve) => {
      end = (played) => {
        resolve({ played })
      }
    })
    const cue: Cue = { id, started: false, playing: false, done: false, timers: [], end }
    this.cueNow = cue
    cue.timers.push(
      deps.clock.setTimeout(() => {
        if (!cue.playing) this.endCue(cue, true)
      }, startMs),
    )
    void sounds.url(id).then(
      (src) => {
        if (cue.done) return

        if (src === null || !sounds.on()) {
          this.endCue(cue, false)
          return
        }

        this.cutLine()
        cue.started = true
        deps.player
          .start(src, {
            playing: () => {
              if (cue.done || cue.playing) return
              cue.playing = true
              cue.timers.push(
                deps.clock.setTimeout(
                  () => {
                    this.endCue(cue, true)
                  },
                  sounds.lengthMs(id) + CUE_STUCK_MS,
                ),
              )
            },
            ended: () => {
              this.endCue(cue, false)
            },
            failed: () => {
              this.endCue(cue, true)
            },
          })
          .catch(() => {
            this.endCue(cue, true)
          })
      },
      () => {
        this.endCue(cue, false)
      },
    )
    return finished
  }

  speak(text: string): Promise<Spoken> {
    this.cancel()
    const { deps } = this
    const started = deps.now()
    let settle: () => void = () => undefined
    const whenSettled = new Promise<void>((resolve) => {
      settle = resolve
    })
    let end: (ok: boolean) => void = () => undefined
    const spoken = new Promise<Spoken>((resolve) => {
      end = (ok) => {
        resolve({ ok, ms: Math.round(deps.now() - started) })
      }
    })
    const line: Line = {
      text: ttsLine(text),
      chars: ttsLine(text).length,
      asked: started,
      phases: { replayMs: null, requestMs: null, headersMs: null, blobMs: null, playMs: null },
      by: 'app',
      settled: false,
      done: false,
      abort: new AbortController(),
      timers: [],
      url: null,
      whenSettled,
      settle,
      end,
      whenDone: spoken.then(() => undefined),
    }
    this.line = line
    const sendable = sendableLine(text)
    if (sendable === '') {
      this.bySystem(line, line.chars === 0 ? 'empty' : 'too-long')
      return spoken
    }
    line.timers.push(
      deps.clock.setTimeout(() => {
        if (!line.settled) this.bySystem(line, 'start-timeout')
      }, TTS_START_MS),
    )
    void this.byApp(line, sendable)
    return spoken
  }

  cancel(): void {
    this.stopCue()
    this.cutLine()
  }

  stopCue(): void {
    this.stops += 1
    const cue = this.cueNow
    if (cue) this.endCue(cue, true)
  }

  stopLine(): void {
    this.cutLine()
  }

  private cutLine(): void {
    const line = this.line
    if (line) {
      line.abort.abort()
      if (line.by === 'app') this.deps.player.stop()
      this.finish(line, false)
    }
    this.deps.system.cancel()
  }

  unlock(): void {
    if (!this.line && !this.cueNow) this.deps.player.unlock()
  }

  audible(): boolean {
    const line = this.line
    const appPlaying = line?.by === 'app' && line.settled && this.deps.player.playing
    const cuePlaying = this.cueNow?.playing === true && this.deps.player.playing
    return appPlaying || cuePlaying || this.deps.system.speaking()
  }

  private endCue(cue: Cue, stop: boolean): void {
    if (cue.done) return
    cue.done = true
    for (const timer of cue.timers) this.deps.clock.clearTimeout(timer)
    if (this.cueNow === cue) {
      this.cueNow = null

      if (stop && cue.started) this.deps.player.stop()
    }
    cue.end(cue.playing)
  }

  settled(): Promise<void> {
    return this.line?.whenSettled ?? Promise.resolve()
  }

  private current(line: Line): boolean {
    return this.line === line && !line.done && line.by === 'app'
  }

  private since(line: Line): number {
    return Math.max(0, Math.round(this.deps.now() - line.asked))
  }

  private async byApp(line: Line, text: string): Promise<void> {
    const { deps } = this
    try {
      const known = await deps.memory?.recall(text).catch(() => null)
      if (!this.current(line)) return
      if (known) {
        line.phases.replayMs = this.since(line)
        if ((await this.play(line, `/api/tts/${known}`)) === 'playing') return
        if (!this.current(line)) return
        await deps.memory?.forget(text).catch(() => undefined)
      }
      line.phases.requestMs = this.since(line)
      const response = await deps.fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: line.abort.signal,
      })
      if (!this.current(line)) return
      line.phases.headersMs = this.since(line)
      if (!response.ok) {
        this.bySystem(line, `status-${response.status}`)
        return
      }
      if (!(response.headers.get('Content-Type') ?? '').startsWith('audio/')) {
        this.bySystem(line, 'not-audio')
        return
      }
      const clip = response.headers.get('X-Tts-Clip')
      const voice = response.headers.get('X-Tts-Voice')
      const audio = await response.blob()
      if (!this.current(line)) return
      line.phases.blobMs = this.since(line)
      line.url = deps.objectUrl.create(audio)
      if (clip && voice) void deps.memory?.remember(text, clip, voice).catch(() => undefined)
      line.phases.playMs = this.since(line)
      const played = await this.play(line, line.url)
      if (played !== 'playing') this.bySystem(line, played)
    } catch {
      this.bySystem(line, 'network')
    }
  }

  private play(line: Line, src: string): Promise<Played> {
    const { deps } = this
    return new Promise<Played>((started) => {
      let began = false
      deps.player
        .start(src, {
          playing: () => {
            if (began || !this.current(line)) return
            began = true
            line.settled = true
            line.settle()
            started('playing')
            line.timers.push(
              deps.clock.setTimeout(() => {
                if (!this.current(line)) return
                deps.player.stop()
                this.finish(line, false)
              }, lineLimitMs(line.text)),
            )
          },
          ended: () => {
            if (this.current(line)) this.finish(line, true)
          },
          failed: () => {
            if (!this.current(line)) return
            if (began) this.bySystem(line, 'mid-line')
            else started('play-error')
          },
        })
        .catch((error: unknown) => {
          if (!began) started(refused(error) ? 'play-refused' : 'play-error')
        })
    })
  }

  private bySystem(line: Line, reason: Fallback): void {
    if (line.done || line.by === 'system') return
    const atMs = this.since(line)
    line.by = 'system'
    line.abort.abort()
    if (this.line === line) this.deps.player.stop()
    line.settled = true
    line.settle()
    this.deps.system.speak(line.text).then(
      (said) => {
        this.finish(line, said.ok)
      },
      () => {
        this.finish(line, false)
      },
    )
    if (reason === 'empty') return
    try {
      this.deps.report?.({ reason, chars: line.chars, atMs, ...line.phases })
    } catch {}
  }

  private finish(line: Line, ok: boolean): void {
    if (line.done) return
    line.done = true
    for (const timer of line.timers) this.deps.clock.clearTimeout(timer)
    if (line.url) this.deps.objectUrl.revoke(line.url)
    line.settle()
    if (this.line === line) this.line = null
    line.end(ok)
  }
}

function refused(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'NotAllowedError'
  )
}
