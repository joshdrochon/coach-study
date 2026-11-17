import { cardCount, homeHero } from '@/components/study/copy'

import type { NudgeReason } from './schedule'

export type NudgeMessage = {
  title: string
  body: string

  url: string

  tag: string
}

export const NUDGE_URL = '/'
export const NUDGE_TAG = 'coach-study-reminder'

export type NudgeCopyInput = {
  daysToPracticeDay: number
  daysToFirstClass: number
  cardsLeft: number
  reason: NudgeReason
}

export function nudgeMessage(input: NudgeCopyInput): NudgeMessage {
  const cards = cardCount(input.cardsLeft)
  const today = input.reason === 'cards-left' ? `${cards} left for today.` : `${cards} for today.`
  return {
    title: homeHero(input).headline,
    body: `${today} Start when you’re ready.`,
    url: NUDGE_URL,
    tag: NUDGE_TAG,
  }
}
