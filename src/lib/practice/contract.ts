import { z } from 'zod'

// The wire format between the practice screen and the server, shared by both sides.

const MAX_MS = 600_000

export const practiceRequestSchema = z
  .strictObject({
    sceneId: z.string().min(1).max(80),
    entry: z.enum(['voice', 'typed']),
    words: z
      .array(
        z.strictObject({
          text: z.string().min(1).max(80),
          atMs: z.number().int().min(0).max(MAX_MS),
        }),
      )
      .max(4000),
    marks: z.array(z.number().int().min(0).max(MAX_MS)).min(1).max(20),
    doneAtMs: z.number().int().min(0).max(MAX_MS),
    selfReview: z
      .strictObject({ wentWell: z.string().max(400), toWorkOn: z.string().max(400) })
      .optional(),
    deviceId: z.string().min(1).max(100).optional(),
  })
  .refine((r) => r.marks.every((mark, i) => i === 0 || mark >= (r.marks[i - 1] ?? 0)), {
    message: 'marks must not go back in time',
  })
  .refine((r) => r.marks.every((mark) => mark <= r.doneAtMs), {
    message: 'a mark comes after done',
  })
export type PracticeRequest = z.infer<typeof practiceRequestSchema>

export const reportCheckSchema = z.object({
  gateId: z.string(),
  label: z.string(),
  mustPass: z.boolean(),
  verdict: z.enum(['pass', 'miss', 'not-applicable', 'unjudged']),
  by: z.enum(['code', 'tutor']),
  quote: z.string().nullable(),
  note: z.string(),
  moves: z.array(z.object({ moveId: z.string(), name: z.string(), ok: z.boolean() })).optional(),
})
export type ReportCheck = z.infer<typeof reportCheckSchema>

export const practiceReportSchema = z.object({
  practiceId: z.string(),
  sceneId: z.string(),
  checks: z.array(reportCheckSchema),
  mustPass: z.object({ passed: z.number().int(), of: z.number().int() }),
  allMustPass: z.boolean(),
  feedback: z.object({ wentWell: z.string(), toWorkOn: z.string(), by: z.enum(['tutor', 'code']) }),
  tutor: z.enum(['ok', 'unavailable']),
})
export type PracticeReport = z.infer<typeof practiceReportSchema>

export const sceneViewSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  moves: z.array(z.object({ id: z.string(), name: z.string() })),
  checks: z.array(z.object({ gateId: z.string(), label: z.string(), mustPass: z.boolean() })),
})
export type SceneView = z.infer<typeof sceneViewSchema>
