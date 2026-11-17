import { describe, expect, it } from 'vitest'

import { headline, shownChecks } from '@/components/practice/FeedbackView'

import { fetchScene, sendPractice, typedRequest, voiceRequest } from './client'
import { practiceRequestSchema, type PracticeReport, type SceneView } from './contract'

const scene: SceneView = {
  id: 'warm-up-1',
  kind: 'warm-up',
  title: 'Warm-up',
  moves: [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
  ],
  checks: [],
}

describe('building the practice request', () => {
  it('sends the words and taps as heard, rounded, with done at the latest time', () => {
    const request = voiceRequest(
      scene,
      [
        { text: 'go', atMs: 120.6 },
        { text: ' ', atMs: 900 },
      ],
      [0, 500.4],
      400,
    )
    expect(request).toEqual({
      sceneId: 'warm-up-1',
      entry: 'voice',
      words: [{ text: 'go', atMs: 121 }],
      marks: [0, 500],
      doneAtMs: 900,
    })
    expect(practiceRequestSchema.safeParse(request).success).toBe(true)
  })

  it('fills a mark the learner never tapped with done, so every move has one', () => {
    expect(voiceRequest(scene, [], [0], 3000).marks).toEqual([0, 3000])
  })

  it('lays typed moves end to end with even timings', () => {
    const request = typedRequest(scene, ['one two', 'three'])
    expect(request.words.map((w) => w.atMs)).toEqual([0, 400, 800])
    expect(request.marks).toEqual([0, 800])
    expect(request.doneAtMs).toBe(1200)
    expect(practiceRequestSchema.safeParse(request).success).toBe(true)
  })

  it('refuses taps that go back in time or come after done', () => {
    const base = typedRequest(scene, ['one', 'two'])
    expect(practiceRequestSchema.safeParse({ ...base, marks: [400, 0] }).success).toBe(false)
    expect(practiceRequestSchema.safeParse({ ...base, marks: [0, 9999] }).success).toBe(false)
  })
})

describe('the fetch helpers', () => {
  it('asks for a given scene and refuses a failed answer', async () => {
    const asked: string[] = []
    const ok = (input: string) => {
      asked.push(input)
      return Promise.resolve(Response.json(scene))
    }
    await expect(fetchScene(ok, 'warm-up-1')).resolves.toEqual(scene)
    expect(asked).toEqual(['/api/practice/scene?id=warm-up-1'])
    const down = () => Promise.resolve(new Response('', { status: 503 }))
    await expect(sendPractice(typedRequest(scene, ['a', 'b']), down)).rejects.toThrow(
      'practice: 503',
    )
  })
})

describe('the feedback screen', () => {
  const check = (
    gateId: string,
    verdict: PracticeReport['checks'][number]['verdict'],
    mustPass: boolean,
  ) => ({
    gateId,
    label: gateId,
    mustPass,
    verdict,
    by: 'code' as const,
    quote: null,
    note: '',
  })
  const report: PracticeReport = {
    practiceId: 'p',
    sceneId: 's',
    checks: [
      check('X', 'pass', false),
      check('Y', 'not-applicable', true),
      check('Z', 'miss', true),
    ],
    mustPass: { passed: 1, of: 2 },
    allMustPass: false,
    feedback: { wentWell: '', toWorkOn: '', by: 'code' },
    tutor: 'unavailable',
  }

  it('counts the must-dos, and lists must-dos first without the ones that do not apply', () => {
    expect(headline(report)).toBe('1 of 2 must-dos done.')
    expect(headline({ ...report, allMustPass: true, mustPass: { passed: 2, of: 2 } })).toBe(
      'All 2 must-dos done.',
    )
    expect(shownChecks(report).map((c) => c.gateId)).toEqual(['Z', 'X'])
  })
})
