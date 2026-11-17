// Tutor failures, each with the HTTP status the API answers with. Every failure
// falls back to self-grading on the client.

import type { ModelId, Usage } from '../grader/models'

export const TUTOR_ERRORS = [
  'rate-limited',
  'daily-cap',
  'spend-limit',
  'timeout',
  'upstream',
  'refused',
  'invalid-output',
  'misconfigured',
] as const
export type TutorErrorKind = (typeof TUTOR_ERRORS)[number]

export type FailedSpend = 'nothing' | { model: ModelId; usage: Usage }

export class TutorError extends Error {
  constructor(
    readonly kind: TutorErrorKind,
    message: string,
    readonly spend?: FailedSpend,
  ) {
    super(message)
    this.name = 'TutorError'
  }
}

export class CutOffError extends TutorError {
  constructor(spend: FailedSpend) {
    super('invalid-output', 'no valid answer (stop: max_tokens)', spend)
  }
}

export const STATUS: Record<TutorErrorKind, number> = {
  'rate-limited': 429,
  'daily-cap': 429,
  'spend-limit': 429,
  timeout: 504,
  upstream: 502,
  refused: 502,
  'invalid-output': 502,
  misconfigured: 503,
}

export type TutorErrorBody = { error: TutorErrorKind; fallback: 'self-grade' }

export function errorBody(kind: TutorErrorKind): TutorErrorBody {
  return { error: kind, fallback: 'self-grade' }
}
