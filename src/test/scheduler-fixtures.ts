import { Rating, State, type Grade } from 'ts-fsrs'

import { addDays, addMinutes } from '@/lib/scheduler/calendar'
import { createScheduler, newCard, resultOf, type NewCardInput } from '@/lib/scheduler/fsrs'
import type {
  Correctness,
  ItemType,
  PresentationFormat,
  ReviewContext,
  ReviewLog,
  SchedulerCard,
} from '@/lib/scheduler/types'

export const T0 = new Date('2026-08-17T16:00:00.000Z')

export const fixed = createScheduler({ enableFuzz: false })

let nextPosition = 0

export function makeCard(
  itemId: string,
  options: Partial<Omit<NewCardInput, 'itemId'>> = {},
  now: Date = T0,
): SchedulerCard {
  nextPosition += 1
  return newCard(
    {
      itemId,
      category: options.category ?? 'Floor work',
      itemType: options.itemType ?? 'recall',
      position: options.position ?? nextPosition,
      topic: options.topic ?? null,
      hasChoices: options.hasChoices ?? false,
      quarantined: options.quarantined ?? false,
    },
    now,
  )
}

export function graduated(
  card: SchedulerCard,
  at: Date,
): { card: SchedulerCard; logs: ReviewLog[] } {
  const first = fixed.review(card, Rating.Good, at)
  const second = fixed.review(first.card, Rating.Good, addMinutes(at, 10))
  return { card: second.card, logs: [first.log, second.log] }
}

export function dueReview(
  itemId: string,
  options: Partial<Omit<NewCardInput, 'itemId'>> = {},
  now: Date = T0,
): SchedulerCard {
  return graduated(makeCard(itemId, options, addDays(now, -4)), addDays(now, -3)).card
}

export function notDueReview(
  itemId: string,
  options: Partial<Omit<NewCardInput, 'itemId'>> = {},
  now: Date = T0,
): SchedulerCard {
  const yesterday = addMinutes(addDays(now, -1), -60)
  return graduated(makeCard(itemId, options, yesterday), yesterday).card
}

export function reviewedAt(
  itemId: string,
  lastReview: Date,
  days: number,
  options: Partial<Omit<NewCardInput, 'itemId'>> = {},
): SchedulerCard {
  const start = addDays(lastReview, -3)
  const card = graduated(makeCard(itemId, options, start), start).card
  return {
    ...card,
    fsrs: { ...card.fsrs, last_review: lastReview, due: addDays(lastReview, days) },
  }
}

export function fakeLog(
  itemId: string,
  rating: Grade,
  at: Date,
  options: {
    state?: State
    context?: ReviewContext
    result?: Correctness
    helped?: boolean
    format?: PresentationFormat
  } = {},
): ReviewLog {
  return {
    itemId,
    context: options.context ?? 'study',
    proposed: null,
    result: options.result ?? resultOf(rating),
    graded: options.result ?? resultOf(rating),
    helped: options.helped ?? false,
    format: options.format ?? 'free',
    fsrs: {
      rating,
      state: options.state ?? State.Review,
      due: at,
      stability: 3,
      difficulty: 5,
      elapsed_days: 1,
      last_elapsed_days: 1,
      scheduled_days: 2,
      learning_steps: 0,
      review: at,
    },
  }
}

export function windowOf(correct: number, total: number, end: Date): ReviewLog[] {
  return Array.from({ length: total }, (_, i) =>
    fakeLog(
      `past-${String(i)}`,
      i < total - correct ? Rating.Again : Rating.Good,
      addMinutes(end, i - total - 1),
    ),
  )
}

export const TYPES: readonly ItemType[] = ['recall', 'list', 'cue', 'scenario', 'audit']
