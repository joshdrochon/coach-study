// Readiness is mean predicted recall, per category and at a future date.

import { addDays } from './calendar'
import { defaultScheduler, isNew, type Scheduler } from './fsrs'
import { compareText } from './seeded'
import type { SchedulerCard } from './types'

export const READY_THRESHOLD = 0.9

export const MASTERY_HORIZON_DAYS = 30

export type CategoryReadiness = {
  category: string
  items: number

  started: number

  recall: number

  itemsReady: number
  ready: boolean
}

export function readinessByCategory(
  cards: readonly SchedulerCard[],
  at: Date,
  scheduler: Scheduler = defaultScheduler,
): CategoryReadiness[] {
  const byCategory = new Map<string, number[]>()
  const startedBy = new Map<string, number>()
  for (const card of cards) {
    if (card.quarantined) continue
    const recalls = byCategory.get(card.category) ?? []
    recalls.push(scheduler.retrievability(card, at))
    byCategory.set(card.category, recalls)
    if (!isNew(card)) startedBy.set(card.category, (startedBy.get(card.category) ?? 0) + 1)
  }
  return [...byCategory.entries()]
    .map(([category, recalls]) => {
      const recall = recalls.reduce((sum, value) => sum + value, 0) / recalls.length
      return {
        category,
        items: recalls.length,
        started: startedBy.get(category) ?? 0,
        recall,
        itemsReady: recalls.filter((value) => value >= READY_THRESHOLD).length,
        ready: recall >= READY_THRESHOLD,
      }
    })
    .toSorted((a, b) => a.recall - b.recall || compareText(a.category, b.category))
}

export type MasteryReport = {
  mastered: boolean

  reason: string | null
  checkedAt: Date
  items: number
  itemsReady: number

  notYet: { itemId: string; category: string; recall: number }[]

  quarantined: number
}

const cardCount = (count: number): string => `${String(count)} ${count === 1 ? 'card' : 'cards'}`

export function masteryCheck(
  cards: readonly SchedulerCard[],
  now: Date,
  scheduler: Scheduler = defaultScheduler,
): MasteryReport {
  const checkedAt = addDays(now, MASTERY_HORIZON_DAYS)
  const counted = cards.filter((card) => !card.quarantined)
  const notYet = counted
    .map((card) => ({
      itemId: card.itemId,
      category: card.category,
      recall: scheduler.retrievability(card, checkedAt),
    }))
    .filter((entry) => entry.recall < READY_THRESHOLD)
    .toSorted((a, b) => a.recall - b.recall || compareText(a.itemId, b.itemId))
  const quarantined = cards.length - counted.length
  const reasons = [
    counted.length === 0 ? 'no cards yet' : null,
    notYet.length > 0 ? `${cardCount(notYet.length)} under 90% 30 days out` : null,
    quarantined > 0 ? `${cardCount(quarantined)} pulled from rotation, waiting for review` : null,
  ].filter((reason) => reason !== null)
  return {
    mastered: reasons.length === 0,
    reason: reasons.length === 0 ? null : reasons.join('; '),
    checkedAt,
    items: counted.length,
    itemsReady: counted.length - notYet.length,
    notYet,
    quarantined,
  }
}

export function meanRecall(
  cards: readonly SchedulerCard[],
  at: Date,
  scheduler: Scheduler = defaultScheduler,
): number {
  let total = 0
  let counted = 0
  for (const card of cards) {
    if (card.quarantined) continue
    total += scheduler.retrievability(card, at)
    counted += 1
  }
  return counted === 0 ? 0 : total / counted
}
