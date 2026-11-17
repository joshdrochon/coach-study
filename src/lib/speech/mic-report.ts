import { z } from 'zod'

export const MIC_REPORT_PATH = '/api/mic/report'

export const MIC_REASONS = ['ended-early', 'restart-failed', 'start-failed'] as const

const errorReason = z.custom<`error-${string}`>(
  (value) => typeof value === 'string' && /^error-[a-z-]{1,40}$/.test(value),
)

const MAX_MS = 3_600_000
const ms = z.number().int().min(0).max(MAX_MS)

export const micReportSchema = z.object({
  reason: z.union([z.enum(MIC_REASONS), errorReason]),

  endOn: z.enum(['release', 'silence', 'tap', 'done-word']),

  atMs: ms,

  restarts: z.number().int().min(0).max(1000),

  firstResultMs: ms.nullable(),

  app: z.enum(['safari-tab', 'home-screen']),
})

export type MicReport = z.infer<typeof micReportSchema>

export const MIC_REPORTS_PER_MINUTE = 30
