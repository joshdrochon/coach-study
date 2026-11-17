import { appMode, makeAppVoice, recognitionConstructor, transcriptOf } from '@/lib/speech/browser'
import type { AppVoice } from '@/lib/speech/voice'
import {
  errorLabel,
  type HoldMode,
  type LabEvent,
  type Support,
  type VoiceMode,
} from '@/lib/speech/voice-lab'

type AudioSessionLike = { type: string }

function isAudioSession(value: unknown): value is AudioSessionLike {
  return typeof value === 'object' && value !== null && 'type' in value
}

function audioSession(): AudioSessionLike | null {
  try {
    if (typeof navigator === 'undefined' || !('audioSession' in navigator)) return null
    const session: unknown = navigator.audioSession
    return isAudioSession(session) ? session : null
  } catch {
    return null
  }
}

export function audioSessionType(): string | null {
  try {
    return audioSession()?.type ?? null
  } catch {
    return null
  }
}

function setAudioSession(type: string): void {
  try {
    const session = audioSession()
    if (session) session.type = type
  } catch {}
}

function mediaDevices(): MediaDevices | undefined {
  try {
    return navigator.mediaDevices
  } catch {
    return undefined
  }
}

export function detectSupport(): Support {
  let mode: Support['mode'] = 'Safari tab'
  try {
    mode = appMode() === 'home-screen' ? 'Home Screen app' : 'Safari tab'
  } catch {}
  return {
    recognition: recognitionConstructor() !== undefined,
    getUserMedia: typeof mediaDevices()?.getUserMedia === 'function',
    mediaRecorder: typeof MediaRecorder !== 'undefined',
    audioSession: audioSession() !== null,
    audioSessionType: audioSessionType(),
    mode,
  }
}

function stopTracks(stream: MediaStream | null): void {
  try {
    stream?.getTracks().forEach((track) => {
      track.stop()
    })
  } catch {}
}

type Hold = {
  n: number
  released: boolean

  recognitionOver: Promise<void>
  endRecognition: () => void
  recognition: SpeechRecognition | null
  stream: MediaStream | null
  recorder: MediaRecorder | null
  recorderStartedAt: number
  recorderStoppedAt: number
  chunks: Blob[]
}

type Clip = { n: number; url: string }

const VOICE_LINE = 'Here is the app’s voice. Listen to how loud it sounds.'

export class VoiceLabRig {
  private count = 0
  private held: Hold | null = null
  private clip: Clip | null = null
  private audio: HTMLAudioElement | null = null
  private recordToo = true
  private lastHold: { n: number; recognitionOver: Promise<void> } | null = null
  private voice: AppVoice | null = null
  private voiceUnlocked = false
  private voicePlays = 0
  private askedVoice = 0

  constructor(private readonly send: (event: LabEvent) => void) {}

  get holding(): boolean {
    return this.held !== null
  }

  open(): void {
    this.send({ type: 'opened', audioSession: audioSessionType() })
  }

  setHoldMode(mode: HoldMode): void {
    this.recordToo = mode === 'recognize-and-record'
    this.send({ type: 'hold-mode', mode })
  }

  holdStart(): void {
    if (this.held) return
    let endRecognition: () => void = () => undefined
    const recognitionOver = new Promise<void>((resolve) => {
      endRecognition = resolve
    })
    const hold: Hold = {
      n: ++this.count,
      released: false,
      recognitionOver,
      endRecognition,
      recognition: null,
      stream: null,
      recorder: null,
      recorderStartedAt: 0,
      recorderStoppedAt: 0,
      chunks: [],
    }
    this.held = hold

    this.pausePlayback()
    this.send({ type: 'attempt-started', n: hold.n })

    setAudioSession('auto')
    this.send({ type: 'audio-session', value: audioSessionType() })
    this.lastHold = { n: hold.n, recognitionOver }
    this.startRecognition(hold)
    if (this.recordToo) void this.startRecording(hold)
    else this.send({ type: 'mic', n: hold.n, result: 'skipped' })
  }

  holdEnd(): void {
    const hold = this.held
    if (!hold) return
    this.held = null
    hold.released = true
    this.send({ type: 'hold-ended' })
    try {
      hold.recognition?.stop()
    } catch (error) {
      this.send({
        type: 'recognition-error',
        n: hold.n,
        error: `stop failed: ${errorLabel(error)}`,
      })
      hold.endRecognition()
    }
    this.stopRecorder(hold)
  }

  play(): void {
    const clip = this.clip
    if (!clip || this.held) return
    setAudioSession('playback')
    this.send({ type: 'audio-session', value: audioSessionType() })
    try {
      const element = this.audioElement()
      element.src = clip.url
      element.volume = 1
      element.play().catch((error: unknown) => {
        this.send({ type: 'playback', n: clip.n, result: 'error', detail: errorLabel(error) })
      })
    } catch (error) {
      this.send({ type: 'playback', n: clip.n, result: 'error', detail: errorLabel(error) })
    }
  }

  async playVoice(mode: VoiceMode): Promise<void> {
    if (this.held) return
    const id = ++this.voicePlays
    try {
      const voice = this.voiceInstance()
      this.unlockVoice()
      const after = this.lastHold

      if (after) {
        await Promise.race([
          after.recognitionOver,
          new Promise<void>((resolve) => setTimeout(resolve, 2000)),
        ])
      }
      const sessionApi = audioSession() !== null
      const sessionBefore = audioSessionType()
      if (mode === 'with-fix') setAudioSession('playback')
      const sessionAfter = audioSessionType()
      this.askedVoice = id
      this.send({
        type: 'voice-asked',
        id,
        mode,
        micUsed: this.count > 0,
        afterAttempt: after?.n ?? null,
        sessionApi,
        sessionBefore,
        sessionAfter,
      })
      this.send({ type: 'audio-session', value: sessionAfter })
      const spoken = await voice.speak(VOICE_LINE)
      this.send({ type: 'voice-over', id, ok: spoken.ok, ms: spoken.ms })
    } catch (error) {
      this.send({ type: 'voice-error', id, error: errorLabel(error) })
    }
  }

  clear(): void {
    this.dropClip()
    this.send({ type: 'cleared' })
  }

  dispose(): void {
    this.holdEnd()
    try {
      this.voice?.cancel()
    } catch {}
    this.dropClip()
  }

  private voiceInstance(): AppVoice {
    this.voice ??= makeAppVoice((fallback) => {
      if (this.askedVoice > 0) {
        this.send({ type: 'voice-system', id: this.askedVoice, reason: fallback.reason })
      }
    })
    return this.voice
  }

  unlockVoice(): void {
    if (this.voiceUnlocked) return
    this.voiceUnlocked = true
    try {
      this.voiceInstance().unlock()
    } catch {}
  }

  private audioElement(): HTMLAudioElement {
    if (this.audio) return this.audio
    const element = new Audio()
    this.audio = element
    element.onplaying = () => {
      const clip = this.clip
      if (!clip) return
      this.send({ type: 'playback', n: clip.n, result: 'started' })
      if (Number.isFinite(element.duration) && element.duration > 0) {
        this.send({ type: 'clip-length', n: clip.n, seconds: element.duration })
      }
    }
    element.onended = () => {
      if (this.clip) this.send({ type: 'playback', n: this.clip.n, result: 'ended' })
    }
    element.onerror = () => {
      if (!this.clip) return
      this.send({
        type: 'playback',
        n: this.clip.n,
        result: 'error',
        detail: `media error code ${element.error?.code ?? 'unknown'}`,
      })
    }
    return element
  }

  private pausePlayback(): void {
    try {
      this.audio?.pause()
    } catch {}
  }

  private dropClip(): void {
    try {
      if (this.audio) {
        this.audio.pause()
        this.audio.removeAttribute('src')
        this.audio.load()
      }
    } catch {}
    if (this.clip) URL.revokeObjectURL(this.clip.url)
    this.clip = null
  }

  private startRecognition(hold: Hold): void {
    const Recognition = recognitionConstructor()
    if (!Recognition) {
      this.send({ type: 'recognition-unsupported', n: hold.n })
      hold.endRecognition()
      return
    }
    try {
      const rec = new Recognition()

      rec.continuous = true
      rec.interimResults = true
      rec.lang = 'en-US'
      rec.maxAlternatives = 1
      rec.onstart = () => {
        this.send({ type: 'recognition-started', n: hold.n })
      }
      rec.onresult = (event) => {
        const { final, interim } = transcriptOf(event)
        this.send({ type: 'transcript', n: hold.n, text: `${final} ${interim}`.trim() })
      }
      rec.onerror = (event) => {
        this.send({ type: 'recognition-error', n: hold.n, error: event.error })
      }
      rec.onend = () => {
        this.send({ type: 'recognition-ended', n: hold.n, whileHeld: !hold.released })
        hold.endRecognition()
      }
      hold.recognition = rec
      rec.start()
    } catch (error) {
      this.send({
        type: 'recognition-error',
        n: hold.n,
        error: `start failed: ${errorLabel(error)}`,
      })
      hold.endRecognition()
    }
  }

  private async startRecording(hold: Hold): Promise<void> {
    const devices = mediaDevices()
    if (typeof devices?.getUserMedia !== 'function' || typeof MediaRecorder === 'undefined') {
      this.send({ type: 'mic', n: hold.n, result: 'unsupported' })
      return
    }
    let stream: MediaStream
    try {
      stream = await devices.getUserMedia({ audio: true })
    } catch (error) {
      this.send({ type: 'mic', n: hold.n, result: 'failed', detail: errorLabel(error) })
      return
    }
    hold.stream = stream
    if (hold.released) {
      stopTracks(stream)
      this.send({ type: 'mic', n: hold.n, result: 'released-early' })
      return
    }
    this.send({ type: 'mic', n: hold.n, result: 'ok' })
    try {
      stream.getAudioTracks()[0]?.addEventListener('mute', () => {
        this.send({ type: 'track-mute', n: hold.n })
      })
      const recorder = new MediaRecorder(stream)
      hold.recorder = recorder
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) hold.chunks.push(event.data)
      }
      recorder.onerror = () => {
        this.send({ type: 'recorder-error', n: hold.n, error: 'MediaRecorder error event' })
      }
      recorder.onstop = () => {
        this.finishRecording(hold, recorder.mimeType)
      }
      recorder.start()
      hold.recorderStartedAt = performance.now()
      this.send({ type: 'recorder-started', n: hold.n, mimeType: recorder.mimeType })

      if (this.released(hold)) this.stopRecorder(hold)
    } catch (error) {
      stopTracks(stream)
      this.send({ type: 'recorder-error', n: hold.n, error: errorLabel(error) })
    }
  }

  private released(hold: Hold): boolean {
    return hold.released
  }

  private stopRecorder(hold: Hold): void {
    const recorder = hold.recorder
    if (!recorder || recorder.state === 'inactive') return
    try {
      const track = hold.stream?.getAudioTracks()[0]
      if (track) this.send({ type: 'track-at-stop', n: hold.n, muted: track.muted })
      hold.recorderStoppedAt = performance.now()
      recorder.stop()
    } catch (error) {
      stopTracks(hold.stream)
      this.send({ type: 'recorder-error', n: hold.n, error: errorLabel(error) })
    }
  }

  private finishRecording(hold: Hold, mimeType: string): void {
    stopTracks(hold.stream)
    const type = mimeType !== '' ? mimeType : (hold.chunks[0]?.type ?? '')
    const blob = new Blob(hold.chunks, { type })
    hold.chunks = []
    if (blob.size > 0) {
      this.dropClip()
      this.clip = { n: hold.n, url: URL.createObjectURL(blob) }
    }
    this.send({
      type: 'recorded',
      n: hold.n,
      bytes: blob.size,
      durationMs: Math.max(0, hold.recorderStoppedAt - hold.recorderStartedAt),
      mimeType: blob.type,
    })
  }
}
