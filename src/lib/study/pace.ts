// The daily pace toward the first class: how ready the learner should be today if
// readiness grows evenly from the pace start.

import { Rating } from 'ts-fsrs'

import { SCHEDULE } from '../schedule'

import { localDay, TIME_ZONE } from '../scheduler/calendar'
import { defaultScheduler, isLearning, isNew, type Scheduler } from '../scheduler/fsrs'
import { isDueReview } from '../scheduler/queue'
import { meanRecall, READY_THRESHOLD } from '../scheduler/readiness'
import { compareText } from '../scheduler/seeded'
import type { SchedulerCard } from '../scheduler/types'

import { MILESTONES } from './days'

export const PACE_START_DAY = SCHEDULE.paceStart

export const PACE_DAYS = Math.round(
  (Date.parse(`${MILESTONES.firstClass}T00:00:00Z`) - Date.parse(`${PACE_START_DAY}T00:00:00Z`)) /
    86_400_000,
)
export const PACE_GOAL = READY_THRESHOLD

export const PACE_TOLERANCE = 0.03

export const PACE_FAR = 0.1

const EPSILON = 1e-9

export function paceDay(daysToFirstClass: number): number {
  return Math.min(PACE_DAYS, Math.max(0, PACE_DAYS - daysToFirstClass))
}

export function paceTarget(start: number, day: number): number {
  const d = Math.min(PACE_DAYS, Math.max(0, day))
  if (start >= PACE_GOAL) return PACE_GOAL
  return start + ((PACE_GOAL - start) * d) / PACE_DAYS
}

export type PaceEffect = 'keeps' | 'catches-up' | 'closer' | 'none'
export type PaceStanding = {
  pace: 'behind' | 'on' | 'ahead'

  far: boolean
  effect: PaceEffect
}

export type PaceInput = {
  now: number
  afterToday: number

  start: number

  daysToFirstClass: number
}

export function paceStanding(input: PaceInput): PaceStanding {
  const day = paceDay(input.daysToFirstClass)
  const today = paceTarget(input.start, day)

  const tonight = paceTarget(input.start, day + 1)
  const gap = input.now - today
  const pace =
    gap > PACE_TOLERANCE + EPSILON ? 'ahead' : gap < -(PACE_TOLERANCE + EPSILON) ? 'behind' : 'on'
  const far = gap < -(PACE_FAR + EPSILON)
  const backOnLine = input.afterToday >= tonight - PACE_TOLERANCE - EPSILON
  switch (pace) {
    case 'ahead':
      return {
        pace,
        far,
        effect: input.afterToday > tonight + PACE_TOLERANCE + EPSILON ? 'keeps' : 'none',
      }
    case 'on':
      return { pace, far, effect: backOnLine ? 'keeps' : 'none' }
    case 'behind':
      return {
        pace,
        far,
        effect: backOnLine
          ? 'catches-up'
          : input.afterToday > input.now + EPSILON
            ? 'closer'
            : 'none',
      }
  }
}

export function readinessAfterToday(
  cards: readonly SchedulerCard[],
  newLeft: number,
  now: Date,
  at: Date,
  scheduler: Scheduler = defaultScheduler,
): number {
  const day = localDay(now, TIME_ZONE)
  const active = cards.filter((card) => !card.quarantined)
  const newest = active
    .filter(isNew)
    .toSorted((a, b) => a.position - b.position || compareText(a.itemId, b.itemId))
    .slice(0, newLeft)
  const answered = new Map<string, SchedulerCard>()
  for (const card of [
    ...active.filter((entry) => isDueReview(entry, now, day) || isLearning(entry)),
    ...newest,
  ]) {
    answered.set(card.itemId, answerRight(card, now, scheduler))
  }
  return meanRecall(
    cards.map((card) => answered.get(card.itemId) ?? card),
    at,
    scheduler,
  )
}

const STEP_MS = 10 * 60_000
const MAX_STEPS = 5

function answerRight(card: SchedulerCard, now: Date, scheduler: Scheduler): SchedulerCard {
  let current = card
  let moment = now
  for (let step = 0; step < MAX_STEPS; step += 1) {
    current = scheduler.review(current, Rating.Good, moment).card
    if (!isNew(current) && !isLearning(current)) break
    moment = new Date(moment.getTime() + STEP_MS)
  }
  return current
}
