import { z } from 'zod'

export const RESULTS = ['right', 'partial', 'wrong'] as const
export type Result = (typeof RESULTS)[number]

export const draftCardSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  answer: z.string(),
  citations: z.array(z.object({ passageId: z.string(), quote: z.string(), source: z.string() })),
})
export type DraftCard = z.infer<typeof draftCardSchema>

export const draftCaseViewSchema = z.object({
  id: z.uuid(),
  flagId: z.string().nullable(),
  card: draftCardSchema,

  words: z.string(),
  wordsFrom: z.enum(['answer', 'note']),
  entry: z.enum(['voice', 'typed', 'choice']),
  note: z.string(),
  firstResult: z.enum(RESULTS),
  opusModel: z.string(),
  opusResult: z.enum(RESULTS),
  opusReason: z.string(),
  answeredAt: z.string(),
  flaggedAt: z.string(),
})
export type DraftCaseView = z.infer<typeof draftCaseViewSchema>

export const flaggedViewSchema = z.object({
  drafts: z.array(draftCaseViewSchema),
  reviewed: z.object({
    approved: z.number().int().nonnegative(),
    fixed: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
  }),
})
export type FlaggedView = z.infer<typeof flaggedViewSchema>

export const REASON_MIN = 5

export const reviewRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ id: z.uuid(), action: z.literal('approve') }),
  z.strictObject({ id: z.uuid(), action: z.literal('reject') }),
  z.strictObject({
    id: z.uuid(),
    action: z.literal('fix'),
    expected: z.enum(RESULTS),
    reason: z.string().trim().min(REASON_MIN).max(2000),
  }),
])
export type ReviewRequest = z.infer<typeof reviewRequestSchema>

export const reviewedSchema = z.object({
  ok: z.literal(true),
  status: z.enum(['approved', 'fixed', 'rejected']),
  returned: z.boolean(),
})
export type Reviewed = z.infer<typeof reviewedSchema>
