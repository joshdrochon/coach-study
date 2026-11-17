import type { Db } from '../db/client'
import { practices, reviewEvents } from '../db/schema'
import type { ProgressData } from '../progress/client'
import { addDays } from '../scheduler/calendar'
import { defaultScheduler, type Scheduler } from '../scheduler/fsrs'
import { MASTERY_HORIZON_DAYS, readinessByCategory } from '../scheduler/readiness'
import type { SchedulerCard } from '../scheduler/types'

import type { Deck } from './deck'
import { rightOnCards } from './flag-cases'
import { rightOnCardsLineEnabled } from './flags'
import { endOfEvaluationDay, nextEvaluationDay } from './home'
import { latestPractices, practiceLabel } from './practices'
import { PRACTICE_CLASSES, PRACTICE_SESSIONS, readProfile } from './profile'
import { loadStudyState } from './state'

export function readinessMoment(now: Date): Date {
  const day = nextEvaluationDay(now)
  return day === null ? addDays(now, MASTERY_HORIZON_DAYS) : endOfEvaluationDay(day)
}

export function readiness(
  cards: readonly SchedulerCard[],
  now: Date,
  scheduler: Scheduler = defaultScheduler,
): { category: string; recall: number }[] {
  return readinessByCategory(cards, readinessMoment(now), scheduler).map(
    ({ category, recall }) => ({ category, recall }),
  )
}

export async function hasStudied(db: Db): Promise<boolean> {
  const [answers, practiced] = await Promise.all([
    db.select({ id: reviewEvents.id }).from(reviewEvents).limit(1),
    db.select({ id: practices.id }).from(practices).limit(1),
  ])
  return answers.length > 0 || practiced.length > 0
}

export const PROGRESS_PRACTICES = 10

export async function progressView(
  db: Db,
  deck: Deck,
  now: Date,
  scheduler: Scheduler = defaultScheduler,
  withRightOnCards: boolean = rightOnCardsLineEnabled(),
): Promise<ProgressData> {
  const [state, me, latest, studied, right] = await Promise.all([
    loadStudyState(db, deck, now, scheduler),
    readProfile(db),
    latestPractices(db, PROGRESS_PRACTICES),
    hasStudied(db),
    withRightOnCards ? rightOnCards(db) : undefined,
  ])
  return {
    ...(right === undefined ? {} : { rightOnCards: right }),
    name: 'Coach Alex',
    title: me.title,
    avatarUrl: me.avatarUrl,
    practiceSessions: { done: me.practiceSessionsDone, of: PRACTICE_SESSIONS },
    practiceClasses: { done: me.practiceClassesDone, of: PRACTICE_CLASSES },
    readiness: readiness(state.cards, now, scheduler).map(({ category, recall }) => ({
      category,
      ready: recall,
    })),

    isDayOne: !studied,
    practices: latest.map((practice) => ({
      label: practiceLabel(practice),
      passed: practice.passed,
      of: practice.of,
      missed: practice.missed,
    })),
  }
}
