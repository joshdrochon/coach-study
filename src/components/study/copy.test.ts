import { describe, expect, it } from 'vitest'

import { formatShortDate } from '@/lib/dashboard/format'
import { MILESTONES } from '@/lib/study/days'
import { progressLineEnabled } from '@/lib/study/flags'

import {
  bestFor,
  cardCount,
  dateLabel,
  fittingHeadline,
  homeHero,
  progressLine,
  micPracticeCount,
  milestoneLine,
  planLine,
  questionStyleFor,
  seeAgain,
  studyTime,
  timer,
} from './copy'

describe('Home and Done count down to the milestones', () => {
  it('counts down to practice day, with the first coaching session after it', () => {
    expect(homeHero({ daysToPracticeDay: 2, daysToFirstClass: 24 })).toEqual({
      headline: 'Two days to practice day.',
      line: 'Warm-up and main set. First coaching session in 24 days.',
    })
    expect(homeHero({ daysToPracticeDay: 1, daysToFirstClass: 23 })).toEqual({
      headline: 'One day to practice day.',
      line: 'Warm-up and main set. First coaching session in 23 days.',
    })
    expect(homeHero({ daysToPracticeDay: 0, daysToFirstClass: 22 }).headline).toBe(
      'Practice day is today.',
    )
    expect(homeHero({ daysToPracticeDay: 12, daysToFirstClass: 34 }).headline).toBe(
      '12 days to practice day.',
    )
  })

  it('moves on to the first coaching session once practice day is behind their', () => {
    expect(homeHero({ daysToPracticeDay: -1, daysToFirstClass: 21 }).headline).toBe(
      '21 days to your first coaching session.',
    )
    expect(homeHero({ daysToPracticeDay: -1, daysToFirstClass: 9 }).headline).toBe(
      'Nine days to your first coaching session.',
    )
    expect(homeHero({ daysToPracticeDay: -21, daysToFirstClass: 1 }).headline).toBe(
      'One day to your first coaching session.',
    )
    expect(homeHero({ daysToPracticeDay: -22, daysToFirstClass: 0 }).headline).toBe(
      'Your first coaching session is today.',
    )
    expect(homeHero({ daysToPracticeDay: -23, daysToFirstClass: -1 })).toEqual({
      headline: 'Keep it all ready.',
      line: 'Every category at 90% ready.',
    })
    expect(homeHero({ daysToPracticeDay: 1, daysToFirstClass: 1 }).line).toBe(
      'Warm-up and main set. First coaching session tomorrow.',
    )
  })

  it('says the next milestone on Done for today', () => {
    expect(milestoneLine({ daysToPracticeDay: 1, daysToFirstClass: 23 })).toBe(
      'Tomorrow is practice day.',
    )
    expect(milestoneLine({ daysToPracticeDay: 2, daysToFirstClass: 24 })).toBe(
      'Practice day is in 2 days.',
    )
    expect(milestoneLine({ daysToPracticeDay: 0, daysToFirstClass: 22 })).toBe(
      'Practice day is today.',
    )
    expect(milestoneLine({ daysToPracticeDay: -17, daysToFirstClass: 5 })).toBe(
      'Your first coaching session is in 5 days.',
    )
    expect(milestoneLine({ daysToPracticeDay: -21, daysToFirstClass: 1 })).toBe(
      'Tomorrow is your first coaching session.',
    )
    expect(milestoneLine({ daysToPracticeDay: -22, daysToFirstClass: 0 })).toBe(
      'Your first coaching session is today.',
    )
    expect(milestoneLine({ daysToPracticeDay: -25, daysToFirstClass: -3 })).toBeNull()
  })
})

describe('numbers read one way everywhere', () => {
  it('counts cards and today’s plan', () => {
    expect(cardCount(1)).toBe('1 card')
    expect(cardCount(49)).toBe('49 cards')
    expect(micPracticeCount(1)).toBe('1 mic practice')
    expect(micPracticeCount(2)).toBe('2 mic practices')

    expect(planLine()).toBe('Today’s plan')
    expect(planLine(null)).toBe('Today’s plan')

    expect(planLine({ label: 'Day-1 check', cards: 60 })).toBe('Today’s plan · Day-1 check first')

    expect(planLine(null, 49)).toBe('Today’s plan · 49 cards')
    expect(planLine({ label: 'Day-1 check', cards: 60 }, 50)).toBe(
      'Today’s plan · Day-1 check first · 50 cards',
    )
  })

  it('says when the learner sees a card again', () => {
    expect(seeAgain(30_000)).toBe('You’ll see this again in 1 minute.')
    expect(seeAgain(600_000)).toBe('You’ll see this again in 10 minutes.')
    expect(seeAgain(3_600_000)).toBe('You’ll see this again in 1 hour.')
    expect(seeAgain(5 * 3_600_000)).toBe('You’ll see this again in 5 hours.')
    expect(seeAgain(86_400_000)).toBe('You’ll see this again tomorrow.')
    expect(seeAgain(3 * 86_400_000)).toBe('You’ll see this again in 3 days.')
  })

  it('writes study time as "1 h 52 min" and timers as m:ss with no leading zero', () => {
    expect(studyTime(0)).toBe('1 min')
    expect(studyTime(18 * 60_000)).toBe('18 min')
    expect(studyTime(112 * 60_000)).toBe('1 h 52 min')
    expect(studyTime(120 * 60_000)).toBe('2 h')
    expect(timer(252_000)).toBe('4:12')
    expect(timer(300_000)).toBe('5:00')
    expect(timer(-5)).toBe('0:00')
  })

  it('dates Home from their iPad and names the next milestone on Choose', () => {
    expect(dateLabel(new Date(2026, 7, 18, 9))).toBe('Tuesday, Aug 18')
    expect(bestFor(new Date(2026, 7, 18, 23))).toBe('Best for Aug 19 · recommended')
    expect(bestFor(new Date(2026, 7, 19, 23))).toBe('Best for Aug 19 · recommended')
    expect(bestFor(new Date(2026, 7, 20, 1))).toBe('Best for Sep 10 · recommended')
    expect(bestFor(new Date(2026, 8, 11))).toBe('Recommended')
  })
})

describe('a headline keeps its [bracketed phrase] whole', () => {
  it('keeps the largest headline style the phrase fits at, the smallest if none', () => {
    const widths = [540, 360, 300]
    expect(fittingHeadline(widths, 672)).toBe('headline-xl')
    expect(fittingHeadline(widths, 540.4)).toBe('headline-xl')
    expect(fittingHeadline(widths, 528)).toBe('headline-l')
    expect(fittingHeadline(widths, 336)).toBe('headline-m')
    expect(fittingHeadline(widths, 272)).toBe('headline-m')

    expect(fittingHeadline([0, 0, 0], 0)).toBe('headline-xl')
  })
})

describe('real content on the card and the result', () => {
  it('keeps the 72px question style up to 3 lines at the width it has, headline-l past that', () => {
    expect(questionStyleFor(72, 72)).toBe('question-xl')
    expect(questionStyleFor(216, 72)).toBe('question-xl')
    expect(questionStyleFor(288, 72)).toBe('headline-l')

    expect(questionStyleFor(217.5, 72)).toBe('question-xl')
    expect(questionStyleFor(288, Number.NaN)).toBe('question-xl')
  })
})

describe('Home’s line after practice day is honest', () => {
  const home = (over: Partial<Parameters<typeof progressLine>[0]> = {}) => ({
    daysToPracticeDay: -12,
    daysToFirstClass: 10,
    dueToday: 40,
    studiedToday: false,
    paceStart: 0.5,
    readiness: { now: 0.69, afterToday: 0.72 },
    ...over,
  })

  it('on pace: today’s cards keep them there', () => {
    expect(progressLine(home())).toBe(
      'You’re 69% there. Today’s 40 cards keep you on pace for Sep 10.',
    )
  })

  it('ahead of pace: today’s cards keep them there', () => {
    expect(progressLine(home({ readiness: { now: 0.8, afterToday: 0.82 }, dueToday: 20 }))).toBe(
      'You’re 80% there, ahead of pace. Today’s 20 cards keep you there.',
    )
  })

  it('a bit behind: "catch you up" only when today puts them back on pace by the math', () => {
    expect(progressLine(home({ readiness: { now: 0.62, afterToday: 0.7 }, dueToday: 55 }))).toBe(
      'You’re 62% there, a bit behind pace. Today’s 55 cards catch you up.',
    )

    expect(progressLine(home({ readiness: { now: 0.62, afterToday: 0.69 } }))).toContain('catch')
    expect(progressLine(home({ readiness: { now: 0.62, afterToday: 0.689 } }))).toBe(
      'You’re 62% there, a bit behind pace. Today’s 40 cards get you closer.',
    )
  })

  it('far behind says behind, not a bit behind', () => {
    expect(progressLine(home({ readiness: { now: 0.55, afterToday: 0.6 } }))).toBe(
      'You’re 55% there, behind pace. Today’s 40 cards get you closer.',
    )
  })

  it('only counts the cards when the math backs no promise', () => {
    expect(progressLine(home({ readiness: { now: 0.7, afterToday: 0.689 } }))).toBe(
      'You’re 70% there, on pace for Sep 10. Today’s 40 cards are what’s left.',
    )

    expect(progressLine(home({ readiness: { now: 0.78, afterToday: 0.75 } }))).toBe(
      'You’re 78% there, ahead of pace. Today’s 40 cards are what’s left.',
    )

    expect(progressLine(home({ readiness: { now: 0.6, afterToday: 0.6 } }))).toBe(
      'You’re 60% there, a bit behind pace. Today’s 40 cards are what’s left.',
    )
  })

  it('judges the 3 point edge on pace and a hair past it not', () => {
    expect(progressLine(home({ readiness: { now: 0.73, afterToday: 0.75 } }))).toContain(
      'keep you on pace',
    )
    expect(progressLine(home({ readiness: { now: 0.7301, afterToday: 0.76 } }))).toContain(
      'ahead of pace',
    )
    expect(progressLine(home({ readiness: { now: 0.67, afterToday: 0.72 } }))).toContain(
      'keep you on pace',
    )
    expect(progressLine(home({ readiness: { now: 0.6699, afterToday: 0.72 } }))).toContain(
      'a bit behind pace',
    )
  })

  it('today’s cards done: the number and nothing about pace', () => {
    expect(progressLine(home({ dueToday: 0, studiedToday: true }))).toBe(
      'You’re 69% there. Today’s cards are done.',
    )
  })

  it('nothing due and nothing answered today says so, not that the learner is done', () => {
    expect(progressLine(home({ dueToday: 0, studiedToday: false }))).toBe(
      'You’re 69% there. Nothing is due today.',
    )
  })

  it('no data yet: no number', () => {
    const none = { now: 0, afterToday: 0 }
    expect(progressLine(home({ readiness: none }))).toBe(
      'Answer today’s 40 cards to see how ready you are.',
    )
    expect(progressLine(home({ readiness: none, dueToday: 0 }))).toBe('Nothing is due today.')
  })

  it('without their Aug 20 number it names the number and what is left, no pace', () => {
    expect(progressLine(home({ paceStart: null }))).toBe(
      'You’re 69% there. Today’s 40 cards are what’s left.',
    )
    expect(progressLine(home({ paceStart: undefined }))).toBe(
      'You’re 69% there. Today’s 40 cards are what’s left.',
    )
  })

  it('a copy cached before this had no readiness: only the cards, honestly', () => {
    expect(progressLine(home({ readiness: undefined }))).toBe('Today’s 40 cards are what’s left.')
    expect(progressLine(home({ readiness: null, dueToday: 0, studiedToday: true }))).toBe(
      'Today’s cards are done.',
    )
    expect(progressLine(home({ readiness: undefined, dueToday: 0 }))).toBe('Nothing is due today.')
    expect(progressLine({ daysToPracticeDay: -12, daysToFirstClass: 10 })).toBe('')
  })

  it('one card agrees with its verb', () => {
    expect(progressLine(home({ dueToday: 1 }))).toBe(
      'You’re 69% there. Today’s 1 card keeps you on pace for Sep 10.',
    )
    expect(progressLine(home({ dueToday: 1, readiness: { now: 0.62, afterToday: 0.7 } }))).toBe(
      'You’re 62% there, a bit behind pace. Today’s 1 card catches you up.',
    )
    expect(progressLine(home({ dueToday: 1, readiness: { now: 0.62, afterToday: 0.64 } }))).toBe(
      'You’re 62% there, a bit behind pace. Today’s 1 card gets you closer.',
    )
    expect(progressLine(home({ dueToday: 1, readiness: { now: 0.7, afterToday: 0.6 } }))).toBe(
      'You’re 70% there, on pace for Sep 10. Today’s 1 card is what’s left.',
    )
  })

  it('rounds their number down, as Progress does', () => {
    expect(progressLine(home({ readiness: { now: 0.6999, afterToday: 0.72 } }))).toContain('69%')
    expect(progressLine(home({ readiness: { now: 0.005, afterToday: 0.05 } }))).toContain('<1%')
  })

  it('says Sep 10, the date of the first coaching session', () => {
    expect(formatShortDate(new Date(`${MILESTONES.firstClass}T12:00:00Z`))).toBe('Sep 10')
  })

  it('is the line under the headline from Aug 20 to the day itself, and nothing else changed', () => {
    expect(homeHero(home({ daysToFirstClass: 21 })).headline).toBe(
      '21 days to your first coaching session.',
    )
    expect(homeHero(home(), true).line).toBe(progressLine(home()))
    expect(homeHero(home({ daysToFirstClass: 0 }), true).line).toBe(
      progressLine(home({ daysToFirstClass: 0 })),
    )
    expect(homeHero(home({ daysToPracticeDay: -23, daysToFirstClass: -1 }), true)).toEqual({
      headline: 'Keep it all ready.',
      line: 'Every category at 90% ready.',
    })
    expect(homeHero({ ...home(), daysToPracticeDay: 2, daysToFirstClass: 24 }, true).line).toBe(
      'Warm-up and main set. First coaching session in 24 days.',
    )
  })

  it('is gated off: Home says the current goal', () => {
    expect(progressLineEnabled()).toBe(false)
    expect(homeHero(home()).line).toBe('Current goal: a good grasp of all the material.')
    expect(homeHero(home(), false).line).toBe('Current goal: a good grasp of all the material.')
  })

  it('every line follows the voice: no em dash, no semicolon, no "rep"', () => {
    const lines = [
      home(),
      home({ readiness: { now: 0.8, afterToday: 0.82 } }),
      home({ readiness: { now: 0.62, afterToday: 0.7 } }),
      home({ readiness: { now: 0.55, afterToday: 0.6 } }),
      home({ dueToday: 0, studiedToday: true }),
      home({ dueToday: 0 }),
      home({ readiness: { now: 0, afterToday: 0 } }),
      home({ paceStart: null }),
    ].map((facts) => progressLine(facts))
    for (const line of lines) {
      expect(line).not.toMatch(/[—;]|\brep/i)
      expect(line.length).toBeLessThan(80)
    }
  })
})
