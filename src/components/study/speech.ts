// Browser wiring for the study session: speech recognition, the app voice, and the
// shared study client.

import {
  appVoice,
  holdWakeLock,
  preloadSounds,
  primeVoice,
  recognitionConstructor,
  reportMic,
  transcriptOf,
} from '@/lib/speech/browser'
import {
  SpeechController,
  type Clock,
  type ListenResult,
  type Synth,
} from '@/lib/speech/controller'
import { createStudyClient, type StudyClient } from '@/lib/study/client'
import { onStaleEpoch } from '@/lib/study/epoch'
import { StudySession, type SessionOptions, type SpeechPort } from '@/lib/study/session'

export const browserClock: Clock = {
  now: () => Date.now(),
  setTimeout: (run, ms) => window.setTimeout(run, ms),
  clearTimeout: (id) => {
    window.clearTimeout(id)
  },
}

export function observeRecognition(
  Base: SpeechRecognitionConstructor,
  onHeard: (text: string) => void,
): SpeechRecognitionConstructor {
  class ObservedRecognition extends EventTarget implements SpeechRecognition {
    onresult: SpeechRecognition['onresult'] = null
    onerror: SpeechRecognition['onerror'] = null
    onend: SpeechRecognition['onend'] = null

    onstart: SpeechRecognition['onstart'] = null
    onaudiostart: SpeechRecognition['onaudiostart'] = null
    onsoundstart: SpeechRecognition['onsoundstart'] = null
    onspeechstart: SpeechRecognition['onspeechstart'] = null
    private readonly inner: SpeechRecognition = new Base()
    private earlier = ''
    private current = ''
    private fresh = true

    private aborted = false

    constructor() {
      super()
      this.inner.onresult = (event) => {
        if (this.aborted) return
        const { final, interim } = transcriptOf(event)
        this.current = `${final} ${interim}`.trim()
        onHeard(`${this.earlier} ${this.current}`.trim())
        this.onresult?.call(this.inner, event)
      }
      this.inner.onerror = (event) => {
        if (!this.aborted) this.onerror?.call(this.inner, event)
      }
      this.inner.onend = (event) => {
        if (!this.aborted) {
          this.earlier = `${this.earlier} ${this.current}`.trim()
          this.current = ''
        }
        this.onend?.call(this.inner, event)
      }
    }

    get continuous() {
      return this.inner.continuous
    }
    set continuous(value: boolean) {
      this.inner.continuous = value
    }
    get interimResults() {
      return this.inner.interimResults
    }
    set interimResults(value: boolean) {
      this.inner.interimResults = value
    }
    get lang() {
      return this.inner.lang
    }
    set lang(value: string) {
      this.inner.lang = value
    }
    get maxAlternatives() {
      return this.inner.maxAlternatives
    }
    set maxAlternatives(value: number) {
      this.inner.maxAlternatives = value
    }

    start(): void {
      if (this.fresh) {
        this.fresh = false
        this.earlier = ''
        this.current = ''
        onHeard('')
      }
      this.aborted = false
      this.inner.start()
    }

    stop(): void {
      this.inner.stop()
    }

    abort(): void {
      this.fresh = true
      this.aborted = true
      this.inner.abort()
    }
  }
  return ObservedRecognition
}

const NO_RECOGNIZER: ListenResult = {
  transcript: '',
  words: [],
  endedBy: 'error',
  stalled: true,
  firstResultMs: null,
  durationMs: 0,
  autoRestarts: 0,
  error: 'unsupported',
}

export function browserSpeech(onHeard: (text: string) => void): SpeechPort {
  const voice = appVoice()
  preloadSounds()
  const Recognition = recognitionConstructor()
  if (!Recognition) {
    return {
      speak: (text) => voice.speak(text),
      listen: () => Promise.resolve(NO_RECOGNIZER),
      release: () => undefined,
      resume: () => false,
      cue: (id) => voice.cue(id).then(() => undefined),

      idle: () => Promise.resolve(),
      stop: () => {
        voice.cancel()
      },
      stopKeepingSound: () => {
        voice.stopLine()
      },
    }
  }
  const controller = new SpeechController(
    observeRecognition(Recognition, onHeard),
    voice,
    browserClock,
  )
  return controllerPort(controller, voice)
}

export function controllerPort(
  controller: SpeechController,
  voice: Pick<Synth, 'cancel'> & { stopLine: () => void },
): SpeechPort {
  return {
    speak: (text) => controller.speak(text),

    listen: (options) =>
      controller.listen({
        ...options,
        onIssue: (issue) => {
          options.onIssue?.(issue)
          reportMic(issue)
        },
      }),

    release: () => {
      controller.release()
    },
    resume: () => controller.resume(),
    cue: (id) => controller.cue(id).then(() => undefined),
    idle: () => controller.idle(),
    stop: () => {
      controller.stop()
      voice.cancel()
    },

    stopKeepingSound: () => {
      controller.stop()
      voice.stopLine()
    },
  }
}

let client: StudyClient | undefined

export function browserClient(): StudyClient {
  if (!client) {
    const created = createStudyClient({
      onReset: (reload) => {
        if (reload) window.location.reload()
      },
    })
    window.addEventListener('online', () => {
      void created.flush()
    })
    void created.flush()
    client = created
  }
  return client
}

export function studyReady(): Promise<void> {
  return browserClient().ready()
}

onStaleEpoch((epoch) => browserClient().serverEpoch(epoch))

export function createBrowserSession(options: SessionOptions): StudySession {
  const speech = browserSpeech((text) => {
    session.heard(text)
  })
  const session = new StudySession(
    {
      client: browserClient(),
      speech,
      clock: browserClock,
      wakeLock: holdWakeLock,
      newId: () => crypto.randomUUID(),
    },
    options,
  )
  return session
}

export function primeSpeech(): void {
  primeVoice()
}
