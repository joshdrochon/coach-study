import { z } from 'zod'

import type { LearningData } from '../dashboard/client'
import { formatShortDate } from '../dashboard/format'
import type { Db } from '../db/client'
import { gateResults, practices } from '../db/schema'
import {
  CHECKLIST,
  findGate,
  GATES,
  sceneTitle,
  verdictSchema,
  type GateId,
  type Verdict,
} from '../gates'
import { gateMastery, IN_A_ROW, northStar, type Rep } from './north-star'

import { daysUntil } from './days'
import { STANDING } from './practices'

const sceneSchema = z.object({ sequence: z.number().int() })

export const NORTH_STAR_TARGET = CHECKLIST.goal.targetDate

export async function loadReps(db: Db): Promise<Rep[]> {
  const [rows, results] = await Promise.all([
    db
      .select({
        id: practices.id,
        kind: practices.sceneKind,
        scene: practices.scene,
        doneAt: practices.doneAt,
      })
      .from(practices),
    db
      .select({
        practiceId: gateResults.practiceId,
        gateId: gateResults.gateId,
        verdict: gateResults.verdict,
      })
      .from(gateResults),
  ])
  const byPractice = new Map<string, Partial<Record<GateId, Verdict>>>()
  for (const row of results) {
    const verdict = verdictSchema.safeParse(row.verdict)
    const gate = findGate(GATES, row.gateId)
    if (!verdict.success || !gate) continue
    const verdicts = byPractice.get(row.practiceId) ?? {}
    const stored = verdicts[gate.id]
    if (stored === undefined || STANDING[verdict.data] > STANDING[stored]) {
      verdicts[gate.id] = verdict.data
    }
    byPractice.set(row.practiceId, verdicts)
  }
  return rows.flatMap((row) => {
    if (sceneTitle(row.kind) === null) return []
    const scene = sceneSchema.safeParse(row.scene)
    const sequence = scene.success ? scene.data.sequence : null
    return [
      {
        id: row.id,
        doneAt: row.doneAt,
        kind: row.kind,
        sequence,
        verdicts: byPractice.get(row.id) ?? {},
      },
    ]
  })
}

export function northStarView(reps: readonly Rep[], now: Date): LearningData['northStar'] {
  const star = northStar(reps)
  return {
    sequencesInARow: star.sequencesInARow,
    of: IN_A_ROW,
    reachedOn: star.reachedAt ? formatShortDate(star.reachedAt) : null,
    target: formatShortDate(new Date(`${NORTH_STAR_TARGET}T12:00:00Z`)),
    daysLeft: daysUntil(NORTH_STAR_TARGET, now),
    mastery: gateMastery(reps).map((entry) => ({
      label: GATES.find((gate) => gate.id === entry.gateId)?.label ?? entry.gateId,
      sequences: entry.sequences.length,
      mastered: entry.mastered,
    })),
  }
}
