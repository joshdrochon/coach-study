import { randomUUID } from 'node:crypto'

import type { Db } from '@/lib/db/client'
import { reviewEvents } from '@/lib/db/schema'
import type { SchedulerCard } from '@/lib/scheduler/types'
import { roundOrder, roundSize, type BaselineAnswerRef } from '@/lib/study/baseline'

import { MINUTE, T0 } from './study-fixtures'

export const CHECK_DONE_AT = new Date(T0.getTime() - 90 * MINUTE)

export function checkDone(
  cards: readonly SchedulerCard[],
  from: Date = CHECK_DONE_AT,
): BaselineAnswerRef[] {
  return roundOrder(cards, 'day-1')
    .slice(0, roundSize(cards))
    .map((itemId, index) => ({ itemId, at: new Date(from.getTime() + index * 1000) }))
}

export async function storeCheckDone(
  db: Db,
  cards: readonly SchedulerCard[],
  from: Date = CHECK_DONE_AT,
): Promise<number> {
  const answers = checkDone(cards, from)
  await db.insert(reviewEvents).values(
    answers.map(({ itemId, at }) => ({
      id: randomUUID(),
      deviceId: 'ipad',
      itemId,
      mode: 'baseline' as const,
      result: 'wrong' as const,
      rating: 1,
      proposedRating: 1,
      answerMs: 6000,
      gradedBy: 'tutor' as const,
      reviewedAt: at,
      receivedAt: at,
    })),
  )
  return answers.length
}
