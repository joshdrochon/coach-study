import { describe, expect, it } from 'vitest'

import data from '../../../content/method/practice.json'
import { CHECKLIST } from '../gates'

import { methodProblems, parseMethod, practiceFileSchema, sceneMoves, METHOD } from './method'

const file = practiceFileSchema.parse(data)

describe('the practice method is data, checked on load', () => {
  it('ships an invented method of 3 to 5 moves, each scene a run of them', () => {
    expect(METHOD.moves.length).toBeGreaterThanOrEqual(3)
    expect(METHOD.moves.length).toBeLessThanOrEqual(5)
    for (const scene of METHOD.scenes)
      expect(sceneMoves(METHOD, scene).length).toBe(scene.moves.length)
    expect(new Set(METHOD.scenes.map((s) => s.sequence)).size).toBe(METHOD.scenes.length)
  })

  it('gives every scored check a rule', () => {
    expect(CHECKLIST.gates.every((gate) => typeof gate.rule.kind === 'string')).toBe(true)
  })

  it('refuses a scene of an unknown kind or with an unknown move', () => {
    const [first] = file.scenes
    if (!first) throw new Error('no scenes')
    const bad = { ...file, scenes: [{ ...first, kind: 'nowhere', moves: ['no-such-move'] }] }
    expect(methodProblems(bad, CHECKLIST)).toEqual([
      'scene warm-up-1: unknown kind nowhere',
      'scene warm-up-1: unknown move no-such-move',
    ])
  })

  it('refuses a rule whose phrase group is missing, on the method or on a move', () => {
    const noPace = { ...file, phrases: { ...file.phrases, pace: undefined } }
    expect(() => parseMethod(JSON.parse(JSON.stringify(noPace)))).toThrow(
      /gate B1: no phrase group pace/,
    )
    const noSetup = {
      ...file,
      moves: file.moves.map((move) => ({ ...move, say: { name: move.say.name ?? [] } })),
    }
    expect(methodProblems(noSetup, CHECKLIST)).toContain('gate A2: no phrase group move:setup')
  })

  it('refuses a move without its own name phrases', () => {
    const nameless = { ...file, moves: [{ id: 'x', name: 'X', say: { setup: ['rail'] } }] }
    expect(practiceFileSchema.safeParse(nameless).success).toBe(false)
  })
})
