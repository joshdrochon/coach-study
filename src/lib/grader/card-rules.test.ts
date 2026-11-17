import { describe, expect, it } from 'vitest'

import { loadBank } from '../content/bank'
import type { Item } from '../content/schema'

import {
  alsoListedKept,
  alsoListedLine,
  cardSystemPrompt,
  codeGrade,
  openList,
  type CardOutput,
} from './card'

const bank = loadBank()

const card = (over: Partial<Item>): Item => ({
  id: 'test-card',
  category: 'Basics',
  type: 'recall',
  prompt: 'Can you plan Sample Move B before Sample Move A?',
  answer: 'No.',
  explanation: 'A tired leg makes the next move unstable.',
  citations: [
    { passageId: 'm003-welcome-goal', quote: 'Every session should feel calm, clear and safe.' },
  ],
  ...over,
})

const output = (over: Partial<CardOutput>): CardOutput => ({
  corrections: [],
  result: 'right',
  missing: [],
  inOrder: null,
  fix: '',
  followUp: null,
  alsoListed: null,
  ...over,
})

describe('codeGrade matches whole words', () => {
  const no = card({})
  const yes = card({ answer: 'Yes.' })

  it('never passes a "No." key on letters inside other words', () => {
    expect(codeGrade(no, "I don't know")).toBeNull()
    expect(codeGrade(no, 'not sure')).toBeNull()
    expect(codeGrade(no, 'I know you can')).toBeNull()
  })

  it('still passes the key said as a word', () => {
    expect(codeGrade(no, 'No.')).toMatchObject({ result: 'right' })
    expect(codeGrade(no, 'no')).toMatchObject({ result: 'right' })
  })

  it('leaves a yes or negation word the key doesn’t have to the model', () => {
    expect(codeGrade(no, 'not no')).toBeNull()
    expect(codeGrade(no, 'yes, no')).toBeNull()
    expect(codeGrade(yes, 'yes, not really')).toBeNull()
    expect(codeGrade(yes, 'no, yes')).toBeNull()
    expect(codeGrade(yes, 'yes')).toMatchObject({ result: 'right' })
  })

  it('matches a part as whole words and keeps order on an ordered list', () => {
    const ordered = card({
      type: 'list',
      prompt: 'RSG, in order?',
      answer: 'Ready, steady, go.',
      parts: ['Ready', 'Steady', 'Go'],
      ordered: true,
    })
    expect(codeGrade(ordered, 'ready steady go')).toMatchObject({
      result: 'right',
      inOrder: true,
    })

    expect(codeGrade(ordered, 'ready unsteady go')).toBeNull()
    expect(codeGrade(ordered, 'steady ready go')).toBeNull()
  })
})

describe('openList', () => {
  const item = (id: string) => {
    const found = bank.byId.get(id)
    if (!found) throw new Error(`no card ${id}`)
    return found
  }

  it('leaves a complete list closed, even with an "e.g." inside its quote', () => {
    expect(openList(item('session-phases'))).toBe(false)
    expect(openList(item('voice-order'))).toBe(false)
    expect(openList(item('band-colors'))).toBe(false)
  })
})

describe('the grader’s bar', () => {
  it('needs only what the card wants, and decides by the rules alone', () => {
    const prompt = cardSystemPrompt()
    expect(prompt).toContain("Required = what the CARD's question wants")
    expect(prompt).toContain('never required, and leaving it out never makes their answer partial')
    expect(prompt).toContain('so the same answer always gets the same result')
  })
})

describe('alsoListedKept', () => {
  const mats = card({
    category: 'Gear',
    prompt: 'What does Sample Move C use under the hands?',
    answer: 'A big mat or two small mats.',
  })

  it('keeps the other alternative the card lists beside "or", for a right answer', () => {
    expect(alsoListedKept(mats, 'a big mat', output({ alsoListed: 'two small mats' }))).toBe(
      'two small mats',
    )
    expect(alsoListedKept(mats, 'two small mats', output({ alsoListed: 'A big mat.' }))).toBe(
      'A big mat',
    )
    expect(alsoListedLine('two small mats')).toBe(
      'The source names two small mats too. Either one works.',
    )
  })

  it('drops it on a partial or wrong result, when it was said, or when the card lacks it', () => {
    expect(
      alsoListedKept(mats, 'one mat', output({ result: 'wrong', alsoListed: 'two small mats' })),
    ).toBeNull()
    expect(
      alsoListedKept(mats, 'a big mat or two small mats', output({ alsoListed: 'two small mats' })),
    ).toBeNull()
    expect(alsoListedKept(mats, 'a big mat', output({ alsoListed: 'three small mats' }))).toBeNull()
    expect(alsoListedKept(mats, 'a big mat', output({ alsoListed: 'a big mat' }))).toBeNull()
    expect(alsoListedKept(mats, 'a big mat', output({ alsoListed: 'mats' }))).toBeNull()
    const noOr = card({ answer: 'The coach.' })
    expect(alsoListedKept(noOr, 'coach', output({ alsoListed: 'coach' }))).toBeNull()
  })

  it('asks for it in the grader’s rules', () => {
    const prompt = cardSystemPrompt()
    expect(prompt).toContain('naming any one of them makes that part right in full')
    expect(prompt).toContain('9. alsoListed')
  })
})
