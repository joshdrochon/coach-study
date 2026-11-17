import { z } from 'zod'

export const reminderChangeSchema = z.object({ ok: z.literal(true) })

export const reminderKeySchema = z.object({ publicKey: z.string().min(1).nullable() })

export const NUDGE_OUTCOMES = ['sent', 'failed', 'skipped'] as const

export const NUDGE_RUN_REASONS = [
  'not-studied',
  'cards-left',

  'quiet-hours',
  'daily-limit',
  'too-soon',
  'studying',
  'nothing-left',
  'no-subscription',

  'busy',
] as const

export const nudgeRunSchema = z.object({
  outcome: z.enum(NUDGE_OUTCOMES),
  reason: z.enum(NUDGE_RUN_REASONS),
  delivered: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
})
export type NudgeRunResult = z.infer<typeof nudgeRunSchema>
