import type { Db } from '@/lib/db/client'
import { gateResults, practices } from '@/lib/db/schema'

let practiceNumber = 0

export type PracticeRow = {
  doneAt: Date
  kind?: string
  scene?: unknown
  verdicts?: Record<string, 'pass' | 'miss' | 'not-applicable'>
}

export async function insertPractice(db: Db, row: PracticeRow): Promise<string> {
  practiceNumber += 1
  const id = `00000000-0000-4000-8000-${String(practiceNumber).padStart(12, '0')}`
  await db.insert(practices).values({
    id,
    deviceId: 'ipad',
    sceneKind: row.kind ?? 'warm-up',
    scene: row.scene ?? { sceneId: 'sequence-01-warm-up', sequence: 1 },
    transcript: {},
    startedAt: row.doneAt,
    doneAt: row.doneAt,
  })
  const verdicts = Object.entries(row.verdicts ?? {})
  if (verdicts.length > 0) {
    await db
      .insert(gateResults)
      .values(verdicts.map(([gateId, verdict]) => ({ practiceId: id, gateId, verdict })))
  }
  return id
}
