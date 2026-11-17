import { createHash, randomUUID } from 'node:crypto'

import { Rating } from 'ts-fsrs'

import type { ReviewEvent } from '@/lib/study/contract'
import type { StoredEvent } from '@/lib/study/events'
import type { ItemMeta } from '@/lib/study/replay'

export const T0 = new Date('2026-08-17T16:00:00.000Z')

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

export function at(offsetMs: number, from: Date = T0): Date {
  return new Date(from.getTime() + offsetMs)
}

export function meta(itemId: string, overrides: Partial<ItemMeta> = {}): ItemMeta {
  return {
    itemId,
    category: 'Floor work',
    itemType: 'recall',
    topic: null,
    hasChoices: false,
    position: 0,
    quarantined: false,
    ...overrides,
  }
}

let counter = 0

export function stored(overrides: Partial<StoredEvent> = {}): StoredEvent {
  counter += 1
  const reviewedAt = overrides.reviewedAt ?? T0
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    itemId: 'card-a',
    mode: 'start',
    result: 'right',
    rating: Rating.Good,
    proposedRating: Rating.Good,
    overridden: false,
    answerMs: 6000,
    hintUsed: false,
    hintImposed: false,
    gradedBy: 'tutor',
    format: 'free',
    reviewedAt,
    changedAt: null,
    receivedAt: overrides.receivedAt ?? reviewedAt,
    ...overrides,
  }
}

export function posted(overrides: Partial<ReviewEvent> = {}): ReviewEvent {
  return {
    eventId: randomUUID(),
    itemId: 'term-tempo',
    mode: 'start',
    result: 'right',
    rating: 3,
    proposedRating: 3,
    overridden: false,
    answerText: 'Counts for each part of a move.',
    answerMs: 6000,
    hintUsed: false,
    gradedBy: 'tutor',
    traceId: null,
    reviewedAt: T0.toISOString(),
    ...overrides,
  }
}

export function photoVersion(jpegBase64: string): string {
  return createHash('md5').update(jpegBase64).digest('hex').slice(0, 12)
}
