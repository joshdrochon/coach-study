import { describe, expect, it } from 'vitest'

import { homeHero } from '@/components/study/copy'

import { NUDGE_TAG, NUDGE_URL, nudgeMessage, type NudgeCopyInput } from './copy'

const base: NudgeCopyInput = {
  daysToPracticeDay: 2,
  daysToFirstClass: 19,
  cardsLeft: 49,
  reason: 'not-studied',
}

const samples: NudgeCopyInput[] = [2, 1, 0, -1, -17, -18].flatMap((mic) =>
  [1, 12, 49].flatMap((cardsLeft) =>
    (['not-studied', 'cards-left'] as const).map((reason) => ({
      daysToPracticeDay: mic,
      daysToFirstClass: mic + 17,
      cardsLeft,
      reason,
    })),
  ),
)

describe('what a reminder says', () => {
  it('leads with Home’s countdown and says the cards for today', () => {
    expect(nudgeMessage(base)).toEqual({
      title: 'Two days to practice day.',
      body: '49 cards for today. Start when you’re ready.',
      url: '/',
      tag: 'coach-study-reminder',
    })
    expect(nudgeMessage({ ...base, reason: 'cards-left', cardsLeft: 1 }).body).toBe(
      '1 card left for today. Start when you’re ready.',
    )
    expect(nudgeMessage({ ...base, daysToPracticeDay: 0, daysToFirstClass: 17 }).title).toBe(
      'Practice day is today.',
    )
  })

  it('uses the same words as Home for the same day (one format per kind of data)', () => {
    for (const input of samples) {
      expect(nudgeMessage(input).title).toBe(homeHero(input).headline)
    }
  })

  it('opens Home on tap, and a newer reminder replaces an older one', () => {
    for (const input of samples) {
      const message = nudgeMessage(input)
      expect(message.url).toBe(NUDGE_URL)
      expect(message.tag).toBe(NUDGE_TAG)
    }
  })

  it('has no streak or guilt language: no streak, no missed day, nothing about falling behind', () => {
    const guilt =
      /\b(streak|streaks|missed|miss|behind|lost|lose|broke|break|forgot|forget|again|still|yet|should|need to|don’t|haven’t)\b/i
    for (const input of samples) {
      const { title, body } = nudgeMessage(input)
      expect(`${title} ${body}`).not.toMatch(guilt)
    }
  })
})
