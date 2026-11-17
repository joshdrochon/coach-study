// Keeps recent accuracy inside a target band by adjusting new-card pace and card
// formats, judged over a sliding window of recent answers.

import { compareText } from './seeded'
import type { Correctness, ItemType, ReviewLog } from './types'

export const WINDOW_SIZE = 25
export const BAND_HIGH = 0.9
export const BAND_LOW = 0.8

export const EASIER_FORMATS: readonly ItemType[] = ['recall', 'list']
export const HARDER_FORMATS: readonly ItemType[] = ['cue', 'scenario', 'audit']

export type Band = 'warming-up' | 'below' | 'within' | 'above'

export type NewCardPace = 'more' | 'steady' | 'none'

export type DifficultyDecision = {
  band: Band
  answers: number
  correct: number

  accuracy: number | null
  newCards: NewCardPace
  promoteFormats: boolean
  hintFirst: boolean
  easierFormats: boolean
}

export function isCorrect(result: Correctness): boolean {
  return result === 'right'
}

const percent = (share: number): number => Math.round(share * 100)

export const MAX_MISSES = WINDOW_SIZE - Math.ceil((WINDOW_SIZE * percent(BAND_LOW)) / 100)

const steady = {
  newCards: 'steady',
  promoteFormats: false,
  hintFirst: false,
  easierFormats: false,
} as const

// Too many misses in the window pauses new cards before the window is even full.
export function decideDifficulty(results: readonly Correctness[]): DifficultyDecision {
  const window = results.slice(-WINDOW_SIZE)
  const answers = window.length
  const correct = window.filter(isCorrect).length
  const base = { answers, correct, accuracy: answers === 0 ? null : correct / answers }
  if (answers - correct > MAX_MISSES) {
    return {
      ...base,
      band: 'below',
      newCards: 'none',
      promoteFormats: false,
      hintFirst: true,
      easierFormats: true,
    }
  }
  if (answers < WINDOW_SIZE) return { ...base, band: 'warming-up', ...steady }
  if (correct * 100 > answers * percent(BAND_HIGH)) {
    return {
      ...base,
      band: 'above',
      newCards: 'more',
      promoteFormats: true,
      hintFirst: false,
      easierFormats: false,
    }
  }
  return { ...base, band: 'within', ...steady }
}

export function byReviewTime(a: ReviewLog, b: ReviewLog): number {
  return a.fsrs.review.getTime() - b.fsrs.review.getTime() || compareText(a.itemId, b.itemId)
}

export function isStudy(log: ReviewLog): boolean {
  return log.context === 'study'
}

export function studyResults(history: readonly ReviewLog[]): Correctness[] {
  return history
    .filter(isStudy)
    .toSorted(byReviewTime)
    .map((log) => log.result)
}
