// Rebuilds past answers for review screens from stored events, newest first.

import { Rating } from 'ts-fsrs'

import { placeFromBaseline } from '../scheduler/baseline'
import { defaultScheduler, isNew, newCard, resultOf, type Scheduler } from '../scheduler/fsrs'
import { applyOverride } from '../scheduler/rating'
import { compareText } from '../scheduler/seeded'
import type { Correctness, ReviewContext, ReviewLog, SchedulerCard } from '../scheduler/types'

import { contextOf, effectiveTime, type StoredEvent } from './events'

export type ItemMeta = Omit<SchedulerCard, 'fsrs'>

export type Answer = {
  itemId: string

  eventIds: string[]
  context: ReviewContext

  at: Date

  result: Correctness

  log: ReviewLog | null
}

export type Replayed = {
  card: SchedulerCard
  answers: Answer[]

  refused: string[]
}

type Group = { events: [StoredEvent, ...StoredEvent[]]; at: Date }

const changeOrder = (event: StoredEvent): number => (event.changedAt ?? event.receivedAt).getTime()
const inAnswerOrder = (a: StoredEvent, b: StoredEvent): number =>
  Number(a.overridden) - Number(b.overridden) ||
  changeOrder(a) - changeOrder(b) ||
  a.receivedAt.getTime() - b.receivedAt.getTime() ||
  compareText(a.id, b.id)

export function answerGroups(events: readonly StoredEvent[]): Group[] {
  const byMoment = new Map<number, Group['events']>()
  for (const event of events) {
    const key = event.reviewedAt.getTime()
    const list = byMoment.get(key)
    if (list) list.push(event)
    else byMoment.set(key, [event])
  }
  const groups = [...byMoment.values()].map((list): Group => {
    list.sort(inAnswerOrder)
    const at = Math.min(...list.map((event) => effectiveTime(event).getTime()))
    return { events: list, at: new Date(at) }
  })

  return groups.toSorted(
    (a, b) =>
      a.at.getTime() - b.at.getTime() ||
      a.events[0].reviewedAt.getTime() - b.events[0].reviewedAt.getTime(),
  )
}

type Applied = { card: SchedulerCard; log: ReviewLog | null; result: Correctness }

const withResult = (applied: { card: SchedulerCard; log: ReviewLog }): Applied => ({
  ...applied,
  result: applied.log.result,
})

function applyAnswer(card: SchedulerCard, group: Group, scheduler: Scheduler): Applied {
  const [base, ...changes] = group.events
  const rating = (changes.at(-1) ?? base).rating
  const context = contextOf(base.mode)
  const { at } = group

  const helped = base.hintUsed || base.hintImposed || base.format === 'choices'

  const learnerRating = base.gradedBy === 'self' || rating !== base.proposedRating
  switch (context) {
    case 'baseline': {
      if (!learnerRating) {
        const placement = placeFromBaseline(
          card,
          {
            correct: base.result,
            answerMs: base.answerMs,
            hintUsed: base.hintUsed,
            hintImposed: base.hintImposed,
            itemType: card.itemType,
            format: base.format,
          },
          at,
          'day-1',
          scheduler,
        )
        return { card: placement.card, log: placement.log, result: base.result }
      }
      if (!isNew(card)) break
      const knew = rating === Rating.Good || rating === Rating.Easy
      if (knew && !helped) {
        return withResult(
          scheduler.review(card, Rating.Easy, at, {
            context,
            proposed: null,
            result: 'right',
            helped: false,
          }),
        )
      }
      const partial =
        rating === Rating.Hard && base.result === 'partial' && base.gradedBy !== 'self'
      return { card, log: null, result: partial ? 'partial' : resultOf(rating) }
    }

    case 'mic-practice':
      if (rating === Rating.Again) return withResult(scheduler.missedInPractice(card, at))
      break
    case 'study':
      break
  }

  if (base.gradedBy === 'self') {
    return withResult(
      scheduler.review(card, rating, at, {
        context,
        proposed: null,
        helped,
        format: base.format,
      }),
    )
  }

  const graded = scheduler.review(card, base.proposedRating, at, {
    context,
    proposed: base.proposedRating,
    result: base.result,
    helped,

    format: base.format,
  })
  return withResult(applyOverride(graded, rating, scheduler))
}

export function replayItem(
  meta: ItemMeta,
  events: readonly StoredEvent[],
  scheduler: Scheduler = defaultScheduler,
): Replayed {
  const groups = answerGroups(events)
  let card = newCard(meta, groups[0]?.at ?? new Date(0))
  const answers: Answer[] = []
  const refused: string[] = []
  for (const group of groups) {
    const eventIds = group.events.map((event) => event.id)
    try {
      const applied = applyAnswer(card, group, scheduler)
      card = applied.card
      answers.push({
        itemId: meta.itemId,
        eventIds,
        context: contextOf(group.events[0].mode),
        at: group.at,
        result: applied.result,
        log: applied.log,
      })
    } catch (error) {
      refused.push(...eventIds)
      console.error(`replay: card ${meta.itemId} refused events ${eventIds.join(',')}`, error)
    }
  }
  return { card, answers, refused }
}

export function replayItems(
  metas: ReadonlyMap<string, ItemMeta>,
  events: readonly StoredEvent[],
  scheduler: Scheduler = defaultScheduler,
): Map<string, Replayed> {
  const byItem = new Map<string, StoredEvent[]>()
  for (const event of events) {
    const list = byItem.get(event.itemId)
    if (list) list.push(event)
    else byItem.set(event.itemId, [event])
  }
  const replayed = new Map<string, Replayed>()
  for (const [itemId, list] of byItem) {
    const meta = metas.get(itemId)
    if (meta) replayed.set(itemId, replayItem(meta, list, scheduler))
  }
  return replayed
}
