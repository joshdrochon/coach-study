import { z } from 'zod'

const nonBlank = z.string().regex(/\S/, 'must not be blank')

export const VERDICTS = ['pass', 'miss', 'not-applicable'] as const
export const verdictSchema = z.enum(VERDICTS)
export type Verdict = z.infer<typeof verdictSchema>

export type GateId = string
export type SceneKind = string

// A part names a phrase group: a key of practice.json's `phrases`, or `move:<key>` for the group
// of that key on the move being coached. With `all`, every phrase of the group must be said.
export const partSchema = z.union([
  nonBlank,
  z.strictObject({ group: nonBlank, all: z.boolean().optional() }),
])
export type Part = z.infer<typeof partSchema>

export const SCOPES = ['each-move', 'first-move', 'last-move', 'practice'] as const

// What the engine checks for one must-do. Every rule is data: the engine knows only these kinds.
export const ruleSchema = z.discriminatedUnion('kind', [
  // Say every part, in order when `ordered`, inside the scope (and the window, if given).
  z.strictObject({
    kind: z.literal('say'),
    scope: z.enum(SCOPES),
    parts: z.array(partSchema).min(1),
    ordered: z.boolean(),
    window: z
      .strictObject({ from: z.enum(['start', 'end']), ms: z.number().int().positive() })
      .optional(),
  }),
  // Never say a phrase of the group.
  z.strictObject({ kind: z.literal('avoid'), phrases: nonBlank }),
  // Say phrases of the group at least `atLeast` times over the whole practice.
  z.strictObject({
    kind: z.literal('repeat'),
    phrases: nonBlank,
    atLeast: z.number().int().min(1),
  }),
  // Judged by the tutor model, which must quote their words; `ask` is its question.
  z.strictObject({ kind: z.literal('tutor'), ask: nonBlank }),
])
export type Rule = z.infer<typeof ruleSchema>

export const gateSchema = z.strictObject({
  id: z.string().regex(/^[A-Z]\d{1,2}$/),
  mustPass: z.boolean(),
  name: nonBlank,
  label: nonBlank,
  appliesTo: z.array(nonBlank).min(1),
  rule: ruleSchema,
})
export type Gate = z.infer<typeof gateSchema>

export const sceneSchema = z.strictObject({ kind: nonBlank, title: nonBlank })
export type Scene = z.infer<typeof sceneSchema>

export const checklistSchema = z
  .strictObject({
    name: nonBlank,
    goal: z.strictObject({
      inARow: z.number().int().min(1),
      targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
    scenes: z.array(sceneSchema).min(1),
    gates: z.array(gateSchema).min(1),
  })
  .superRefine((list, ctx) => {
    const kinds = new Set(list.scenes.map((scene) => scene.kind))
    const ids = new Set<string>()
    for (const gate of list.gates) {
      if (ids.has(gate.id)) ctx.addIssue({ code: 'custom', message: `duplicate gate ${gate.id}` })
      ids.add(gate.id)
      for (const kind of gate.appliesTo) {
        if (!kinds.has(kind)) {
          ctx.addIssue({ code: 'custom', message: `gate ${gate.id}: unknown scene ${kind}` })
        }
      }
    }
  })
export type Checklist = z.infer<typeof checklistSchema>
