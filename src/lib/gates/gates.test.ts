import { describe, expect, it } from 'vitest'

import { gateMastery, northStar, type Rep } from '../study/north-star'

import {
  appliesIn,
  CHECKLIST,
  findGate,
  gateById,
  GATES,
  isScored,
  parseChecklist,
  sceneTitle,
  type Gate,
} from '.'

const SAY = { kind: 'say', scope: 'each-move', parts: ['move:name'], ordered: false } as const

const SAMPLE = {
  name: 'Test method',
  goal: { inARow: 2, targetDate: '2030-01-01' },
  scenes: [
    { kind: 'open', title: 'Open' },
    { kind: 'close', title: 'Close' },
  ],
  gates: [
    {
      id: 'A1',
      mustPass: true,
      name: 'Opens',
      label: 'Open clearly',
      appliesTo: ['open'],
      rule: SAY,
    },
    {
      id: 'B1',
      mustPass: false,
      name: 'Extra',
      label: 'Extra cue',
      appliesTo: ['open', 'close'],
      rule: SAY,
    },
    {
      id: 'C1',
      mustPass: true,
      name: 'Closes',
      label: 'Close clearly',
      appliesTo: ['close'],
      rule: SAY,
    },
  ],
}

describe('the practice checklist is data', () => {
  it('loads the shipped sample checklist', () => {
    expect(CHECKLIST.name).toBe('Sample Move method')
    expect(GATES.length).toBeGreaterThan(0)
    expect(GATES.every((gate) => gate.appliesTo.every((kind) => sceneTitle(kind) !== null))).toBe(
      true,
    )
  })

  it('finds a check by id and refuses an unknown one', () => {
    const [first] = GATES
    if (!first) throw new Error('no gates')
    expect(findGate(GATES, first.id)).toBe(first)
    expect(gateById(first.id)).toBe(first)
    expect(findGate(GATES, 'Z9')).toBeUndefined()
    expect(() => gateById('Z9')).toThrow('unknown gate Z9')
  })

  it('scores only must-pass checks, and applies each only in its own scenes', () => {
    const list = parseChecklist(SAMPLE)
    const [open, extra, close] = list.gates as [Gate, Gate, Gate]
    expect(isScored(open)).toBe(true)
    expect(isScored(extra)).toBe(false)
    expect(appliesIn(open, 'open')).toBe(true)
    expect(appliesIn(close, 'open')).toBe(false)
    expect(sceneTitle('close', list)).toBe('Close')
    expect(sceneTitle('nowhere', list)).toBeNull()
  })

  it('refuses a check for a scene the checklist does not have, and a duplicate id', () => {
    const unknownScene = {
      ...SAMPLE,
      gates: SAMPLE.gates.map((gate, i) => (i === 0 ? { ...gate, appliesTo: ['middle'] } : gate)),
    }
    expect(() => parseChecklist(unknownScene)).toThrow(/unknown scene middle/)
    const duplicate = {
      ...SAMPLE,
      gates: SAMPLE.gates.map((gate, i) => (i === 1 ? { ...gate, id: 'A1' } : gate)),
    }
    expect(() => parseChecklist(duplicate)).toThrow(/duplicate gate A1/)
  })
})

describe('the goal and mastery, over the checklist', () => {
  const list = parseChecklist(SAMPLE)
  const day = (n: number) => new Date(Date.UTC(2030, 0, n))
  const rep = (n: number, kind: string, sequence: number, verdicts: Rep['verdicts']): Rep => ({
    id: `rep-${String(n)}`,
    doneAt: day(n),
    kind,
    sequence,
    verdicts,
  })

  it('counts different sequences in a row that pass every must-pass check that applies', () => {
    const reps = [
      rep(1, 'open', 1, { A1: 'pass', B1: 'miss' }),
      rep(2, 'close', 2, { C1: 'miss' }),
      rep(3, 'open', 3, { A1: 'pass' }),
      rep(4, 'close', 4, { C1: 'pass' }),
    ]
    const star = northStar(reps, list.gates)
    expect(star.sequencesInARow).toEqual([3, 4])
  })

  it('masters a check after passes in a row; a miss starts it over; not applicable is skipped', () => {
    const reps = [
      rep(1, 'open', 1, { A1: 'pass' }),
      rep(2, 'open', 2, { A1: 'miss' }),
      rep(3, 'open', 3, { A1: 'pass' }),
      rep(4, 'open', 4, { A1: 'not-applicable' }),
      rep(5, 'open', 5, { A1: 'pass' }),
    ]
    const [opens, closes] = gateMastery(reps, list.gates)
    expect(opens).toMatchObject({ gateId: 'A1', passesInARow: 2, sequences: [3, 5] })
    expect(closes).toMatchObject({ gateId: 'C1', passesInARow: 0, mastered: false })
  })
})
