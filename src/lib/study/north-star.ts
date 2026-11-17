import { appliesIn, CHECKLIST, GATES, type Gate, type GateId, type Verdict } from '../gates'

export const IN_A_ROW = CHECKLIST.goal.inARow

export type Rep = {
  id: string
  doneAt: Date
  kind: string
  sequence: number | null
  verdicts: Partial<Record<GateId, Verdict>>
}

const mustPass = (gates: readonly Gate[]) => gates.filter((gate) => gate.mustPass)

const inOrder = (reps: readonly Rep[]) =>
  [...reps]
    .filter((rep): rep is Rep & { sequence: number } => rep.sequence !== null)
    .sort((a, b) => a.doneAt.getTime() - b.doneAt.getTime() || a.id.localeCompare(b.id))

function passesEveryMustPass(rep: Rep, gates: readonly Gate[]): boolean {
  for (const gate of mustPass(gates)) {
    if (!appliesIn(gate, rep.kind)) continue
    const verdict = rep.verdicts[gate.id]
    if (verdict === 'not-applicable') continue
    if (verdict !== 'pass') return false
  }
  return true
}

export type NorthStar = { reachedAt: Date | null; sequencesInARow: number[] }

// The goal: every must-pass check passed on IN_A_ROW different sequences in a row.
export function northStar(reps: readonly Rep[], gates: readonly Gate[] = GATES): NorthStar {
  let reachedAt: Date | null = null
  let run: number[] = []
  for (const rep of inOrder(reps)) {
    if (!passesEveryMustPass(rep, gates)) {
      run = []
      continue
    }
    if (!run.includes(rep.sequence)) run = [...run, rep.sequence]
    if (reachedAt === null && run.length >= IN_A_ROW) reachedAt = rep.doneAt
  }
  return { reachedAt, sequencesInARow: run }
}

export type GateMastery = {
  gateId: GateId
  mastered: boolean
  passesInARow: number
  sequences: number[]
}

// A must-pass check is mastered once it has passed IN_A_ROW times in a row, on as many sequences.
export function gateMastery(reps: readonly Rep[], gates: readonly Gate[] = GATES): GateMastery[] {
  const ordered = inOrder(reps)
  return mustPass(gates).map((gate) => {
    let run: number[] = []
    for (const rep of ordered) {
      if (!appliesIn(gate, rep.kind)) continue
      const verdict = rep.verdicts[gate.id]
      if (verdict === 'not-applicable') continue
      run = verdict === 'pass' ? [...run, rep.sequence] : []
    }
    const sequences = [...new Set(run)]
    return {
      gateId: gate.id,
      mastered: run.length >= IN_A_ROW && sequences.length >= IN_A_ROW,
      passesInARow: run.length,
      sequences,
    }
  })
}
