import { z } from 'zod'

import { appSounds } from '../sound/sounds'
import { FALLBACK_REPORT_PATH, type FallbackReport } from '../tts/fallback'

import { joinChunks, type MicIssue } from './controller'
import { MIC_REPORT_PATH, type MicReport } from './mic-report'

import { AppVoice, type ClipMemory, type Player } from './voice'

export function recognitionConstructor(): SpeechRecognitionConstructor | undefined {
  if (typeof window === 'undefined') return undefined
  return window.SpeechRecognition ?? window.webkitSpeechRecognition
}

export type AppMode = 'safari-tab' | 'home-screen'

export function appMode(): AppMode {
  const standalone =
    navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches
  return standalone ? 'home-screen' : 'safari-tab'
}

function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'))
  const enhanced = (v: SpeechSynthesisVoice) => /premium|enhanced/i.test(v.name)
  return (
    voices.find((v) => enhanced(v) && v.lang === 'en-US') ??
    voices.find(enhanced) ??
    voices.find((v) => v.default)
  )
}

export type Spoken = { ok: boolean; ms: number }

export function speak(text: string): Promise<Spoken> {
  const started = performance.now()
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) {
      resolve({ ok: false, ms: 0 })
      return
    }
    const utterance = new SpeechSynthesisUtterance(text)
    const voice = pickVoice()
    if (voice) utterance.voice = voice
    utterance.lang = voice?.lang ?? 'en-US'
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      resolve({ ok, ms: Math.round(performance.now() - started) })
    }
    const timer = window.setTimeout(
      () => {
        window.speechSynthesis.cancel()
        finish(false)
      },
      4000 + text.length * 150,
    )
    utterance.onend = () => {
      finish(true)
    }
    utterance.onerror = () => {
      finish(false)
    }
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  })
}

function cancelSystemVoice(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel()
}

export const SILENT_WAV =
  'data:audio/wav;base64,UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

export type MediaElement = Pick<
  HTMLAudioElement,
  'src' | 'play' | 'pause' | 'load' | 'removeAttribute' | 'paused' | 'ended' | 'addEventListener'
>

export function mediaPlayer(audio: MediaElement): Player {
  let events: Parameters<Player['start']>[1] | null = null
  audio.addEventListener('playing', () => events?.playing())
  audio.addEventListener('ended', () => events?.ended())
  audio.addEventListener('error', () => events?.failed())
  return {
    start: async (src, next) => {
      events = next
      audio.src = src
      await audio.play()
    },
    stop: () => {
      events = null
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    },
    unlock: () => {
      events = null
      audio.src = SILENT_WAV
      audio.play().catch(() => undefined)
    },
    get playing() {
      return !audio.paused && !audio.ended
    },
  }
}

export const VOICE_SETTINGS: { readonly clipMemory: boolean } = { clipMemory: false }

const MEMORY_KEY = 'coach-study:voice-clips'
const MEMORY_MAX = 3000
const memorySchema = z.object({ voice: z.string(), clips: z.record(z.string(), z.string()) })

async function lineHash(line: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(line))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function browserClipMemory(storage: () => Storage = () => window.localStorage): ClipMemory {
  const read = (): Map<string, string> & { voice?: string } => {
    try {
      const parsed = memorySchema.safeParse(JSON.parse(storage().getItem(MEMORY_KEY) ?? 'null'))
      if (!parsed.success) return new Map()
      return Object.assign(new Map(Object.entries(parsed.data.clips)), { voice: parsed.data.voice })
    } catch {
      return new Map()
    }
  }
  const write = (voice: string, clips: Map<string, string>) => {
    try {
      storage().setItem(MEMORY_KEY, JSON.stringify({ voice, clips: Object.fromEntries(clips) }))
    } catch {}
  }

  let confirmed: string | null = null
  return {
    recall: async (line) => {
      const known = read()
      if (confirmed === null || known.voice !== confirmed) return null
      return known.get(await lineHash(line)) ?? null
    },
    remember: async (line, clip, voice) => {
      confirmed = voice
      const known = read()
      const clips = known.voice === voice ? known : new Map<string, string>()
      clips.set(await lineHash(line), clip)
      for (const oldest of clips.keys()) {
        if (clips.size <= MEMORY_MAX) break
        clips.delete(oldest)
      }
      write(voice, clips)
    },
    forget: async (line) => {
      const known = read()
      if (known.delete(await lineHash(line))) write(known.voice ?? '', known)
    },
  }
}

export function reportFallback(report: FallbackReport): void {
  send(FALLBACK_REPORT_PATH, report)
}

export function reportMic(issue: MicIssue): void {
  let app: MicReport['app'] = 'safari-tab'
  try {
    app = appMode()
  } catch {}
  const report: MicReport = {
    reason: issue.reason,
    endOn: issue.endOn,
    atMs: Math.max(0, Math.round(issue.atMs)),
    restarts: issue.restarts,
    firstResultMs:
      issue.firstResultMs === null ? null : Math.max(0, Math.round(issue.firstResultMs)),
    app,
  }
  send(MIC_REPORT_PATH, report)
}

function send(path: string, report: unknown): void {
  try {
    const body = JSON.stringify(report)
    if (beacon(path, body)) return
    window
      .fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      })
      .catch(() => undefined)
  } catch {}
}

function beacon(path: string, body: string): boolean {
  try {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.sendBeacon === 'function' &&
      navigator.sendBeacon(path, body)
    )
  } catch {
    return false
  }
}

let voice: AppVoice | undefined

export function makeAppVoice(report: (fallback: FallbackReport) => void): AppVoice {
  return new AppVoice({
    fetch: (url, init) => window.fetch(url, init),
    player: mediaPlayer(new Audio()),
    system: {
      speak,
      cancel: cancelSystemVoice,
      speaking: () => 'speechSynthesis' in window && window.speechSynthesis.speaking,
    },
    clock: {
      now: () => Date.now(),
      setTimeout: (run, ms) => window.setTimeout(run, ms),
      clearTimeout: (id) => {
        window.clearTimeout(id)
      },
    },
    now: () => performance.now(),
    objectUrl: {
      create: (blob) => URL.createObjectURL(blob),
      revoke: (url) => {
        URL.revokeObjectURL(url)
      },
    },
    ...(VOICE_SETTINGS.clipMemory ? { memory: browserClipMemory() } : {}),
    report,

    sounds: appSounds(),
  })
}

export function appVoice(): AppVoice {
  voice ??= makeAppVoice(reportFallback)
  return voice
}

let primed = false

export function voicePrimed(): boolean {
  return primed
}

export function primeVoice(): void {
  primed = true
  try {
    if ('speechSynthesis' in window) window.speechSynthesis.speak(new SpeechSynthesisUtterance(''))
  } catch {}
  try {
    appVoice().unlock()
  } catch {}
}

export function preloadSounds(): void {
  try {
    const sounds = appSounds()
    if (sounds.on()) sounds.preload()
  } catch {}
}

export async function holdWakeLock(): Promise<() => void> {
  try {
    const sentinel = await navigator.wakeLock.request('screen')
    return () => {
      void sentinel.release()
    }
  } catch {
    return () => undefined
  }
}

export function transcriptOf(event: SpeechRecognitionEvent): { final: string; interim: string } {
  const final: string[] = []
  const interim: string[] = []
  for (const result of Array.from(event.results)) {
    const text = result[0]?.transcript ?? ''
    if (result.isFinal) final.push(text)
    else interim.push(text)
  }

  return { final: joinChunks(final).trim(), interim: joinChunks(interim).trim() }
}
