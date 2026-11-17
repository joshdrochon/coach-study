import { z } from 'zod'

export const SOURCE_PAGE_COUNT = 60
export const VIDEO_LENGTH_SECONDS = 90

export function timestampSeconds(timestamp: string): number {
  const [minutes = '0', seconds = '0'] = timestamp.split(':')
  return Number(minutes) * 60 + Number(seconds)
}

export const CATEGORIES = [
  'Coaching voice',
  'Floor work',
  'Standing work',
  'Balance work',
  'Stretch work',
  'Gear',
  'Glossary',
  'Basics',
] as const
export const categorySchema = z.enum(CATEGORIES)
export type Category = z.infer<typeof categorySchema>

export const ITEM_TYPES = ['recall', 'list', 'cue', 'scenario', 'audit'] as const
export const itemTypeSchema = z.enum(ITEM_TYPES)
export type ItemType = z.infer<typeof itemTypeSchema>

export const FACETS = [
  'parts',
  'position',
  'setup',
  'pace',
  'options',
  'mistakes',
  'timing',
  'load',
  'rule',
] as const

export const passageSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    id: z.string().regex(/^m\d{3}-[a-z0-9-]+$/),
    kind: z.literal('manual'),
    page: z.number().int().min(1).max(SOURCE_PAGE_COUNT),

    text: z.string().min(5),

    rows: z.array(z.string().min(1)).min(2).optional(),

    lines: z.array(z.string().min(1)).min(2).optional(),
  }),
  z.strictObject({
    id: z.string().regex(/^v\d-\d{2}-[a-z0-9-]+$/),
    kind: z.literal('video'),

    timestamp: z
      .string()
      .regex(/^\d:[0-5]\d$/)
      .refine((ts) => timestampSeconds(ts) <= VIDEO_LENGTH_SECONDS, 'past the end of the video'),
    text: z.string().min(5),
  }),
])
export type Passage = z.infer<typeof passageSchema>

export const citationSchema = z.object({
  passageId: z.string(),

  quote: z.string().min(3),
})

export const itemSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  category: categorySchema,
  type: itemTypeSchema,
  exercise: z.string().optional(),
  facet: z.enum(FACETS).optional(),

  prompt: z.string().min(5).max(240),

  answer: z.string().min(1).max(600),

  parts: z.array(z.string().min(1)).optional(),
  ordered: z.boolean().optional(),

  choices: z.array(z.string().min(1)).min(3).max(4).optional(),

  explanation: z.string().min(10).max(600),
  citations: z.array(citationSchema).min(1),
  photoId: z.string().optional(),
})
export type Item = z.infer<typeof itemSchema>

export const itemFileSchema = z.object({ category: categorySchema, items: z.array(itemSchema) })
export const passageFileSchema = z.object({ passages: z.array(passageSchema) })

export const passageRunsFileSchema = z.object({
  runs: z.array(z.array(z.string().min(1)).min(2)),
})

export const reviewSchema = z.object({
  itemId: z.string(),
  verdict: z.enum(['accepted', 'rejected']),
  reason: z.string(),
  round: z.number().int().min(1),
})
export const reviewFileSchema = z.object({ category: categorySchema, reviews: z.array(reviewSchema) })

export const BANNED_ON_LEARNER_SCREENS: [RegExp, string][] = [
  [/\breps?\b/i, 'practice (reps means exercise repetitions)'],
  [/role-?play/i, 'mic practice'],
  [/\bdrills?\b/i, 'practice'],
  [/\bitems?\b/i, 'cards'],
  [/\bverdicts?\b/i, 'result'],
  [/\bgates?\b/i, 'must-do / check'],
  [/\brecall\b/i, 'remember / ready'],
  [/\bstudents?\b/i, 'clients'],
  [/\binstructors?\b/i, 'coach'],
  [/\bmembers?\b/i, 'clients'],
  [/\bscenes?\b/i, 'class'],
  [/\bdisputes?\b/i, 'this looks wrong'],
  [/\b(leverage|seamless|delve|embark)/i, '(cut)'],
]
