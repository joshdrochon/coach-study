import { z } from 'zod'

import { getJson, type ApiResult, type Fetch } from './http'

const ratio = z.number().min(0).max(1)
const count = z.number().int().nonnegative()
const usd = z.number().nonnegative()
const ms = z.number().nonnegative().nullable()

export const systemSchema = z.object({
  today: z.string(),
  cost: z.object({
    today: usd,
    dailyCap: z.number().positive(),
    month: usd,
    monthlyLimit: z.number().positive(),
  }),
  latency: z.object({
    cardP50Ms: ms,
    cardP95Ms: ms,
    practiceP95Ms: ms,
    reviewP95Ms: ms,
  }),
  calls: z.object({ total: count, fallbacks: count, micReports: count.default(0) }),

  database: z.object({ bytes: count, clips: z.object({ rows: count, bytes: count }) }),
  evalGate: z
    .object({
      grader: z.string(),
      rubric: z.string(),

      categories: z.record(z.string(), ratio),
      heldOutAgreement: ratio.nullable(),
      falsePasses: count.nullable(),
      adversarial: z.object({ held: count, of: count }).nullable(),
      runAt: z.string(),
    })
    .nullable(),
  disputes: z.array(
    z.object({
      title: z.string(),
      status: z.enum(['Needs review', 'Resolved']),
      note: z.string(),
    }),
  ),
  traces: z.array(
    z.object({
      id: z.string(),
      call: z.string(),
      latencyMs: ms,
      costUsd: usd,
      model: z.string().nullable(),
    }),
  ),
})
export type SystemData = z.infer<typeof systemSchema>

export const EVAL_CATEGORIES = [
  'schema_valid',
  'citation_present',
  'verdict_correct',
  'no_invented_content',
  'stays_in_scope',
] as const

export const learningSchema = z.object({
  sessions: z.array(z.object({ label: z.string(), accuracy: ratio })),
  readiness: z.array(z.object({ category: z.string(), recall: ratio })),
  practices: z.array(
    z
      .object({ label: z.string(), passed: count, of: count })
      .refine((p) => p.passed <= p.of, 'passed cannot exceed of'),
  ),
  mostMissed: z.string().nullable(),
  baseline: z.object({ label: z.string(), pct: ratio, of: count }).nullable(),
  now: z.object({ pct: ratio, of: count }).nullable(),

  northStar: z.object({
    sequencesInARow: z.array(z.number().int().min(1).max(12)),
    of: z.number().int().positive(),

    reachedOn: z.string().nullable(),

    target: z.string(),
    daysLeft: z.number().int(),

    mastery: z.array(z.object({ label: z.string(), sequences: count, mastered: z.boolean() })),
  }),
})
export type LearningData = z.infer<typeof learningSchema>

export function fetchSystem(fetchImpl?: Fetch): Promise<ApiResult<SystemData>> {
  return getJson('/api/admin/system', systemSchema, fetchImpl)
}

export function fetchLearning(fetchImpl?: Fetch): Promise<ApiResult<LearningData>> {
  return getJson('/api/admin/learning', learningSchema, fetchImpl)
}
