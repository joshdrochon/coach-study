// Thin wrapper around ts-fsrs: fixed retention target and learning steps, and the
// mapping between ratings, labels and right/partial/wrong.

import {
  createEmptyCard,
  forgetting_curve,
  fsrs,
  Rating,
  State,
  type Card,
  type FSRSParameters,
  type Grade,
  type ReviewLog as FsrsReviewLog,
  type StepUnit,
} from 'ts-fsrs'

import type {
  Correctness,
  FsrsCardState,
  PresentationFormat,
  ReviewContext,
  ReviewLog,
  ReviewResult,
  SchedulerCard,
} from './types'

const DAY_MS = 86_400_000

export const TARGET_RETENTION = 0.9

export const LEARNING_STEPS = ['1m', '10m'] as const satisfies readonly StepUnit[]
export const RELEARNING_STEPS = ['10m'] as const satisfies readonly StepUnit[]

export const RATING_LABELS = {
  [Rating.Again]: 'Missed it',
  [Rating.Hard]: 'Tough',
  [Rating.Good]: 'Got it',
  [Rating.Easy]: 'Easy',
} as const satisfies Record<Grade, string>
export type RatingLabel = (typeof RATING_LABELS)[Grade]

export const GRADES: readonly Grade[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]

export function ratingLabel(rating: Grade): RatingLabel {
  return RATING_LABELS[rating]
}

export function ratingFromLabel(label: string): Grade | null {
  return GRADES.find((grade) => RATING_LABELS[grade] === label) ?? null
}

export type SchedulerOptions = {
  enableFuzz?: boolean
}

export type ReviewOptions = {
  context?: ReviewContext

  proposed?: Grade | null

  result?: Correctness

  helped?: boolean

  format?: PresentationFormat
}

export function resultOf(rating: Grade): Correctness {
  return rating === Rating.Again ? 'wrong' : 'right'
}

export type Scheduler = {
  readonly parameters: Readonly<FSRSParameters>
  review(card: SchedulerCard, rating: Grade, now: Date, options?: ReviewOptions): ReviewResult
  changeRating(card: SchedulerCard, log: ReviewLog, rating: Grade): ReviewResult
  missedInPractice(card: SchedulerCard, now: Date): ReviewResult
  retrievability(card: SchedulerCard, at: Date): number
}

const cloneDate = (date: Date): Date => new Date(date.getTime())

function toFsrsCard(state: FsrsCardState): Card {
  return {
    ...state,
    due: cloneDate(state.due),
    last_review: state.last_review ? cloneDate(state.last_review) : undefined,
  }
}

function fromFsrsCard(card: Card): FsrsCardState {
  return {
    ...card,
    due: cloneDate(card.due),
    last_review: card.last_review ? cloneDate(card.last_review) : undefined,
  }
}

function fromFsrsLog(log: FsrsReviewLog, rating: Grade): ReviewLog['fsrs'] {
  return { ...log, rating, due: cloneDate(log.due), review: cloneDate(log.review) }
}

// Everything else in the app schedules through this object, so tests can swap in a
// scheduler without fuzz and get repeatable due dates.
export function createScheduler(options: SchedulerOptions = {}): Scheduler {
  const engine = fsrs({
    request_retention: TARGET_RETENTION,
    enable_fuzz: options.enableFuzz ?? true,
    enable_short_term: true,
    learning_steps: LEARNING_STEPS,
    relearning_steps: RELEARNING_STEPS,
  })

  const reviewCard = (
    card: SchedulerCard,
    rating: Grade,
    now: Date,
    reviewOptions: ReviewOptions = {},
  ): ReviewResult => {
    if (card.fsrs.last_review !== undefined && now < card.fsrs.last_review) {
      throw new Error(`${card.itemId}: answer at ${now.toISOString()} is before its last review`)
    }
    const next = engine.next(toFsrsCard(card.fsrs), cloneDate(now), rating)
    return {
      card: { ...card, fsrs: fromFsrsCard(next.card) },
      log: {
        itemId: card.itemId,
        context: reviewOptions.context ?? 'study',
        proposed: reviewOptions.proposed ?? null,
        result: reviewOptions.result ?? resultOf(rating),
        graded: reviewOptions.result ?? resultOf(rating),
        helped: reviewOptions.helped ?? false,
        format: reviewOptions.format ?? 'free',
        fsrs: fromFsrsLog(next.log, rating),
      },
    }
  }

  const changeRating = (card: SchedulerCard, log: ReviewLog, rating: Grade): ReviewResult => {
    const lastReview = card.fsrs.last_review?.getTime()
    if (log.itemId !== card.itemId || lastReview !== log.fsrs.review.getTime()) {
      throw new Error(`changeRating needs the log of the latest review of ${card.itemId}`)
    }
    const before = engine.rollback(toFsrsCard(card.fsrs), log.fsrs)
    const redo = engine.next(before, cloneDate(log.fsrs.review), rating)
    const result = rating === Rating.Hard && log.graded === 'partial' ? 'partial' : resultOf(rating)
    return {
      card: { ...card, fsrs: fromFsrsCard(redo.card) },
      log: { ...log, result, fsrs: fromFsrsLog(redo.log, rating) },
    }
  }

  return {
    parameters: Object.freeze({ ...engine.parameters }),
    review: reviewCard,
    changeRating,

    missedInPractice: (card, now) =>
      reviewCard(card, Rating.Again, now, {
        context: 'mic-practice',
        proposed: null,
        result: 'wrong',
        helped: false,
      }),

    retrievability: (card, at) => {
      const { last_review: lastReview, stability, state } = card.fsrs
      if (state === State.New || lastReview === undefined) return 0
      const elapsedDays = Math.max(0, (at.getTime() - lastReview.getTime()) / DAY_MS)
      return forgetting_curve(engine.parameters.w, elapsedDays, stability)
    },
  }
}

export const defaultScheduler: Scheduler = createScheduler()
export const review: Scheduler['review'] = (card, rating, now, options) =>
  defaultScheduler.review(card, rating, now, options)
export const retrievability: Scheduler['retrievability'] = (card, at) =>
  defaultScheduler.retrievability(card, at)

export type NewCardInput = {
  itemId: string
  category: string
  itemType: SchedulerCard['itemType']
  position: number
  topic?: string | null
  hasChoices?: boolean
  quarantined?: boolean
}

export function newCard(item: NewCardInput, now: Date): SchedulerCard {
  return {
    itemId: item.itemId,
    category: item.category,
    itemType: item.itemType,
    topic: item.topic ?? null,
    hasChoices: item.hasChoices ?? false,
    position: item.position,
    quarantined: item.quarantined ?? false,
    fsrs: fromFsrsCard(createEmptyCard(cloneDate(now))),
  }
}

export function dueAt(card: SchedulerCard): Date | null {
  return card.fsrs.state === State.New ? null : cloneDate(card.fsrs.due)
}

export function isNew(card: SchedulerCard): boolean {
  return card.fsrs.state === State.New
}

export function isLearning(card: SchedulerCard): boolean {
  return card.fsrs.state === State.Learning || card.fsrs.state === State.Relearning
}
