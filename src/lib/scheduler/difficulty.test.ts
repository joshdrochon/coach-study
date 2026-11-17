import { Rating } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'

import { fakeLog, T0 } from '@/test/scheduler-fixtures'

import { addMinutes } from './calendar'
import { BAND_HIGH, BAND_LOW, decideDifficulty, MAX_MISSES, studyResults } from './difficulty'
import type { Correctness } from './types'

const results = (correct: number, total: number, miss: Correctness = 'wrong'): Correctness[] =>
  Array.from({ length: total }, (_, i) => (i < total - correct ? miss : 'right'))

describe('the window', () => {
  it('holds steady while the window fills, unless 80% is already out of reach', () => {
    expect(MAX_MISSES).toBe(5)
    expect(decideDifficulty([])).toMatchObject({
      band: 'warming-up',
      answers: 0,
      accuracy: null,
      newCards: 'steady',
    })
    const five = decideDifficulty(results(0, 5))
    expect(five).toMatchObject({ band: 'warming-up', newCards: 'steady', hintFirst: false })

    expect(decideDifficulty(results(0, 6))).toMatchObject({
      band: 'below',
      newCards: 'none',
      hintFirst: true,
      easierFormats: true,
    })
    expect(decideDifficulty(results(18, 24)).band).toBe('below')

    expect(decideDifficulty(results(24, 24)).band).toBe('warming-up')
    expect(decideDifficulty(results(2, 3)).accuracy).toBeCloseTo(2 / 3)
  })
})

describe('the 80-90% band', () => {
  it('uses 80% and 90% as its edges', () => {
    expect(BAND_LOW).toBe(0.8)
    expect(BAND_HIGH).toBe(0.9)
  })

  it('above 90%: adds more new cards and promotes harder formats', () => {
    for (const correct of [23, 24, 25]) {
      expect(decideDifficulty(results(correct, 25))).toMatchObject({
        band: 'above',
        newCards: 'more',
        promoteFormats: true,
        hintFirst: false,
        easierFormats: false,
      })
    }
  })

  it('between 80% and 90%: holds steady', () => {
    for (const correct of [20, 21, 22]) {
      expect(decideDifficulty(results(correct, 25))).toMatchObject({
        band: 'within',
        newCards: 'steady',
        promoteFormats: false,
        hintFirst: false,
        easierFormats: false,
      })
    }
  })

  it('below 80%: stops new cards, gives a hint first and uses easier formats', () => {
    for (const correct of [0, 10, 19]) {
      expect(decideDifficulty(results(correct, 25))).toMatchObject({
        band: 'below',
        newCards: 'none',
        promoteFormats: false,
        hintFirst: true,
        easierFormats: true,
      })
    }
  })

  it('treats exactly 80% as inside the band', () => {
    const decision = decideDifficulty(results(20, 25))
    expect(decision.accuracy).toBe(0.8)
    expect(decision.band).toBe('within')
  })
})

describe('studyResults', () => {
  it('keeps study answers only, oldest first', () => {
    const history = [
      fakeLog('c', Rating.Good, addMinutes(T0, 3)),
      fakeLog('a', Rating.Again, addMinutes(T0, 1)),
      fakeLog('base', Rating.Easy, addMinutes(T0, 2), { context: 'baseline' }),
      fakeLog('mic', Rating.Again, addMinutes(T0, 2), { context: 'mic-practice' }),
      fakeLog('b', Rating.Hard, addMinutes(T0, 1), { result: 'right', helped: true }),
    ]
    expect(studyResults(history)).toEqual(['wrong', 'right', 'right'])
  })

  it('keeps baseline answers out of the window, so day 1 still adds new cards', () => {
    const baseline = Array.from({ length: 60 }, (_, i) =>
      fakeLog(`base-${String(i)}`, Rating.Again, addMinutes(T0, i), { context: 'baseline' }),
    )
    expect(decideDifficulty(studyResults(baseline)).newCards).toBe('steady')
  })
})
