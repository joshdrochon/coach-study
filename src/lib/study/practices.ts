import { and, desc, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'

import type { Db } from '../db/client'
import { gateResults, practices } from '../db/schema'
import { findGate, GATES, isScored, sceneTitle, verdictSchema, type Verdict } from '../gates'

export type PracticeSummary = {
  id: string
  number: number
  kind: string
  sequence: number | null
  doneAt: Date
  passed: number
  of: number
  missed: string[]
}

const MUST_PASS_IDS = GATES.filter((gate) => gate.mustPass).map((gate) => gate.id)

const sceneSchema = z.object({ sequence: z.number().int().positive() })

const practiceRowSchema = z.object({
  id: z.string().min(1),
  kind: z.string(),
  scene: z.unknown(),
  doneAt: z.date(),
  number: z.number().int().positive(),
})

export function practiceLabel(practice: PracticeSummary): string {
  const title = sceneTitle(practice.kind)
  return [
    `Practice ${String(practice.number)}`,
    ...(title === null ? [] : [title]),
    ...(practice.sequence === null ? [] : [`Sequence ${String(practice.sequence)}`]),
  ].join(' · ')
}

export const STANDING: Record<Verdict, number> = { miss: 3, pass: 2, 'not-applicable': 1 }

export async function latestPractices(db: Db, limit: number): Promise<PracticeSummary[]> {
  const numbered = db
    .select({
      id: practices.id,
      kind: practices.sceneKind,
      scene: practices.scene,
      doneAt: practices.doneAt,
      number:
        sql<number>`(row_number() over (order by ${practices.doneAt}, ${practices.id}))::int`.as(
          'number',
        ),
    })
    .from(practices)
    .as('numbered')
  const graded = db
    .select({ practiceId: gateResults.practiceId })
    .from(gateResults)
    .where(
      and(
        inArray(gateResults.gateId, MUST_PASS_IDS),
        inArray(gateResults.verdict, ['pass', 'miss']),
      ),
    )
  const latest = z
    .array(practiceRowSchema)
    .parse(
      await db
        .select()
        .from(numbered)
        .where(inArray(numbered.id, graded))
        .orderBy(desc(numbered.doneAt), desc(numbered.id))
        .limit(limit),
    )
  if (latest.length === 0) return []
  const rows = await db
    .select({
      practiceId: gateResults.practiceId,
      gateId: gateResults.gateId,
      verdict: gateResults.verdict,
    })
    .from(gateResults)
    .where(
      inArray(
        gateResults.practiceId,
        latest.map((practice) => practice.id),
      ),
    )
  return latest.map((practice) => {
    const verdicts = new Map<string, Verdict>()
    for (const row of rows) {
      const verdict = verdictSchema.safeParse(row.verdict)
      if (row.practiceId !== practice.id || !verdict.success) continue
      if (!findGate(GATES, row.gateId)) continue
      const stored = verdicts.get(row.gateId)
      if (stored === undefined || STANDING[verdict.data] > STANDING[stored]) {
        verdicts.set(row.gateId, verdict.data)
      }
    }
    const mustPass = GATES.filter((gate) => gate.mustPass)
    const applied = mustPass.flatMap((gate) => {
      const verdict = verdicts.get(gate.id)
      return verdict === 'pass' || verdict === 'miss' ? [verdict] : []
    })
    const missed = (gate: (typeof GATES)[number]) => verdicts.get(gate.id) === 'miss'
    const scene = sceneSchema.safeParse(practice.scene)
    return {
      id: practice.id,
      number: practice.number,
      kind: practice.kind,
      sequence: scene.success ? scene.data.sequence : null,
      doneAt: practice.doneAt,
      passed: applied.filter((verdict) => verdict === 'pass').length,
      of: applied.length,
      missed: [
        ...mustPass.filter(missed),
        ...GATES.filter((gate) => !gate.mustPass && isScored(gate) && missed(gate)),
      ].map((gate) => gate.label),
    }
  })
}
