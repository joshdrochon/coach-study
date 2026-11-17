import { z } from 'zod'

import data from '../../../content/method/practice.json'
import { CHECKLIST, type Checklist, type Part } from '../gates'

const nonBlank = z.string().regex(/\S/, 'must not be blank')
const phraseList = z.array(nonBlank).min(1)

export const moveSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: nonBlank,
  // The move's own phrase groups, used by rules as `move:<key>`; `name` is required.
  say: z.record(z.string(), phraseList).refine((say) => 'name' in say, 'a move needs say.name'),
})
export type Move = z.infer<typeof moveSchema>

export const practiceSceneSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  kind: nonBlank,
  sequence: z.number().int().positive(),
  title: nonBlank,
  moves: z.array(nonBlank).min(1),
})
export type PracticeScene = z.infer<typeof practiceSceneSchema>

export const practiceFileSchema = z.strictObject({
  phrases: z.record(z.string(), phraseList),
  moves: z.array(moveSchema).min(1),
  scenes: z.array(practiceSceneSchema).min(1),
})
export type PracticeFile = z.infer<typeof practiceFileSchema>

export type Method = PracticeFile & { checklist: Checklist }

export function partGroup(part: Part): { group: string; all: boolean } {
  return typeof part === 'string'
    ? { group: part, all: false }
    : { group: part.group, all: !!part.all }
}

// Every reference in the rules must resolve: scene kinds, moves, and phrase groups.
export function methodProblems(file: PracticeFile, checklist: Checklist): string[] {
  const problems: string[] = []
  const moves = new Map(file.moves.map((move) => [move.id, move]))
  const kinds = new Set(checklist.scenes.map((scene) => scene.kind))
  const ids = new Set<string>()
  for (const scene of file.scenes) {
    if (ids.has(scene.id)) problems.push(`duplicate scene ${scene.id}`)
    ids.add(scene.id)
    if (!kinds.has(scene.kind)) problems.push(`scene ${scene.id}: unknown kind ${scene.kind}`)
    for (const id of scene.moves) {
      if (!moves.has(id)) problems.push(`scene ${scene.id}: unknown move ${id}`)
    }
  }
  const groupExists = (group: string, gateId: string) => {
    if (!group.startsWith('move:')) return group in file.phrases
    const key = group.slice('move:'.length)
    // A move group must exist on every move a scene of this gate can coach.
    const gate = checklist.gates.find((g) => g.id === gateId)
    const coached = file.scenes
      .filter((scene) => gate?.appliesTo.includes(scene.kind))
      .flatMap((scene) => scene.moves)
    return coached.every((id) => moves.get(id)?.say[key] !== undefined)
  }
  for (const gate of checklist.gates) {
    const { rule } = gate
    if (rule.kind === 'say') {
      for (const part of rule.parts) {
        const { group } = partGroup(part)
        if (!groupExists(group, gate.id)) problems.push(`gate ${gate.id}: no phrase group ${group}`)
      }
    }
    if ((rule.kind === 'avoid' || rule.kind === 'repeat') && !(rule.phrases in file.phrases)) {
      problems.push(`gate ${gate.id}: no phrase group ${rule.phrases}`)
    }
  }
  return problems
}

export function parseMethod(raw: unknown, checklist: Checklist = CHECKLIST): Method {
  const file = practiceFileSchema.parse(raw)
  const problems = methodProblems(file, checklist)
  if (problems.length > 0) throw new Error(`practice method: ${problems.join('; ')}`)
  return { ...file, checklist }
}

export const METHOD: Method = parseMethod(data)

export function findScene(method: Method, id: string): PracticeScene | undefined {
  return method.scenes.find((scene) => scene.id === id)
}

export function sceneMoves(method: Method, scene: PracticeScene): Move[] {
  return scene.moves.flatMap((id) => method.moves.filter((move) => move.id === id))
}
