export {}

declare global {
  interface SpeechRecognition extends EventTarget {
    continuous: boolean
    interimResults: boolean
    lang: string
    maxAlternatives: number
    onresult: ((this: SpeechRecognition, event: SpeechRecognitionEvent) => void) | null
    onerror: ((this: SpeechRecognition, event: SpeechRecognitionErrorEvent) => void) | null
    onstart: ((this: SpeechRecognition, event: Event) => void) | null
    onend: ((this: SpeechRecognition, event: Event) => void) | null
    onaudiostart: ((this: SpeechRecognition, event: Event) => void) | null
    onsoundstart: ((this: SpeechRecognition, event: Event) => void) | null
    onspeechstart: ((this: SpeechRecognition, event: Event) => void) | null
    start(): void
    stop(): void
    abort(): void
  }

  type SpeechRecognitionConstructor = new () => SpeechRecognition

  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }

  interface Navigator {
    standalone?: boolean
  }
}
