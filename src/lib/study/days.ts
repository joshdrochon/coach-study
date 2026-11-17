// Days until the schedule's milestones, counted in the learner's time zone.

import { SCHEDULE } from '../schedule'
import { dayKey, localDay, TIME_ZONE } from '../scheduler/calendar'

export const MILESTONES = {
  practiceDay: SCHEDULE.practiceDay,
  firstClass: SCHEDULE.firstClass,
} as const

export function canonicalTimeZone(value: string): string | null {
  if (value.length === 0 || value.length > 64) return null
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone
  } catch {
    return null
  }
}

export function daysUntil(target: string, now: Date, timeZone: string = TIME_ZONE): number {
  const today = Date.parse(`${dayKey(now, timeZone)}T00:00:00Z`)
  const day = Date.parse(`${target}T00:00:00Z`)

  return Math.round((day - today) / 86_400_000)
}

export function endOfPacificDay(now: Date): Date {
  return new Date(localDay(now, TIME_ZONE).end - 1)
}

export function endOfEvaluationDay(day: string): Date {
  return endOfPacificDay(new Date(`${day}T12:00:00Z`))
}

export function nextEvaluationDay(now: Date): string | null {
  for (const day of [MILESTONES.practiceDay, MILESTONES.firstClass]) {
    if (now <= endOfEvaluationDay(day)) return day
  }
  return null
}
