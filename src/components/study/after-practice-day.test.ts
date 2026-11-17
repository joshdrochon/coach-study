import { describe, expect, it } from 'vitest'

import { nudgeMessage } from '@/lib/nudges/copy'
import { readinessHeading } from '@/lib/progress/milestones'
import { daysUntil, MILESTONES } from '@/lib/study/days'

import { bestFor, homeHero, milestoneLine } from './copy'

const countdown = (now: Date) => ({
  daysToPracticeDay: daysUntil(MILESTONES.practiceDay, now),
  daysToFirstClass: daysUntil(MILESTONES.firstClass, now),
})

const PRACTICE_DAY = new Date('2026-08-19T17:00:00Z')
const DAY_AFTER = new Date('2026-08-20T17:00:00Z')
const WEEK_AFTER = new Date('2026-08-26T17:00:00Z')

describe('after practice day (Aug 19)', () => {
  it('Home, Done for today and the reminders name the session on Aug 19', () => {
    expect(homeHero(countdown(PRACTICE_DAY)).headline).toBe('Practice day is today.')
    expect(milestoneLine(countdown(PRACTICE_DAY))).toBe('Practice day is today.')
    expect(
      nudgeMessage({ ...countdown(PRACTICE_DAY), cardsLeft: 5, reason: 'not-studied' }).title,
    ).toBe('Practice day is today.')
    expect(readinessHeading(PRACTICE_DAY)).toBe('Ready for Aug 19?')
  })

  it('from Aug 20 on, nothing their screens or reminders say names practice day or Aug 19', () => {
    for (const now of [DAY_AFTER, WEEK_AFTER]) {
      const lines = [
        homeHero(countdown(now)).headline,
        homeHero(countdown(now)).line,
        milestoneLine(countdown(now)) ?? '',
        nudgeMessage({ ...countdown(now), cardsLeft: 5, reason: 'not-studied' }).title,
        readinessHeading(now),
        bestFor(new Date(now.getTime())),
      ]
      for (const line of lines) {
        expect(line).not.toMatch(/Aug 19\b/)
      }
    }
    expect(homeHero(countdown(DAY_AFTER)).headline).toBe('21 days to your first coaching session.')
    expect(milestoneLine(countdown(DAY_AFTER))).toBe('Your first coaching session is in 21 days.')
    expect(readinessHeading(DAY_AFTER)).toBe('Ready for Sep 10?')
  })
})
