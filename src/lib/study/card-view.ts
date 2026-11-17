import { Rating, type Grade } from 'ts-fsrs'

import { defaultScheduler, type Scheduler } from '../scheduler/fsrs'
import type { QueuedCard } from '../scheduler/queue'
import { seededOrder } from '../scheduler/seeded'

import type { CardView, DeckCard } from './contract'
import type { ItemMeta } from './replay'

export function metaOf(card: DeckCard): ItemMeta {
  return {
    itemId: card.itemId,
    category: card.category,
    itemType: card.type,
    topic: card.exercise ?? null,
    hasChoices: (card.choices?.length ?? 0) > 0,
    position: card.position,
    quarantined: false,
  }
}

export function dueInMs(
  card: QueuedCard['card'],
  now: Date,
  scheduler: Scheduler = defaultScheduler,
): [number, number, number, number] {
  const lastReview = card.fsrs.last_review?.getTime() ?? Number.NEGATIVE_INFINITY
  const at = new Date(Math.max(now.getTime(), lastReview))
  const after = (rating: Grade): number =>
    scheduler.review(card, rating, at).card.fsrs.due.getTime() - now.getTime()
  return [after(Rating.Again), after(Rating.Hard), after(Rating.Good), after(Rating.Easy)]
}

export function toCardView(
  card: DeckCard,
  queued: QueuedCard,
  now: Date,
  seed: string,
  scheduler: Scheduler = defaultScheduler,
): CardView {
  const choices =
    queued.format === 'choices' && card.choices
      ? seededOrder(card.choices, (choice) => choice, `${seed}|${card.itemId}`)
      : undefined
  return {
    itemId: card.itemId,
    category: card.category,
    type: card.type,
    prompt: card.prompt,
    ...(choices ? { choices, format: 'choices' as const } : { format: 'free' as const }),
    ...(card.parts ? { parts: card.parts } : {}),
    ...(card.ordered === undefined ? {} : { ordered: card.ordered }),
    answer: card.answer,
    explanation: card.explanation,
    citation: card.citation,
    ...(card.photo ? { photo: card.photo } : {}),
    ...(card.exercise ? { exercise: card.exercise } : {}),
    dueInMs: dueInMs(queued.card, now, scheduler),
    hintFirst: queued.hintFirst,
  }
}
