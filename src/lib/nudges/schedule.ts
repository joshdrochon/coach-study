// When to send a reminder: at most two a day with a minimum gap, outside quiet hours,
// and not while the learner is studying or once nothing is left for today.

import { dayKey, TIME_ZONE } from '../scheduler/calendar'

export const NUDGE_RULES = {
  firstHour: 8,
  quietFromHour: 21,

  perDay: 2,

  attemptsPerDay: 4,

  minGapHours: 6,

  activeMinutes: 60,
} as const

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

export type NudgeReason = 'not-studied' | 'cards-left'

export type SkipReason = 'quiet-hours' | 'daily-limit' | 'too-soon' | 'studying' | 'nothing-left'

export type NudgeDecision = { send: true; reason: NudgeReason } | { send: false; skip: SkipReason }

export type NudgeFacts = {
  now: Date

  sentToday: number

  attemptsToday: number

  lastSentAt: Date | null

  lastActivityAt: Date | null

  cardsLeft: number
}

const clock = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

export function localSeconds(at: Date): number {
  const time = { hour: 0, minute: 0, second: 0 }
  for (const { type, value } of clock.formatToParts(at)) {
    if (type === 'hour' || type === 'minute' || type === 'second') time[type] = Number(value)
  }
  return time.hour * 3600 + time.minute * 60 + time.second
}

export function nudgeDay(at: Date): string {
  return dayKey(at, TIME_ZONE)
}

export function inSendingHours(now: Date): boolean {
  const seconds = localSeconds(now)
  return seconds >= NUDGE_RULES.firstHour * 3600 && seconds < NUDGE_RULES.quietFromHour * 3600
}

export function timingSkip(
  now: Date,
  sentToday: number,
  attemptsToday: number,
  lastSentAt: Date | null,
): SkipReason | null {
  if (!inSendingHours(now)) return 'quiet-hours'
  if (sentToday >= NUDGE_RULES.perDay || attemptsToday >= NUDGE_RULES.attemptsPerDay) {
    return 'daily-limit'
  }
  if (lastSentAt && now.getTime() - lastSentAt.getTime() < NUDGE_RULES.minGapHours * HOUR_MS) {
    return 'too-soon'
  }
  return null
}

export function studiedToday(now: Date, lastActivityAt: Date | null): boolean {
  return lastActivityAt !== null && nudgeDay(lastActivityAt) === nudgeDay(now)
}

export function studySkip(
  now: Date,
  lastActivityAt: Date | null,
  cardsLeft: number,
): SkipReason | null {
  if (cardsLeft <= 0) return 'nothing-left'
  if (
    lastActivityAt &&
    now.getTime() - lastActivityAt.getTime() < NUDGE_RULES.activeMinutes * MINUTE_MS
  ) {
    return 'studying'
  }
  return null
}

export function decideNudge(facts: NudgeFacts): NudgeDecision {
  const skip =
    timingSkip(facts.now, facts.sentToday, facts.attemptsToday, facts.lastSentAt) ??
    studySkip(facts.now, facts.lastActivityAt, facts.cardsLeft)
  if (skip) return { send: false, skip }
  return {
    send: true,
    reason: studiedToday(facts.now, facts.lastActivityAt) ? 'cards-left' : 'not-studied',
  }
}

export function pushTtlSeconds(now: Date): number {
  const untilQuiet = NUDGE_RULES.quietFromHour * 3600 - localSeconds(now)
  return Math.max(0, Math.min(untilQuiet, NUDGE_RULES.minGapHours * 3600))
}
