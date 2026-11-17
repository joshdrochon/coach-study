// Review events as stored, and the helpers that order and deduplicate them.

import { z } from 'zod'

import { REVIEW_EVENT_MODES } from '../db/review-modes'
import {
  correctnessSchema,
  gradeSchema,
  presentationFormatSchema,
  type ReviewContext,
} from '../scheduler/types'

export const EVENT_MODES = REVIEW_EVENT_MODES
export const eventModeSchema = z.enum(EVENT_MODES)
export type EventMode = z.infer<typeof eventModeSchema>

export function contextOf(mode: EventMode): ReviewContext {
  if (mode === 'baseline') return 'baseline'
  if (mode === 'mic-practice') return 'mic-practice'
  return 'study'
}

export const STUDY_EVENT_MODES = ['start', 'focus', 'together'] as const satisfies EventMode[]

export const storedEventSchema = z.object({
  id: z.string().min(1),
  itemId: z.string().min(1),
  mode: eventModeSchema,
  result: correctnessSchema,
  rating: gradeSchema,
  proposedRating: gradeSchema,
  overridden: z.boolean(),
  answerMs: z.number().int().nonnegative(),
  hintUsed: z.boolean(),
  hintImposed: z.boolean(),
  gradedBy: z.enum(['tutor', 'self', 'code']),
  format: presentationFormatSchema,
  reviewedAt: z.date(),
  changedAt: z.date().nullable(),
  receivedAt: z.date(),
})
export type StoredEvent = z.infer<typeof storedEventSchema>

export function parseEvents(rows: readonly unknown[]): { events: StoredEvent[]; invalid: number } {
  const events: StoredEvent[] = []
  let invalid = 0
  for (const row of rows) {
    const parsed = storedEventSchema.safeParse(row)
    if (parsed.success) events.push(parsed.data)
    else invalid += 1
  }
  return { events, invalid }
}

export function effectiveTime(event: Pick<StoredEvent, 'reviewedAt' | 'receivedAt'>): Date {
  return new Date(Math.min(event.reviewedAt.getTime(), event.receivedAt.getTime()))
}

export function answerKey(event: Pick<StoredEvent, 'itemId' | 'reviewedAt'>): string {
  return `${event.itemId}\u0000${String(event.reviewedAt.getTime())}`
}
