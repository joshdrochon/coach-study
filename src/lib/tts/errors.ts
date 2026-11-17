export const TTS_ERRORS = [
  'invalid',
  'no-key',
  'not-found',
  'rate-limited',
  'budget',
  'timeout',
  'upstream',
] as const
export type TtsErrorKind = (typeof TTS_ERRORS)[number]

export class TtsError extends Error {
  constructor(
    readonly kind: TtsErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'TtsError'
  }
}

export const TTS_STATUS: Record<TtsErrorKind, number> = {
  invalid: 400,
  'no-key': 503,
  'not-found': 404,
  'rate-limited': 429,
  budget: 429,
  timeout: 504,
  upstream: 502,
}

export type TtsErrorBody = { error: TtsErrorKind; fallback: 'system-voice' }

export function ttsErrorBody(kind: TtsErrorKind): TtsErrorBody {
  return { error: kind, fallback: 'system-voice' }
}
