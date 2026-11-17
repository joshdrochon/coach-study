import { Rating } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'

import { fixed, graduated, makeCard, T0 } from '@/test/scheduler-fixtures'

import { addDays } from './calendar'
import { GRADES } from './fsrs'
import { applyOverride, FAST_ANSWER_MS, proposeRating, reviewAnswer } from './rating'
import type { RatingInput } from './types'

const answer = (overrides: Partial<RatingInput> = {}): RatingInput => ({
  correct: 'right',
  answerMs: 6_000,
  hintUsed: false,
  itemType: 'recall',
  ...overrides,
})

describe('proposeRating', () => {
  it('scores a wrong answer Missed it', () => {
    expect(proposeRating(answer({ correct: 'wrong' }))).toBe(Rating.Again)
    expect(proposeRating(answer({ correct: 'wrong', answerMs: 500 }))).toBe(Rating.Again)
  })

  it('scores a partial answer Tough, and Missed it when the learner needed help', () => {
    expect(proposeRating(answer({ correct: 'partial' }))).toBe(Rating.Hard)
    expect(proposeRating(answer({ correct: 'partial', hintUsed: true }))).toBe(Rating.Again)
    expect(proposeRating(answer({ correct: 'partial', format: 'choices' }))).toBe(Rating.Again)
  })

  it('scores a right answer at a normal pace Got it', () => {
    expect(proposeRating(answer())).toBe(Rating.Good)
    expect(proposeRating(answer({ format: 'free' }))).toBe(Rating.Good)
  })

  it('does not cap a correct answer when the app offered the hint first', () => {
    expect(proposeRating(answer({ hintUsed: true, hintImposed: true }))).toBe(Rating.Good)
    expect(proposeRating(answer({ hintUsed: true, hintImposed: true, answerMs: 1_000 }))).toBe(
      Rating.Easy,
    )
    expect(proposeRating(answer({ correct: 'partial', hintUsed: true, hintImposed: true }))).toBe(
      Rating.Hard,
    )

    expect(proposeRating(answer({ hintUsed: true, hintImposed: true, format: 'choices' }))).toBe(
      Rating.Hard,
    )
  })

  it('caps a right pick from choices at Tough: recognising is easier than recalling', () => {
    expect(proposeRating(answer({ format: 'choices', answerMs: 1_000 }))).toBe(Rating.Hard)
  })

  it('gives longer formats more time', () => {
    expect(FAST_ANSWER_MS.recall).toBeLessThan(FAST_ANSWER_MS.list)
    expect(FAST_ANSWER_MS.list).toBeLessThan(FAST_ANSWER_MS.cue)
    expect(FAST_ANSWER_MS.cue).toBeLessThan(FAST_ANSWER_MS.scenario)

    expect(proposeRating(answer({ itemType: 'cue', answerMs: 10_000 }))).toBe(Rating.Easy)
    expect(proposeRating(answer({ itemType: 'recall', answerMs: 10_000 }))).toBe(Rating.Good)
  })

  it('rejects an answer that breaks the contract', () => {
    expect(() => proposeRating(answer({ answerMs: -1 }))).toThrow()
    expect(() => proposeRating(answer({ answerMs: Number.NaN }))).toThrow()
  })
})

describe('reviewAnswer', () => {
  it('puts the proposed rating on the schedule and logs the judgment and any help', () => {
    const card = makeCard('sample move a-parts')
    const hinted = reviewAnswer(card, answer({ hintUsed: true }), T0, fixed)
    expect(hinted.log).toMatchObject({
      context: 'study',
      proposed: Rating.Hard,
      result: 'right',
      helped: true,
    })
    expect(hinted.card).toEqual(fixed.review(card, Rating.Hard, T0).card)
    expect(reviewAnswer(card, answer({ correct: 'partial' }), T0, fixed).log).toMatchObject({
      proposed: Rating.Hard,
      result: 'partial',
      helped: false,
    })
    expect(reviewAnswer(card, answer({ format: 'choices' }), T0).log).toMatchObject({
      helped: true,
      format: 'choices',
    })
    expect(reviewAnswer(card, answer(), T0, fixed).log.format).toBe('free')
    const imposed = reviewAnswer(card, answer({ hintUsed: true, hintImposed: true }), T0, fixed)
    expect(imposed.log).toMatchObject({ proposed: Rating.Good, result: 'right', helped: true })
    expect(reviewAnswer(card, answer(), T0, fixed).log.helped).toBe(false)
    expect(reviewAnswer(card, answer(), T0, fixed, { context: 'baseline' }).log.context).toBe(
      'baseline',
    )
  })
})

describe('applyOverride', () => {
  const card = graduated(makeCard('sample move a-parts'), T0).card
  const at = addDays(T0, 2)

  it('keeps the review when the learner picks the proposed rating', () => {
    const proposed = fixed.review(card, Rating.Good, at, { proposed: Rating.Good })
    const result = applyOverride(proposed, Rating.Good, fixed)
    expect(result.overridden).toBe(false)
    expect(result.card).toEqual(proposed.card)
    expect(result.log).toEqual(proposed.log)
  })

  it('reschedules with their rating and keeps the tutor proposal in the log', () => {
    for (const chosen of GRADES.filter((grade) => grade !== Rating.Good)) {
      const proposed = fixed.review(card, Rating.Good, at, { proposed: Rating.Good })
      const result = applyOverride(proposed, chosen, fixed)
      const direct = fixed.review(card, chosen, at, { proposed: Rating.Good })
      expect(result.overridden).toBe(true)
      expect(result.card).toEqual(direct.card)
      expect(result.log.fsrs.rating).toBe(chosen)
      expect(result.log.proposed).toBe(Rating.Good)
    }
  })

  it("compares their final rating with the tutor's proposal, however many times the learner changes it", () => {
    const proposed = fixed.review(card, Rating.Good, at, { proposed: Rating.Good })
    const tough = applyOverride(proposed, Rating.Hard, fixed)
    expect(tough.overridden).toBe(true)
    const back = applyOverride(tough, Rating.Good, fixed)
    expect(back.overridden).toBe(false)
    expect(back.card).toEqual(proposed.card)
    expect(back.log).toEqual(proposed.log)

    expect(applyOverride(tough, Rating.Hard, fixed).overridden).toBe(true)
  })

  it('never counts their own rating as an override when the tutor proposed nothing', () => {
    const selfRated = fixed.review(card, Rating.Hard, at)
    expect(applyOverride(selfRated, Rating.Easy, fixed)).toMatchObject({
      overridden: false,
      log: { proposed: null, fsrs: { rating: Rating.Easy } },
    })
  })

  it('moves the next review the way the learner asked', () => {
    const proposed = fixed.review(card, Rating.Good, at, { proposed: Rating.Good })
    const tough = applyOverride(proposed, Rating.Hard, fixed).card.fsrs.due
    const easy = applyOverride(proposed, Rating.Easy, fixed).card.fsrs.due
    expect(tough.getTime()).toBeLessThan(proposed.card.fsrs.due.getTime())
    expect(easy.getTime()).toBeGreaterThan(proposed.card.fsrs.due.getTime())
  })

  it('uses the app scheduler by default', () => {
    const proposed = fixed.review(card, Rating.Good, at, { proposed: Rating.Good })
    expect(applyOverride(proposed, Rating.Again).card.fsrs.state).toBe(
      fixed.review(card, Rating.Again, at).card.fsrs.state,
    )
  })
})
