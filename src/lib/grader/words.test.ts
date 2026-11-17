import { describe, expect, it } from 'vitest'

import { cardSystemPrompt } from './card'
import {
  HEADING_WORDS,
  isRevealWord,
  RESULT_ORDER,
  RESULT_WORDS,
  revealLine,
  spokenLine,
  stripOpener,
} from './words'

describe('the result words', () => {
  it('are Got it, Almost and Not quite, in that order', () => {
    expect(RESULT_ORDER.map((result) => RESULT_WORDS[result])).toEqual([
      'Got it',
      'Almost',
      'Not quite',
    ])
  })

  it('the app says the word, then the grader’s fix', () => {
    expect(spokenLine('right', '')).toBe('Got it.')
    expect(spokenLine('partial', 'Add rollers.')).toBe('Almost. Add rollers.')
    expect(spokenLine('wrong', '  A mat. ')).toBe('Not quite. A mat.')
  })

  it('never says a word twice when the model wrote one anyway', () => {
    expect(stripOpener('Almost. Add rollers.')).toBe('Add rollers.')
    expect(stripOpener('not quite, a mat')).toBe('a mat')
    expect(stripOpener('Got it!')).toBe('')
    expect(stripOpener('Got it')).toBe('')
    expect(stripOpener('Almost there. Add the rollers.')).toBe('Add the rollers.')

    expect(stripOpener('Almost everyone forgets the rollers.')).toBe(
      'Almost everyone forgets the rollers.',
    )
    expect(stripOpener('Not quite the same bands.')).toBe('Not quite the same bands.')
    expect(spokenLine('partial', 'Almost. Add rollers.')).toBe('Almost. Add rollers.')
  })

  it('a revealed answer has its own heading and line', () => {
    expect(HEADING_WORDS.okay).toBe('That’s okay')
    expect(HEADING_WORDS.shown).toBe('Here’s the answer')
    expect(isRevealWord('okay') && isRevealWord('shown')).toBe(true)
    expect(RESULT_ORDER.some((word) => isRevealWord(word))).toBe(false)
    expect(revealLine('okay', 'A mat.')).toBe(
      'That’s okay. The answer is: A mat. We’ll come back to this one soon.',
    )
    expect(revealLine('okay', '"Nice work everyone."')).toBe(
      'That’s okay. The answer is: "Nice work everyone." We’ll come back to this one soon.',
    )

    expect(revealLine('okay', 'A mat')).toBe(
      'That’s okay. The answer is: A mat. We’ll come back to this one soon.',
    )
    expect(revealLine('shown', 'A mat.')).toBe('Here’s the answer. A mat.')

    for (const line of [revealLine('okay', 'A.'), revealLine('shown', 'A.')]) {
      expect(line).not.toMatch(/[—;]|skipped/i)
    }
  })

  it('the grader is told to write only the fix', () => {
    const prompt = cardSystemPrompt()
    expect(prompt).toContain('fix is at most one short sentence')
    expect(prompt).toContain('Never start it with a result word')
    expect(prompt).not.toContain('The spoken line starts with the result')
  })
})
