// The baseline check: a fixed sample of cards asked on day 1 and repeated before
// each milestone, used to measure progress and to place known cards further out.

import { Rating } from 'ts-fsrs'
import { z } from 'zod'

import { SCHEDULE } from '../schedule'

import { dayKey, shiftDayKey, TIME_ZONE } from './calendar'
import { defaultScheduler, isNew, type Scheduler } from './fsrs'
import { proposeRating, reviewAnswer } from './rating'
import { compareText, seededOrder } from './seeded'
import {
  correctnessSchema,
  dateSchema,
  ratingInputSchema,
  type ItemType,
  type RatingInput,
  type ReviewLog,
  type SchedulerCard,
} from './types'

export const BASELINE_ITEMS = 60

export const BASELINE_INCLUDES_MIC_PRACTICE = true

export const BASELINE_ROUNDS = ['day-1', 'before-practice-day', 'before-first-class'] as const
export const baselineRoundSchema = z.enum(BASELINE_ROUNDS)
export type BaselineRound = z.infer<typeof baselineRoundSchema>

export const BASELINE_REPEATS = [
  { round: 'before-practice-day', before: SCHEDULE.practiceDay },
  { round: 'before-first-class', before: SCHEDULE.firstClass },
] as const satisfies readonly { round: BaselineRound; before: string }[]

export const BASELINE_REPEAT_WINDOW_DAYS = 2

export const baselineRunSchema = z.object({ round: baselineRoundSchema, completedAt: dateSchema })
export type BaselineRun = z.infer<typeof baselineRunSchema>

export type BaselinePlan = { itemIds: string[]; includesMicPractice: boolean }

export const baselineAnswerSchema = z.object({
  round: baselineRoundSchema,
  itemId: z.string().min(1),
  category: z.string().min(1),
  context: z.literal('baseline'),
  result: correctnessSchema,
  helped: z.boolean(),
  answerMs: z.number().nonnegative(),
  at: dateSchema,
})
export type BaselineAnswer = z.infer<typeof baselineAnswerSchema>

// Round-robin across categories (in seeded order) so a small category is fully
// included and large ones share the rest evenly.
export function pickBaselineItems(
  cards: readonly SchedulerCard[],
  seed: string,
  count: number = BASELINE_ITEMS,
): BaselinePlan {
  const byCategory = groupBy(
    cards.filter((card) => !card.quarantined),
    (card) => card.category,
  )
  const lanes = seededOrder([...byCategory.entries()], ([category]) => category, seed).map(
    ([, items]) => spreadByType(items, seed),
  )
  const itemIds: string[] = []
  for (let turn = 0; itemIds.length < count; turn += 1) {
    const picks = lanes.flatMap((lane) => lane.slice(turn, turn + 1))
    if (picks.length === 0) break
    itemIds.push(...picks.slice(0, count - itemIds.length).map((card) => card.itemId))
  }
  return { itemIds, includesMicPractice: BASELINE_INCLUDES_MIC_PRACTICE }
}

function spreadByType(items: readonly SchedulerCard[], seed: string): SchedulerCard[] {
  const shuffled = seededOrder(items, (card) => card.itemId, seed)
  const byType = groupBy(shuffled, (card): ItemType => card.itemType)
  const lanes = seededOrder([...byType.entries()], ([type]) => type, seed).map(([, lane]) => lane)
  const spread: SchedulerCard[] = []
  for (let turn = 0; spread.length < items.length; turn += 1) {
    spread.push(...lanes.flatMap((lane) => lane.slice(turn, turn + 1)))
  }
  return spread
}

function groupBy<K, T>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>()
  for (const item of items) {
    const group = groups.get(key(item))
    if (group) group.push(item)
    else groups.set(key(item), [item])
  }
  return groups
}

export type BaselinePlacement = {
  card: SchedulerCard

  log: ReviewLog | null
  placed: boolean

  answer: BaselineAnswer
}

// A new card answered right in the baseline starts with a longer interval instead
// of the normal learning steps; a card already in review is just reviewed.
export function placeFromBaseline(
  card: SchedulerCard,
  input: RatingInput,
  now: Date,
  round: BaselineRound,
  scheduler: Scheduler = defaultScheduler,
): BaselinePlacement {
  const parsed = ratingInputSchema.parse(input)
  const answer: BaselineAnswer = {
    round,
    itemId: card.itemId,
    category: card.category,
    context: 'baseline',
    result: parsed.correct,
    helped: parsed.hintUsed || parsed.hintImposed || parsed.format === 'choices',
    answerMs: parsed.answerMs,
    at: new Date(now.getTime()),
  }
  if (!isNew(card)) {
    return {
      ...reviewAnswer(card, parsed, now, scheduler, { context: 'baseline' }),
      placed: false,
      answer,
    }
  }
  const proposed = proposeRating(parsed)
  if (!answer.helped && (proposed === Rating.Good || proposed === Rating.Easy)) {
    const placement = scheduler.review(card, Rating.Easy, now, {
      context: 'baseline',
      proposed: null,
      result: 'right',
      helped: false,
      format: parsed.format,
    })
    return { ...placement, placed: true, answer }
  }
  return { card, log: null, placed: false, answer }
}

export type BaselineScore = { category: string; answered: number; right: number; share: number }

export function baselineScores(
  answers: readonly BaselineAnswer[],
  round: BaselineRound,
): BaselineScore[] {
  const byCategory = groupBy(
    answers.filter((answer) => answer.round === round),
    (answer) => answer.category,
  )
  return [...byCategory.entries()]
    .map(([category, list]) => {
      const right = list.filter((answer) => answer.result === 'right').length
      return { category, answered: list.length, right, share: right / list.length }
    })
    .toSorted((a, b) => a.share - b.share || compareText(a.category, b.category))
}

export type BaselineStatus =
  | { due: true; round: BaselineRound }
  | { due: false; next: { round: BaselineRound; opensOn: string } | null }

export function baselineDue(
  runs: readonly BaselineRun[],
  now: Date,
  timeZone: string = TIME_ZONE,
): BaselineStatus {
  const today = dayKey(now, timeZone)
  const done = new Set(runs.map((run) => run.round))
  if (!done.has('day-1')) return { due: true, round: 'day-1' }
  const ranToday = runs.some((run) => dayKey(run.completedAt, timeZone) === today)
  for (const repeat of BASELINE_REPEATS) {
    if (done.has(repeat.round) || today >= repeat.before) continue
    const opensOn = shiftDayKey(repeat.before, -BASELINE_REPEAT_WINDOW_DAYS)
    if (today < opensOn) return { due: false, next: { round: repeat.round, opensOn } }
    if (!ranToday) return { due: true, round: repeat.round }
    const tomorrow = shiftDayKey(today, 1)
    if (tomorrow < repeat.before) {
      return { due: false, next: { round: repeat.round, opensOn: tomorrow } }
    }
  }
  return { due: false, next: null }
}
