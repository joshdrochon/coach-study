import { describe, expect, it } from 'vitest'

import { parseChecklist, type Rule } from '../gates'

import { checkSay, countSaid, evaluate, type Transcript } from './engine'
import { typedWords, type Word } from './match'
import { findScene, METHOD, parseMethod, type Method } from './method'

// A tiny method made for these tests, so each rule kind is checked on its own.
const CHECKLIST = parseChecklist({
  name: 'Test method',
  goal: { inARow: 2, targetDate: '2030-01-01' },
  scenes: [
    { kind: 'one', title: 'One' },
    { kind: 'two', title: 'Two' },
  ],
  gates: [
    {
      id: 'N1',
      mustPass: true,
      name: 'Name',
      label: 'Say the name',
      appliesTo: ['one'],
      rule: { kind: 'say', scope: 'each-move', parts: ['move:name'], ordered: false },
    },
    {
      id: 'O1',
      mustPass: true,
      name: 'Order',
      label: 'Name, then spot, then count',
      appliesTo: ['one'],
      rule: {
        kind: 'say',
        scope: 'each-move',
        parts: ['move:name', 'move:spot', 'count'],
        ordered: true,
      },
    },
    {
      id: 'L1',
      mustPass: false,
      name: 'End',
      label: 'Close it',
      appliesTo: ['one'],
      rule: {
        kind: 'say',
        scope: 'last-move',
        parts: ['close'],
        ordered: false,
        window: { from: 'end', ms: 2000 },
      },
    },
    {
      id: 'Q1',
      mustPass: false,
      name: 'Quiet',
      label: 'No hedges',
      appliesTo: ['one'],
      rule: { kind: 'avoid', phrases: 'hedges' },
    },
    {
      id: 'Q2',
      mustPass: false,
      name: 'Cheers',
      label: 'Cheer twice',
      appliesTo: ['one'],
      rule: { kind: 'repeat', phrases: 'cheers', atLeast: 2 },
    },
    {
      id: 'U1',
      mustPass: false,
      name: 'Tutor',
      label: 'Warm tone',
      appliesTo: ['one'],
      rule: { kind: 'tutor', ask: 'Was it warm?' },
    },
    {
      id: 'W1',
      mustPass: true,
      name: 'Other scene',
      label: 'Only in scene two',
      appliesTo: ['two'],
      rule: { kind: 'say', scope: 'practice', parts: ['count'], ordered: false },
    },
  ],
})

const TEST: Method = parseMethod(
  {
    phrases: {
      count: ['slow count'],
      close: ['all done'],
      hedges: ['kind of'],
      cheers: ['nice', 'nice work'],
    },
    moves: [
      { id: 'alpha', name: 'Alpha', say: { name: ['alpha'], spot: ['front rail'] } },
      { id: 'beta', name: 'Beta', say: { name: ['beta'], spot: ['back step'] } },
    ],
    scenes: [
      { id: 'one-1', kind: 'one', sequence: 1, title: 'Alpha then Beta', moves: ['alpha', 'beta'] },
    ],
  },
  CHECKLIST,
)
const [SCENE] = TEST.scenes
if (!SCENE) throw new Error('no scene')

// Words one second apart; marks start each move at the given word.
function said(text: string, moveStarts: number[] = [0]): Transcript {
  const words: Word[] = typedWords(text).map((word, i) => ({ ...word, atMs: i * 1000 }))
  return {
    words,
    marks: moveStarts.map((i) => i * 1000),
    doneAtMs: words.length * 1000,
  }
}

const verdictOf = (t: Transcript, id: string) =>
  evaluate(TEST, SCENE, t).find((v) => v.gateId === id)

describe('the say rule', () => {
  const good = said(
    'alpha on the front rail slow count go beta on the back step slow count all done',
    [0, 8],
  )

  it('passes each move when every part is said in its own segment, and quotes the words', () => {
    const name = verdictOf(good, 'N1')
    expect(name).toMatchObject({ verdict: 'pass', by: 'code' })
    expect(name?.moves).toEqual([
      { moveId: 'alpha', name: 'Alpha', ok: true },
      { moveId: 'beta', name: 'Beta', ok: true },
    ])
    expect(verdictOf(good, 'O1')).toMatchObject({ verdict: 'pass' })
    expect(verdictOf(good, 'O1')?.quote).toContain('front rail')
  })

  it('misses a move whose part is said in another move’s segment', () => {
    // "beta" is said, but before the tap that starts Beta.
    const early = said('alpha front rail slow count beta back step slow count', [0, 8])
    const v = verdictOf(early, 'N1')
    expect(v?.verdict).toBe('miss')
    expect(v?.moves?.map((m) => m.ok)).toEqual([true, false])
    expect(v?.note).toBe('Beta: Not heard: name')
  })

  it('calls a part said before the one it must follow out of order', () => {
    const swapped = said('front rail alpha slow count beta back step slow count', [0, 5])
    const v = verdictOf(swapped, 'O1')
    expect(v?.verdict).toBe('miss')
    expect(v?.note).toBe('Alpha: Out of order: spot')
  })

  it('looks only inside the window: the close must come in the last two seconds', () => {
    expect(verdictOf(good, 'L1')?.verdict).toBe('pass')
    const tooEarly = said('alpha front rail slow count beta all done back step slow count', [0, 5])
    expect(verdictOf(tooEarly, 'L1')?.verdict).toBe('miss')
  })

  it('with `all`, needs every phrase of the group, not just one', () => {
    const rule: Extract<Rule, { kind: 'say' }> = {
      kind: 'say',
      scope: 'practice',
      parts: [{ group: 'move:spot', all: true }],
      ordered: false,
    }
    const [move] = TEST.moves
    if (!move) throw new Error('no move')
    const both = { ...move, say: { ...move.say, spot: ['front rail', 'sliding deck'] } }
    expect(checkSay(TEST, rule, said('front rail').words, both).missing).toEqual(['sliding deck'])
    expect(checkSay(TEST, rule, said('sliding deck and front rails').words, both).ok).toBe(true)
  })
})

describe('the other rule kinds', () => {
  it('avoid misses on the first hedge and quotes it', () => {
    const v = verdictOf(said('alpha is kind of hard beta'), 'Q1')
    expect(v).toMatchObject({ verdict: 'miss', quote: 'kind of', note: 'Said "kind of"' })
    expect(verdictOf(said('alpha beta'), 'Q1')?.verdict).toBe('pass')
  })

  it('repeat counts each place a phrase is said, once per spot, against its minimum', () => {
    const once = said('alpha nice work beta')
    expect(countSaid(once.words, ['nice', 'nice work'])).toHaveLength(1)
    expect(verdictOf(once, 'Q2')).toMatchObject({ verdict: 'miss', note: 'Said 1 of 2 times' })
    const twice = said('alpha nice beta nice work')
    expect(verdictOf(twice, 'Q2')).toMatchObject({ verdict: 'pass', quote: 'nice' })
  })

  it('leaves tutor checks unjudged, and checks for other scenes not applicable', () => {
    const t = said('alpha beta')
    expect(verdictOf(t, 'U1')).toMatchObject({
      verdict: 'unjudged',
      by: 'tutor',
      note: 'Was it warm?',
    })
    expect(verdictOf(t, 'W1')).toMatchObject({ verdict: 'not-applicable' })
  })
})

describe('the shipped sample method', () => {
  it('passes a well coached warm-up and misses a bare one', () => {
    const scene = findScene(METHOD, 'warm-up-1')
    if (!scene) throw new Error('no scene')
    const coached = said(
      'sample move a hands on the front rail feet on the sliding deck slow count of four ' +
        'sample move b stand on the back step facing the rail steady pace',
      [0, 17],
    )
    const verdicts = evaluate(METHOD, scene, coached)
    const byId = Object.fromEntries(verdicts.map((v) => [v.gateId, v.verdict]))
    expect(byId).toMatchObject({ A1: 'pass', A2: 'pass', B3: 'pass', C1: 'not-applicable' })
    const bare = evaluate(METHOD, scene, said('go go go now', [0, 2]))
    expect(bare.filter((v) => v.verdict === 'miss').map((v) => v.gateId)).toEqual([
      'A2',
      'A1',
      'C2',
    ])
  })
})
