import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { openTestDb, type Db } from '../db/client'
import { gateResults, practices } from '../db/schema'
import { MODELS } from '../grader/models'
import { TutorError } from '../tutor/errors'

import type { PracticeRequest } from './contract'
import { codeFeedback, gradePractice, nextScene, sceneView, type AskTutor } from './grade'
import { typedWords } from './match'
import { findScene, METHOD, type PracticeScene } from './method'

const usage = { input_tokens: 900, output_tokens: 80 }

function scene(id: string): PracticeScene {
  const found = findScene(METHOD, id)
  if (!found) throw new Error(`no scene ${id}`)
  return found
}

const MAIN = scene('main-set-1')

const coached =
  'sample move c on the low step hands wide slow count of four great work everyone ' +
  'sample move d one foot forward hold the rail steady pace take a break if you need it'

function request(text = coached): PracticeRequest {
  const words = typedWords(text)
  const split = words.findIndex((word) => word.text === 'd') - 2
  return {
    sceneId: MAIN.id,
    entry: 'typed',
    words,
    marks: [0, words[split]?.atMs ?? 0],
    doneAtMs: (words.at(-1)?.atMs ?? 0) + 400,
  }
}

const tutorSays =
  (checks: { gateId: string; verdict: 'pass' | 'miss'; quote: string | null }[]): AskTutor =>
  () =>
    Promise.resolve({
      value: {
        checks,
        wentWell: 'Clear setup on both moves.',
        toWorkOn: 'Keep the pace cue steady — always.',
      },
      model: MODELS.sonnet,
      usage,
    })

describe('gradePractice', () => {
  let db: Db
  beforeEach(async () => {
    db = await openTestDb()
  })

  it('grades by code, lets the tutor judge only its checks, and stores the practice', async () => {
    const ask = vi.fn(tutorSays([{ gateId: 'D1', verdict: 'pass', quote: 'great work everyone' }]))
    const report = await gradePractice({ db, method: METHOD, scene: MAIN, request: request(), ask })
    const byId = Object.fromEntries(report.checks.map((c) => [c.gateId, c]))
    expect(byId.A1?.verdict).toBe('pass')
    expect(byId.B1?.verdict).toBe('pass')
    expect(byId.D1).toMatchObject({ verdict: 'pass', by: 'tutor', quote: 'great work everyone' })
    expect(byId.C1?.verdict).toBe('not-applicable')
    expect(report).toMatchObject({ allMustPass: true, tutor: 'ok', mustPass: { passed: 3, of: 3 } })
    // The tutor's dash and semicolon style is cleaned up before the learner sees it.
    expect(report.feedback).toEqual({
      wentWell: 'Clear setup on both moves.',
      toWorkOn: 'Keep the pace cue steady, always.',
      by: 'tutor',
    })
    expect(ask).toHaveBeenCalledOnce()

    const [row] = await db.select().from(practices).where(eq(practices.id, report.practiceId))
    expect(row).toMatchObject({ sceneKind: 'main-set', passed: true, gradedBy: 'tutor' })
    expect(row?.scene).toEqual({ sceneId: 'main-set-1', sequence: 2 })
    const results = await db
      .select()
      .from(gateResults)
      .where(eq(gateResults.practiceId, report.practiceId))
    expect(results).toHaveLength(METHOD.checklist.gates.length)
  })

  it('never takes a tutor pass without a quote of their words', async () => {
    const ask = tutorSays([
      { gateId: 'D1', verdict: 'pass', quote: 'words the learner never said' },
    ])
    const report = await gradePractice({ db, method: METHOD, scene: MAIN, request: request(), ask })
    const d1 = report.checks.find((c) => c.gateId === 'D1')
    expect(d1).toMatchObject({ verdict: 'unjudged', note: 'The tutor gave no quote of your words' })
    const stored = await db
      .select()
      .from(gateResults)
      .where(eq(gateResults.practiceId, report.practiceId))
    expect(stored.map((r) => r.gateId)).not.toContain('D1')
  })

  it('still grades and stores the practice when the tutor is unavailable', async () => {
    const ask: AskTutor = () => Promise.reject(new TutorError('misconfigured', 'no key', 'nothing'))
    const bare = request('sample move c go sample move d go')
    const report = await gradePractice({ db, method: METHOD, scene: MAIN, request: bare, ask })
    expect(report.tutor).toBe('unavailable')
    expect(report.allMustPass).toBe(false)
    expect(report.feedback.by).toBe('code')
    expect(report.feedback.toWorkOn).toBe('Give one pace cue while the move runs.')
    const [row] = await db.select().from(practices).where(eq(practices.id, report.practiceId))
    expect(row).toMatchObject({ passed: false, gradedBy: null, traceId: null })
  })

  it('rotates scenes: the least practiced comes next', async () => {
    const ask: AskTutor = () => Promise.reject(new TutorError('misconfigured', 'no key', 'nothing'))
    expect((await nextScene(db, METHOD)).id).toBe('warm-up-1')
    const warm = scene('warm-up-1')
    await gradePractice({
      db,
      method: METHOD,
      scene: warm,
      request: { ...request(), sceneId: warm.id },
      ask,
    })
    expect((await nextScene(db, METHOD)).id).toBe('main-set-1')
  })
})

describe('the scene view and code feedback', () => {
  it('lists the scene’s moves and only the checks that apply to it', () => {
    const view = sceneView(METHOD, MAIN)
    expect(view.moves.map((m) => m.name)).toEqual(['Sample Move C', 'Sample Move D'])
    expect(view.checks.map((c) => c.gateId)).not.toContain('C1')
  })

  it('names the first pass and the first must-pass miss', () => {
    const check = (gateId: string, verdict: 'pass' | 'miss', mustPass: boolean) => ({
      gateId,
      label: `Label ${gateId}`,
      mustPass,
      verdict,
      by: 'code' as const,
      quote: null,
      note: '',
    })
    expect(
      codeFeedback([
        check('B3', 'miss', false),
        check('A1', 'pass', true),
        check('A2', 'miss', true),
      ]),
    ).toEqual({
      wentWell: 'Label A1: done.',
      toWorkOn: 'Label A2.',
      by: 'code',
    })
  })
})
