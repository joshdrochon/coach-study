// Turns an answer into a proposed FSRS rating. Help (a hint or a multiple-choice
// format) caps the rating, and answer time separates Hard, Good and Easy.

import { Rating, type Grade } from 'ts-fsrs'

import { defaultScheduler, type ReviewOptions, type Scheduler } from './fsrs'
import {
  ratingInputSchema,
  type ItemType,
  type RatingInput,
  type ReviewResult,
  type SchedulerCard,
} from './types'

export const FAST_ANSWER_MS = {
  recall: 4_000,
  list: 8_000,
  cue: 12_000,
  scenario: 20_000,
  audit: 20_000,
} as const satisfies Record<ItemType, number>

export const SLOW_ANSWER_MS = {
  recall: 15_000,
  list: 30_000,
  cue: 40_000,
  scenario: 60_000,
  audit: 60_000,
} as const satisfies Record<ItemType, number>

export function proposeRating(input: RatingInput): Grade {
  const answer = ratingInputSchema.parse(input)
  if (answer.correct === 'wrong') return Rating.Again
  const helped = (answer.hintUsed && !answer.hintImposed) || answer.format === 'choices'
  if (answer.correct === 'partial') return helped ? Rating.Again : Rating.Hard
  if (helped) return Rating.Hard
  if (answer.answerMs >= SLOW_ANSWER_MS[answer.itemType]) return Rating.Hard
  if (answer.answerMs <= FAST_ANSWER_MS[answer.itemType]) return Rating.Easy
  return Rating.Good
}

export function reviewAnswer(
  card: SchedulerCard,
  answer: RatingInput,
  now: Date,
  scheduler: Scheduler = defaultScheduler,
  options: Pick<ReviewOptions, 'context'> = {},
): ReviewResult {
  const parsed = ratingInputSchema.parse(answer)
  const proposed = proposeRating(parsed)
  return scheduler.review(card, proposed, now, {
    ...options,
    proposed,
    result: parsed.correct,
    helped: parsed.hintUsed || parsed.hintImposed || parsed.format === 'choices',
    format: parsed.format,
  })
}

export type OverrideResult = ReviewResult & { overridden: boolean }

export function applyOverride(
  result: ReviewResult,
  chosen: Grade,
  scheduler: Scheduler = defaultScheduler,
): OverrideResult {
  const changed =
    chosen === result.log.fsrs.rating
      ? result
      : scheduler.changeRating(result.card, result.log, chosen)
  const { proposed } = result.log
  return { ...changed, overridden: proposed !== null && chosen !== proposed }
}
