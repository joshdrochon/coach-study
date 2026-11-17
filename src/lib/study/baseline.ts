import {
  BASELINE_ITEMS,
  baselineDue,
  pickBaselineItems,
  type BaselineRound,
  type BaselineRun,
} from '../scheduler/baseline'
import { dayLabel, SCHEDULE } from '../schedule'
import { TIME_ZONE } from '../scheduler/calendar'
import { compareText } from '../scheduler/seeded'
import type { SchedulerCard } from '../scheduler/types'

import { answerKey, effectiveTime, type StoredEvent } from './events'

export type BaselineAnswerRef = { itemId: string; at: Date }

export const BASELINE_LABELS: Record<BaselineRound, string> = {
  'day-1': 'Day-1 check',
  'before-practice-day': `Check before ${dayLabel(SCHEDULE.practiceDay)}`,
  'before-first-class': `Check before ${dayLabel(SCHEDULE.firstClass)}`,
}

const byTime = (a: BaselineAnswerRef, b: BaselineAnswerRef): number =>
  a.at.getTime() - b.at.getTime() || compareText(a.itemId, b.itemId)

export function baselineAnswerRefs(events: readonly StoredEvent[]): BaselineAnswerRef[] {
  const answers = new Map<string, BaselineAnswerRef>()
  for (const event of events) {
    if (event.mode !== 'baseline') continue
    const key = answerKey(event)
    const at = effectiveTime(event)
    const known = answers.get(key)
    if (!known || at < known.at) answers.set(key, { itemId: event.itemId, at })
  }
  return [...answers.values()].toSorted(byTime)
}

export function roundSize(cards: readonly SchedulerCard[]): number {
  return Math.min(BASELINE_ITEMS, cards.filter((card) => !card.quarantined).length)
}

export function roundOrder(cards: readonly SchedulerCard[], round: BaselineRound): string[] {
  const pulled = new Set(cards.filter((card) => card.quarantined).map((card) => card.itemId))
  const order = pickBaselineItems(
    cards.map((card) => ({ ...card, quarantined: false })),
    round,
    cards.length,
  )
  return order.itemIds.filter((itemId) => !pulled.has(itemId))
}

export type RoundProgress<T extends BaselineAnswerRef> = {
  round: BaselineRound

  answers: [T, ...T[]]
  completedAt: Date | null
}

export function baselineRounds<T extends BaselineAnswerRef>(
  cards: readonly SchedulerCard[],
  answers: readonly T[],
  timeZone: string = TIME_ZONE,
): { runs: BaselineRun[]; rounds: RoundProgress<T>[] } {
  const size = roundSize(cards)
  const runs: BaselineRun[] = []
  const rounds: RoundProgress<T>[] = []
  for (const answer of answers.toSorted(byTime)) {
    const status = baselineDue(runs, answer.at, timeZone)
    if (!status.due) continue
    let progress = rounds.find((entry) => entry.round === status.round)
    if (!progress) {
      progress = { round: status.round, answers: [answer], completedAt: null }
      rounds.push(progress)
    } else if (progress.answers.some((entry) => entry.itemId === answer.itemId)) {
      continue
    } else {
      progress.answers.push(answer)
    }
    if (progress.answers.length >= size) {
      progress.completedAt = answer.at
      runs.push({ round: progress.round, completedAt: answer.at })
    }
  }
  return { runs, rounds }
}

export type CurrentRound = {
  round: BaselineRound
  label: string

  answered: number
  remaining: number

  order: string[]
}

export function currentRound(
  cards: readonly SchedulerCard[],
  answers: readonly BaselineAnswerRef[],
  now: Date,
  timeZone: string = TIME_ZONE,
): CurrentRound | null {
  const { runs, rounds } = baselineRounds(cards, answers, timeZone)
  const status = baselineDue(runs, now, timeZone)
  if (!status.due) return null
  const answered = new Set(
    rounds.find((entry) => entry.round === status.round)?.answers.map((answer) => answer.itemId),
  )
  const remaining = roundSize(cards) - answered.size
  if (remaining <= 0) return null
  return {
    round: status.round,
    label: BASELINE_LABELS[status.round],
    answered: answered.size,
    remaining,
    order: roundOrder(cards, status.round).filter((itemId) => !answered.has(itemId)),
  }
}
