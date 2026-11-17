import { fsrs, Rating, State, type Grade } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { fixed, graduated, makeCard, T0 } from '@/test/scheduler-fixtures'

import { addDays, addMinutes } from './calendar'
import {
  createScheduler,
  defaultScheduler,
  dueAt,
  GRADES,
  isLearning,
  isNew,
  LEARNING_STEPS,
  newCard,
  RATING_LABELS,
  ratingFromLabel,
  ratingLabel,
  RELEARNING_STEPS,
  resultOf,
  retrievability,
  review,
} from './fsrs'
import { reviewLogSchema, schedulerCardSchema, type SchedulerCard } from './types'

const minutesUntilDue = (card: SchedulerCard, from: Date): number =>
  Math.round((card.fsrs.due.getTime() - from.getTime()) / 60_000)

describe('target retention', () => {
  it('schedules a card for when their predicted recall drops to about 90%', () => {
    let card = graduated(makeCard('sample move a-parts'), T0).card

    for (let i = 0; i < 4; i += 1) {
      const recallAtDue = fixed.retrievability(card, card.fsrs.due)
      expect(recallAtDue).toBeGreaterThan(0.88)
      expect(recallAtDue).toBeLessThan(0.93)
      card = fixed.review(card, Rating.Good, card.fsrs.due).card
    }
  })
})

describe('labels on their screen', () => {
  it('reads a label back into its rating', () => {
    for (const grade of GRADES) expect(ratingFromLabel(ratingLabel(grade))).toBe(grade)
    expect(ratingFromLabel('Again')).toBeNull()
    expect(ratingFromLabel('Good')).toBeNull()
  })

  it('never shows FSRS jargon', () => {
    const labels = Object.values(RATING_LABELS).join(' ')
    expect(labels).not.toMatch(/again|hard|good|retention|recall|stability/i)
  })
})

describe('newCard', () => {
  it('fills in the optional fields', () => {
    const card = newCard(
      {
        itemId: 'sample move a-parts',
        category: 'Floor work',
        itemType: 'recall',
        position: 3,
      },
      T0,
    )
    expect(card).toMatchObject({ topic: null, hasChoices: false, quarantined: false, position: 3 })
    expect(card.fsrs.due).toEqual(T0)
    expect(card.fsrs.last_review).toBeUndefined()
  })

  it('starts new, unscheduled and in rotation', () => {
    const card = makeCard('rsg-order', { category: 'Glossary', itemType: 'list' })
    expect(card.fsrs.state).toBe(State.New)
    expect(card.fsrs.reps).toBe(0)
    expect(card.quarantined).toBe(false)
    expect(card.topic).toBeNull()
    expect(card.hasChoices).toBe(false)
    expect(isNew(card)).toBe(true)
    expect(isLearning(card)).toBe(false)
    expect(dueAt(card)).toBeNull()
    expect(schedulerCardSchema.parse(card)).toEqual(card)
  })
})

describe('successive relearning', () => {
  it('uses 1- and 10-minute learning steps and a 10-minute relearning step', () => {
    expect(LEARNING_STEPS).toEqual(['1m', '10m'])
    expect(RELEARNING_STEPS).toEqual(['10m'])
  })

  it('brings a new card back within the session until the learner gets it right', () => {
    const card = makeCard('sample move a-parts')
    const missed = fixed.review(card, Rating.Again, T0).card
    expect(missed.fsrs.state).toBe(State.Learning)
    expect(minutesUntilDue(missed, T0)).toBe(1)

    const tough = fixed.review(missed, Rating.Hard, addMinutes(T0, 1)).card
    expect(tough.fsrs.state).toBe(State.Learning)
    expect(tough.fsrs.learning_steps).toBe(0)

    const once = fixed.review(tough, Rating.Good, addMinutes(T0, 7)).card
    expect(once.fsrs.state).toBe(State.Learning)
    expect(minutesUntilDue(once, addMinutes(T0, 7))).toBe(10)

    const twice = fixed.review(once, Rating.Good, addMinutes(T0, 17)).card
    expect(twice.fsrs.state).toBe(State.Review)
    expect(twice.fsrs.scheduled_days).toBeGreaterThanOrEqual(1)
  })

  it('never lets a card leave the learning queue on Missed it or Tough', () => {
    const wrong: Grade[] = [Rating.Again, Rating.Hard]
    for (const a of wrong) {
      for (const b of wrong) {
        for (const c of wrong) {
          let card = makeCard('countdown')
          let at = T0
          const answers: Grade[] = [a, b, c, Rating.Hard]
          for (const rating of answers) {
            card = fixed.review(card, rating, at).card
            expect(card.fsrs.state).toBe(State.Learning)
            at = addMinutes(at, 15)
          }
        }
      }
    }
  })

  it('moves a card the learner already knows straight to the long-term schedule on Easy', () => {
    const card = fixed.review(makeCard('band-load'), Rating.Easy, T0).card
    expect(card.fsrs.state).toBe(State.Review)
    expect(card.fsrs.scheduled_days).toBe(8)
  })

  it('relearns a forgotten card within the session before it goes back on the schedule', () => {
    const learned = graduated(makeCard('sample move a-parts'), T0).card
    const at = learned.fsrs.due
    const lapsed = fixed.review(learned, Rating.Again, at).card
    expect(lapsed.fsrs.state).toBe(State.Relearning)
    expect(lapsed.fsrs.lapses).toBe(1)
    expect(minutesUntilDue(lapsed, at)).toBe(10)
    expect(isLearning(lapsed)).toBe(true)

    const relearned = fixed.review(lapsed, Rating.Good, addMinutes(at, 10)).card
    expect(relearned.fsrs.state).toBe(State.Review)
  })
})

describe('review', () => {
  it('returns a log tagged with the item, context and the tutor proposal', () => {
    const card = makeCard('sample move a-parts')
    const { log } = fixed.review(card, Rating.Good, T0, { proposed: Rating.Good })
    expect(log).toMatchObject({
      itemId: 'sample move a-parts',
      context: 'study',
      proposed: Rating.Good,
    })
    expect(log.fsrs.rating).toBe(Rating.Good)
    expect(log.fsrs.state).toBe(State.New)
    expect(log.fsrs.review).toEqual(T0)
    expect(reviewLogSchema.parse(log)).toEqual(log)

    const self = fixed.review(card, Rating.Hard, T0, { context: 'baseline' }).log
    expect(self.context).toBe('baseline')
    expect(self.proposed).toBeNull()
  })

  it('never changes the card it was given or shares dates with it', () => {
    const card = graduated(makeCard('sample move a-parts'), T0).card
    const snapshot = structuredClone(card)
    const now = addDays(T0, 3)
    const result = fixed.review(card, Rating.Good, now)
    expect(card).toEqual(snapshot)
    now.setTime(0)
    expect(result.card.fsrs.last_review).toEqual(addDays(T0, 3))
    expect(result.log.fsrs.review).toEqual(addDays(T0, 3))
  })

  it("refuses an answer older than the card's last review", () => {
    const card = fixed.review(makeCard('sample move a-parts'), Rating.Good, T0).card
    expect(() => fixed.review(card, Rating.Good, addMinutes(T0, -1))).toThrow(
      /before its last review/,
    )
    expect(fixed.review(card, Rating.Good, T0).card.fsrs.reps).toBe(2)
  })

  it('keeps the item metadata', () => {
    const card = makeCard('cue-sample move a', {
      category: 'Coaching voice',
      itemType: 'cue',
      topic: 'sample move a',
      hasChoices: true,
    })
    const next = fixed.review(card, Rating.Good, T0).card
    expect(next).toMatchObject({
      itemId: 'cue-sample move a',
      category: 'Coaching voice',
      itemType: 'cue',
      topic: 'sample move a',
      hasChoices: true,
    })
  })
})

describe('changeRating', () => {
  const cases: { name: string; card: () => SchedulerCard; at: Date }[] = [
    { name: 'a new card', card: () => makeCard('a'), at: T0 },
    {
      name: 'a learning card',
      card: () => fixed.review(makeCard('b'), Rating.Good, T0).card,
      at: addMinutes(T0, 10),
    },
    { name: 'a review card', card: () => graduated(makeCard('c'), T0).card, at: addDays(T0, 3) },
  ]

  for (const { name, card, at } of cases) {
    it(`gives exactly what their rating would have given, for ${name}`, () => {
      const before = card()
      for (const proposed of GRADES) {
        const first = fixed.review(before, proposed, at, { proposed })
        for (const chosen of GRADES) {
          const changed = fixed.changeRating(first.card, first.log, chosen)
          const direct = fixed.review(before, chosen, at, { proposed })
          expect(changed.card).toEqual(direct.card)
          expect(changed.log.fsrs).toEqual(direct.log.fsrs)
          expect(changed.log.proposed).toBe(proposed)

          expect(changed.log.graded).toBe(first.log.graded)
        }
      }
    })
  }

  it('refuses a log that is not the latest review of that card', () => {
    const first = fixed.review(makeCard('a'), Rating.Good, T0)
    const second = fixed.review(first.card, Rating.Good, addMinutes(T0, 10))
    expect(() => fixed.changeRating(second.card, first.log, Rating.Hard)).toThrow(/latest review/)
    const other = fixed.review(makeCard('b'), Rating.Good, addMinutes(T0, 10))
    expect(() => fixed.changeRating(second.card, other.log, Rating.Hard)).toThrow(/latest review/)
    expect(() => fixed.changeRating(makeCard('a'), first.log, Rating.Hard)).toThrow(/latest review/)
  })
})

describe('the judgment in the log', () => {
  it('records how the answer was judged and whether the learner had help', () => {
    const card = makeCard('a')
    expect(
      fixed.review(card, Rating.Hard, T0, { result: 'right', helped: true }).log,
    ).toMatchObject({
      result: 'right',
      helped: true,
    })

    expect(fixed.review(card, Rating.Again, T0).log).toMatchObject({
      result: 'wrong',
      graded: 'wrong',
      helped: false,
    })
    expect(fixed.review(card, Rating.Hard, T0).log.result).toBe('right')
    expect(fixed.review(card, Rating.Hard, T0).log.format).toBe('free')
    expect(fixed.review(card, Rating.Hard, T0, { format: 'choices' }).log.format).toBe('choices')
    expect(GRADES.map(resultOf)).toEqual(['wrong', 'right', 'right', 'right'])
  })

  it('follows their rating when the learner changes it, keeping a partial judgment on Tough', () => {
    const card = graduated(makeCard('a'), T0).card
    const at = addDays(T0, 2)
    const partial = fixed.review(card, Rating.Hard, at, {
      proposed: Rating.Hard,
      result: 'partial',
    })
    expect(fixed.changeRating(partial.card, partial.log, Rating.Good).log.result).toBe('right')
    expect(fixed.changeRating(partial.card, partial.log, Rating.Again).log.result).toBe('wrong')
    expect(fixed.changeRating(partial.card, partial.log, Rating.Hard).log.result).toBe('partial')

    const good = fixed.changeRating(partial.card, partial.log, Rating.Good)
    expect(good.log).toMatchObject({ result: 'right', graded: 'partial' })
    expect(fixed.changeRating(good.card, good.log, Rating.Hard).log).toMatchObject({
      result: 'partial',
      graded: 'partial',
    })
    const right = fixed.review(card, Rating.Good, at, { proposed: Rating.Good, result: 'right' })
    expect(fixed.changeRating(right.card, right.log, Rating.Hard).log.result).toBe('right')
    const wrong = fixed.review(card, Rating.Again, at, { proposed: Rating.Again, result: 'wrong' })

    expect(fixed.changeRating(wrong.card, wrong.log, Rating.Hard).log).toMatchObject({
      result: 'right',
      proposed: Rating.Again,
    })
    const helped = fixed.review(card, Rating.Hard, at, {
      result: 'right',
      helped: true,
      format: 'choices',
    })
    expect(fixed.changeRating(helped.card, helped.log, Rating.Good).log).toMatchObject({
      helped: true,
      format: 'choices',
    })
  })
})

describe('missedInPractice', () => {
  it('puts a missed must-do card into the learning steps, due in a minute', () => {
    const { card, log } = fixed.missedInPractice(makeCard('pace-order'), T0)
    expect(card.fsrs.state).toBe(State.Learning)
    expect(minutesUntilDue(card, T0)).toBe(1)
    expect(log).toMatchObject({
      context: 'mic-practice',
      proposed: null,
      result: 'wrong',
      helped: false,
    })
    expect(log.fsrs.rating).toBe(Rating.Again)
  })

  it('sends a learned card back to relearning', () => {
    const learned = graduated(makeCard('pace-order'), T0).card
    const { card } = fixed.missedInPractice(learned, addDays(T0, 1))
    expect(card.fsrs.state).toBe(State.Relearning)
    expect(card.fsrs.lapses).toBe(1)
  })
})

describe('retrievability (predicted recall)', () => {
  it('is 0 for a card the learner has never seen', () => {
    expect(fixed.retrievability(makeCard('a'), T0)).toBe(0)
  })

  it('is 1 right after a review and falls as days pass', () => {
    const card = graduated(makeCard('a'), T0).card
    const reviewed = addMinutes(T0, 10)
    expect(fixed.retrievability(card, reviewed)).toBe(1)
    const values = [1, 2, 5, 10, 30].map((d) => fixed.retrievability(card, addDays(reviewed, d)))
    expect(values).toEqual(values.toSorted((a, b) => b - a))
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('retrievability within the day', () => {
  it('drops soon after the learner misses a card, instead of reading 100% for a day', () => {
    const missed = fixed.review(makeCard('a'), Rating.Again, T0).card
    const values = [0, 1, 6, 12, 23].map((hours) =>
      fixed.retrievability(missed, addMinutes(T0, hours * 60)),
    )
    expect(values[0]).toBe(1)
    expect(values).toEqual(values.toSorted((a, b) => b - a))
    expect(values[4]).toBeLessThan(0.9)
  })

  it('matches ts-fsrs get_retrievability on whole days', () => {
    const engine = fsrs({ enable_fuzz: false })
    const card = graduated(makeCard('a'), T0).card
    for (const days of [1, 2, 7, 30]) {
      const at = addDays(card.fsrs.last_review ?? T0, days)
      expect(fixed.retrievability(card, at)).toBeCloseTo(
        engine.get_retrievability(card.fsrs, at, false),
        8,
      )
    }
  })
})

describe('dueAt', () => {
  it('is the scheduled date, as a copy', () => {
    const card = fixed.review(makeCard('a'), Rating.Good, T0).card
    const due = dueAt(card)
    expect(due).toEqual(addMinutes(T0, 10))
    due?.setTime(0)
    expect(card.fsrs.due).toEqual(addMinutes(T0, 10))
  })
})

describe('plain functions', () => {
  it('use the app scheduler', () => {
    const card = graduated(makeCard('a'), T0).card
    const at = addDays(T0, 2)
    expect(review(card, Rating.Again, at)).toEqual(defaultScheduler.review(card, Rating.Again, at))
    expect(retrievability(card, at)).toBe(fixed.retrievability(card, at))
  })
})

describe('fuzz', () => {
  it('is on in the app and repeatable for the same card and moment', () => {
    expect(defaultScheduler.parameters.enable_fuzz).toBe(true)
    expect(fixed.parameters.enable_fuzz).toBe(false)
    const fuzzy = createScheduler()
    const card = graduated(makeCard('a'), T0).card
    const at = addDays(T0, 2)
    const one = fuzzy.review(card, Rating.Good, at)
    const two = fuzzy.review(card, Rating.Good, at)
    expect(one).toEqual(two)
    const exact = fixed.review(card, Rating.Good, at).card.fsrs.scheduled_days
    expect(Math.abs(one.card.fsrs.scheduled_days - exact)).toBeLessThanOrEqual(2)
  })
})

describe('persistence', () => {
  it('survives a JSON round trip (the iPad copy) and a database round trip', () => {
    const { card, log } = fixed.review(
      graduated(makeCard('a'), T0).card,
      Rating.Hard,
      addDays(T0, 2),
    )
    const fromJson: unknown = JSON.parse(JSON.stringify({ card, log }))
    const stored = z.object({ card: schedulerCardSchema, log: reviewLogSchema })
    expect(stored.parse(fromJson)).toEqual({ card, log })

    const fresh = makeCard('b')
    const row = { ...fresh, fsrs: { ...fresh.fsrs, last_review: null } }
    expect(schedulerCardSchema.parse(row)).toEqual(fresh)
  })

  it('rejects malformed state', () => {
    const card = makeCard('a')
    expect(schedulerCardSchema.safeParse({ ...card, itemType: 'essay' }).success).toBe(false)
    expect(
      schedulerCardSchema.safeParse({ ...card, fsrs: { ...card.fsrs, due: 'yesterday' } }).success,
    ).toBe(false)
    expect(
      schedulerCardSchema.safeParse({ ...card, fsrs: { ...card.fsrs, state: 9 } }).success,
    ).toBe(false)
  })
})
