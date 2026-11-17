import data from '../../../content/method/checklist.json'

import { checklistSchema, type Checklist, type Gate, type GateId, type SceneKind } from './types'

export * from './types'

// The practice checklist is data (content/method/checklist.json), not code: the engine only knows
// that a checklist has scenes and must-dos, and each must-do applies to some scenes.
export function parseChecklist(raw: unknown): Checklist {
  return checklistSchema.parse(raw)
}

export const CHECKLIST: Checklist = parseChecklist(data)
export const GATES: readonly Gate[] = CHECKLIST.gates

export function findGate(gates: readonly Gate[], id: string): Gate | undefined {
  return gates.find((gate) => gate.id === id)
}

export function gateById(id: GateId): Gate {
  const gate = findGate(GATES, id)
  if (!gate) throw new Error(`unknown gate ${id}`)
  return gate
}

export function isScored(gate: Gate): boolean {
  return gate.mustPass
}

export function appliesIn(gate: Gate, kind: SceneKind): boolean {
  return gate.appliesTo.includes(kind)
}

export function sceneTitle(kind: SceneKind, checklist: Checklist = CHECKLIST): string | null {
  return checklist.scenes.find((scene) => scene.kind === kind)?.title ?? null
}
