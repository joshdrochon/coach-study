import { z } from 'zod'

export const FALLBACK_REPORT_PATH = '/api/tts/fallback'

export const FALLBACK_REASONS = [
  'start-timeout',
  'not-audio',
  'play-refused',
  'play-error',
  'mid-line',
  'network',
  'too-long',
] as const

const statusReason = z.custom<`status-${number}`>(
  (value) => typeof value === 'string' && /^status-[1-5]\d\d$/.test(value),
)

const MAX_MS = 3_600_000
const at = z.number().int().min(0).max(MAX_MS)
const step = at.nullable()

export const fallbackReportSchema = z.object({
  reason: z.union([z.enum(FALLBACK_REASONS), statusReason]),
  chars: z.number().int().min(0).max(100_000),

  atMs: at,

  replayMs: step,
  requestMs: step,
  headersMs: step,
  blobMs: step,
  playMs: step,
})

export type FallbackReport = z.infer<typeof fallbackReportSchema>
export type FallbackReason = FallbackReport['reason']

export const FALLBACK_STEPS = [
  ['replayMs', 'replay called'],
  ['requestMs', 'request sent'],
  ['headersMs', 'headers received'],
  ['blobMs', 'blob received'],
  ['playMs', 'play called'],
] as const
