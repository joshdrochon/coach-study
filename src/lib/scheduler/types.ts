import { Rating, State } from 'ts-fsrs'
import { z } from 'zod'

export const dateSchema = z
  .union([z.date(), z.iso.datetime({ offset: true })])
  .transform((value) => (typeof value === 'string' ? new Date(value) : value))

export const ITEM_TYPES = ['recall', 'list', 'cue', 'scenario', 'audit'] as const
export const itemTypeSchema = z.enum(ITEM_TYPES)
export type ItemType = z.infer<typeof itemTypeSchema>

export const stateSchema = z.enum(State)

export const gradeSchema = z.union([
  z.literal(Rating.Again),
  z.literal(Rating.Hard),
  z.literal(Rating.Good),
  z.literal(Rating.Easy),
])

export const fsrsCardSchema = z.object({
  due: dateSchema,
  stability: z.number().nonnegative(),
  difficulty: z.number().min(0).max(10),
  elapsed_days: z.number().int().nonnegative(),
  scheduled_days: z.number().int().nonnegative(),
  learning_steps: z.number().int().nonnegative(),
  reps: z.number().int().nonnegative(),
  lapses: z.number().int().nonnegative(),
  state: stateSchema,
  last_review: dateSchema.nullish().transform((value) => value ?? undefined),
})
export type FsrsCardState = z.infer<typeof fsrsCardSchema>

export const schedulerCardSchema = z.object({
  itemId: z.string().min(1),

  category: z.string().min(1),
  itemType: itemTypeSchema,

  topic: z.string().min(1).nullable(),

  hasChoices: z.boolean(),

  position: z.number().int().nonnegative(),

  quarantined: z.boolean(),
  fsrs: fsrsCardSchema,
})
export type SchedulerCard = z.infer<typeof schedulerCardSchema>

export const correctnessSchema = z.enum(['right', 'partial', 'wrong'])
export type Correctness = z.infer<typeof correctnessSchema>

export const presentationFormatSchema = z.enum(['free', 'choices'])
export type PresentationFormat = z.infer<typeof presentationFormatSchema>

export const REVIEW_CONTEXTS = ['study', 'baseline', 'mic-practice'] as const
export const reviewContextSchema = z.enum(REVIEW_CONTEXTS)
export type ReviewContext = z.infer<typeof reviewContextSchema>

export const fsrsLogSchema = z.object({
  rating: gradeSchema,
  state: stateSchema,
  due: dateSchema,
  stability: z.number().nonnegative(),
  difficulty: z.number().min(0).max(10),
  elapsed_days: z.number().int().nonnegative(),
  last_elapsed_days: z.number().int().nonnegative(),
  scheduled_days: z.number().int().nonnegative(),
  learning_steps: z.number().int().nonnegative(),
  review: dateSchema,
})

export const reviewLogSchema = z.object({
  itemId: z.string().min(1),
  context: reviewContextSchema,

  proposed: gradeSchema.nullable(),

  result: correctnessSchema,

  graded: correctnessSchema,

  format: presentationFormatSchema.default('free'),

  helped: z.boolean(),
  fsrs: fsrsLogSchema,
})
export type ReviewLog = z.infer<typeof reviewLogSchema>

export type ReviewResult = { card: SchedulerCard; log: ReviewLog }

export const MODES = ['start', 'focus', 'together'] as const
export const modeSchema = z.enum(MODES)
export type Mode = z.infer<typeof modeSchema>

export const modeRequestSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('start') }),
  z.object({ mode: z.literal('focus'), categories: z.array(z.string().min(1)).min(1) }),
  z.object({ mode: z.literal('together') }),
])
export type ModeRequest = z.infer<typeof modeRequestSchema>

export const ratingInputSchema = z.object({
  correct: correctnessSchema,

  answerMs: z.number().nonnegative(),
  hintUsed: z.boolean(),

  hintImposed: z.boolean().default(false),
  itemType: itemTypeSchema,
  format: presentationFormatSchema.default('free'),
})
export type RatingInput = z.input<typeof ratingInputSchema>
