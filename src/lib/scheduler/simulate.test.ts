import { State } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'

import { makeCard, T0 } from '@/test/scheduler-fixtures'

import { addDays, addMinutes } from './calendar'
import { createScheduler, TARGET_RETENTION } from './fsrs'
import { reviewAnswer } from './rating'
import { seededRandom } from './seeded'
import type { SchedulerCard } from './types'

const STEADY_MS = 6_000

function answer(card: SchedulerCard, right: boolean, now: Date, scheduler = createScheduler()) {
  return reviewAnswer(
    card,
    {
      correct: right ? 'right' : 'wrong',
      answerMs: STEADY_MS,
      hintUsed: false,
      hintImposed: false,
      itemType: card.itemType,
      format: 'free',
    },
    now,
    scheduler,
  ).card
}

function untilReview(
  card: SchedulerCard,
  from: Date,
  scheduler: ReturnType<typeof createScheduler>,
) {
  let now = from
  let current = card
  while (current.fsrs.state !== State.Review) {
    current = answer(current, true, now, scheduler)
    now = current.fsrs.due > now ? current.fsrs.due : addMinutes(now, 1)
  }
  return current
}

describe('a simulated learner on due reviews alone', () => {
  it('scores between 85% and 95% over 30 days (target retention 0.90)', () => {
    expect(TARGET_RETENTION).toBe(0.9)
    const scheduler = createScheduler()
    const random = seededRandom('due-reviews-30-days')
    let cards = Array.from({ length: 400 }, (_, i) =>
      untilReview(makeCard(`sim-${String(i)}`, { position: i }), T0, scheduler),
    )
    let shown = 0
    let right = 0
    for (let day = 1; day <= 30; day += 1) {
      const now = addMinutes(addDays(T0, day), 12 * 60)
      cards = cards.map((card) => {
        if (card.fsrs.state !== State.Review || card.fsrs.due > now) return card
        const recalled = random() < scheduler.retrievability(card, now)
        shown += 1
        if (recalled) right += 1
        const after = answer(card, recalled, now, scheduler)

        return recalled ? after : untilReview(after, now, scheduler)
      })
    }
    const accuracy = right / shown
    console.log(
      `due reviews over 30 days: ${String(shown)}, right ${String(right)} (${(accuracy * 100).toFixed(1)}%)`,
    )
    expect(shown).toBeGreaterThan(800)
    expect(accuracy).toBeGreaterThanOrEqual(0.85)
    expect(accuracy).toBeLessThanOrEqual(0.95)
  })
})
