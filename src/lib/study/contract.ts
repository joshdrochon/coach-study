import { z } from 'zod'

import { itemTypeSchema } from '../content/schema'
import { REVIEW_EVENT_MODES } from '../db/review-modes'

import { ANSWER_ENTRIES } from './entry'

export const STUDY_MODES = ['start', 'focus', 'together'] as const
export const studyModeSchema = z.enum(STUDY_MODES)

export const SESSION_MODES = [...STUDY_MODES, 'baseline'] as const
export const sessionModeSchema = z.enum(SESSION_MODES)
export type SessionMode = z.infer<typeof sessionModeSchema>

const csv = z
  .string()
  .optional()
  .transform((value) => (value ? value.split(',').filter((part) => part.length > 0) : []))

export const nextQuerySchema = z.object({
  mode: sessionModeSchema,
  categories: csv,
  exclude: csv,
})

export const cardViewSchema = z.object({
  itemId: z.string().min(1),
  category: z.string(),
  type: itemTypeSchema,
  prompt: z.string().min(1),

  choices: z.array(z.string()).optional(),
  parts: z.array(z.string()).optional(),
  ordered: z.boolean().optional(),
  answer: z.string(),
  explanation: z.string(),

  citation: z.object({ label: z.string().min(1), quote: z.string() }),
  photo: z.object({ src: z.string().min(1), alt: z.string() }).optional(),
  exercise: z.string().optional(),

  dueInMs: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),

  format: z.enum(['free', 'choices']).optional(),

  hintFirst: z.boolean().optional(),

  baseline: z.boolean().optional(),
})
export type CardView = z.infer<typeof cardViewSchema>

export const todaySchema = z.object({
  due: z.number().int().nonnegative(),
  newLeft: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
})

export const nextResponseSchema = z.object({ card: cardViewSchema.nullable(), today: todaySchema })
export type NextResponse = z.infer<typeof nextResponseSchema>

const rating = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])

export const reviewEventSchema = z.object({
  eventId: z.uuid(),
  itemId: z.string().min(1),

  mode: sessionModeSchema,
  result: z.enum(['right', 'partial', 'wrong']),
  rating,
  proposedRating: rating,
  overridden: z.boolean(),
  answerText: z.string().max(4000),
  answerMs: z.number().int().nonnegative(),
  hintUsed: z.boolean(),
  gradedBy: z.enum(['tutor', 'self', 'code']),
  traceId: z.string().nullable(),
  reviewedAt: z.iso.datetime({ offset: true }),

  format: z.enum(['free', 'choices']).optional(),

  hintImposed: z.boolean().optional(),

  deviceId: z.string().min(1).max(100).optional(),

  changedAt: z.iso.datetime({ offset: true }).optional(),
})
export type ReviewEvent = z.infer<typeof reviewEventSchema>

export const flagAnswerSchema = z.object({
  text: z.string().max(4000),
  reviewedAt: z.iso.datetime({ offset: true }),
  result: z.enum(['right', 'partial', 'wrong']),
  gradedBy: z.enum(['tutor', 'self', 'code']),

  entry: z.enum(ANSWER_ENTRIES).default('voice'),
})
export type FlagAnswer = z.infer<typeof flagAnswerSchema>

export const flagRequestSchema = z.object({
  itemId: z.string().max(120),
  note: z.string().max(2000).default(''),

  flagId: z.uuid().optional(),

  answer: flagAnswerSchema.optional().catch(undefined),
})
export type FlagRequest = z.input<typeof flagRequestSchema>

export const homeViewSchema = z.object({
  daysToPracticeDay: z.number().int(),
  daysToFirstClass: z.number().int(),
  dueToday: z.number().int().nonnegative(),

  weakestMustDo: z.string().nullable(),
  title: z.string().min(1),
  name: z.string().min(1),
  avatarUrl: z.string().min(1),

  baseline: z
    .object({ label: z.string().min(1), cards: z.number().int().positive() })
    .nullable()
    .optional(),

  micPracticesToday: z.number().int().nonnegative().optional(),

  readiness: z
    .object({ now: z.number().min(0).max(1), afterToday: z.number().min(0).max(1) })
    .nullable()
    .optional(),

  paceStart: z.number().min(0).max(1).nullable().optional(),

  studiedToday: z.boolean().optional(),
})
export type HomeView = z.infer<typeof homeViewSchema>

export const deckCardSchema = cardViewSchema
  .omit({ choices: true, dueInMs: true, format: true, hintFirst: true })
  .extend({
    choices: z.array(z.string()).optional(),
    position: z.number().int().nonnegative(),
  })
export type DeckCard = z.infer<typeof deckCardSchema>

export const syncEventSchema = z.object({
  id: z.string().min(1),
  itemId: z.string().min(1),
  mode: z.enum(REVIEW_EVENT_MODES),
  result: z.enum(['right', 'partial', 'wrong']),
  rating,
  proposedRating: rating,
  overridden: z.boolean(),
  answerMs: z.number().int().nonnegative(),
  hintUsed: z.boolean(),
  hintImposed: z.boolean(),
  gradedBy: z.enum(['tutor', 'self', 'code']),
  format: z.enum(['free', 'choices']),
  reviewedAt: z.iso.datetime({ offset: true }),
  changedAt: z.iso.datetime({ offset: true }).nullable(),
  receivedAt: z.iso.datetime({ offset: true }),
})
export type SyncEvent = z.infer<typeof syncEventSchema>

export const syncResponseSchema = z.object({
  deckVersion: z.string().min(1),

  deck: z.array(deckCardSchema).nullable(),

  events: z.array(syncEventSchema),

  quarantined: z.array(z.string()),

  epoch: z.number().int().nonnegative(),
})
export type SyncResponse = z.infer<typeof syncResponseSchema>
