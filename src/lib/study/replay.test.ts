import { Rating, State } from 'ts-fsrs'
import { describe, expect, it, vi } from 'vitest'

import { createScheduler, newCard, type Scheduler } from '@/lib/scheduler/fsrs'
import { at, DAY, meta, MINUTE, stored, T0 } from '@/test/study-fixtures'

import { answerGroups, replayItem, replayItems } from './replay'

const fixed = createScheduler({ enableFuzz: false })
const fuzzed = createScheduler()
const card = meta('card-a')

describe('replayItem: study answers', () => {
  it('puts the tutor’s proposal on the schedule and keeps it in the log', () => {
    const { card: replayed, answers } = replayItem(card, [stored()], fixed)
    const direct = fixed.review(newCard(card, T0), Rating.Good, T0)
    expect(replayed.fsrs).toEqual(direct.card.fsrs)
    expect(answers).toHaveLength(1)
    expect(answers[0]?.log).toMatchObject({
      itemId: 'card-a',
      context: 'study',
      proposed: Rating.Good,
      result: 'right',
      helped: false,
    })
  })

  it('counts a hint or pick-from-choices as help', () => {
    const hinted = replayItem(card, [
      stored({ hintUsed: true, rating: Rating.Hard, proposedRating: Rating.Hard }),
    ])
    const choices = replayItem(card, [
      stored({ format: 'choices', rating: Rating.Hard, proposedRating: Rating.Hard }),
    ])
    expect(hinted.answers[0]?.log?.helped).toBe(true)
    expect(choices.answers[0]?.log?.helped).toBe(true)
  })

  it('counts a hint the app read first as help too, while their Got it stands', () => {
    const imposed = stored({ hintUsed: true, hintImposed: true })
    const { card: replayed, answers } = replayItem(card, [imposed], fixed)
    expect(answers[0]?.log).toMatchObject({ helped: true, result: 'right', graded: 'right' })
    expect(replayed.fsrs).toEqual(fixed.review(newCard(card, T0), Rating.Good, T0).card.fsrs)
  })

  it('takes their own rating when the learner graded it themselves, with no proposal', () => {
    const { answers } = replayItem(
      card,
      [
        stored({
          gradedBy: 'self',
          rating: Rating.Hard,
          proposedRating: Rating.Hard,
          result: 'partial',
        }),
      ],
      fixed,
    )
    expect(answers[0]?.log).toMatchObject({ proposed: null, result: 'right' })
    expect(answers[0]?.log?.fsrs.rating).toBe(Rating.Hard)
  })

  it('ends as if the learner had picked their rating when the learner changed it before saving', () => {
    const event = stored({ rating: Rating.Again, proposedRating: Rating.Good, overridden: true })
    const { card: replayed, answers } = replayItem(card, [event], fixed)
    expect(replayed.fsrs).toEqual(fixed.review(newCard(card, T0), Rating.Again, T0).card.fsrs)
    expect(answers[0]?.log).toMatchObject({ proposed: Rating.Good, result: 'wrong' })
  })

  it('keeps a partial answer partial when the learner lowers it to Tough', () => {
    const event = stored({
      result: 'partial',
      rating: Rating.Hard,
      proposedRating: Rating.Good,
      overridden: true,
    })
    expect(replayItem(card, [event], fixed).answers[0]?.log?.result).toBe('partial')
  })
})

describe('replayItem: a rating changed later', () => {
  const answer = stored({ id: 'answer', reviewedAt: at(0) })
  const change = stored({
    id: 'change',
    reviewedAt: at(0),
    receivedAt: at(2 * MINUTE),
    rating: Rating.Again,
    overridden: true,
  })

  it('is one answer whose card ends as if the learner had picked the new rating', () => {
    const { card: replayed, answers } = replayItem(card, [answer, change], fixed)
    expect(replayed.fsrs).toEqual(fixed.review(newCard(card, T0), Rating.Again, T0).card.fsrs)
    expect(answers).toHaveLength(1)
    expect(answers[0]?.eventIds).toEqual(['answer', 'change'])
    expect(answers[0]?.log).toMatchObject({ proposed: Rating.Good, result: 'wrong' })
  })

  it('still comes after its answer when it reaches the server first', () => {
    const early = { ...change, receivedAt: at(MINUTE) }
    const late = { ...answer, receivedAt: at(3 * MINUTE) }
    const replayed = replayItem(card, [early, late], fixed)
    expect(replayed.card.fsrs.state).toBe(State.Learning)
    expect(replayed.answers[0]?.log?.fsrs.rating).toBe(Rating.Again)
    expect(replayed.answers[0]?.eventIds).toEqual(['answer', 'change'])
  })

  it('applies their changes in the order the learner made them, whatever order they arrive in', () => {
    const tough = stored({
      ...change,
      id: 'tough',
      rating: Rating.Hard,
      changedAt: at(MINUTE),
      receivedAt: at(5 * MINUTE),
    })
    const easy = stored({
      ...change,
      id: 'easy',
      rating: Rating.Easy,
      changedAt: at(2 * MINUTE),
      receivedAt: at(3 * MINUTE),
    })
    const replayed = replayItem(card, [answer, easy, tough], fixed)
    expect(replayed.answers[0]?.eventIds).toEqual(['answer', 'tough', 'easy'])
    expect(replayed.answers[0]?.log?.fsrs.rating).toBe(Rating.Easy)
  })

  it('takes the last change the learner made', () => {
    const second = stored({
      ...change,
      id: 'second',
      receivedAt: at(4 * MINUTE),
      rating: Rating.Easy,
    })
    const replayed = replayItem(card, [second, answer, change], fixed)
    expect(replayed.answers[0]?.log?.fsrs.rating).toBe(Rating.Easy)
    expect(replayed.card.fsrs).toEqual(fixed.review(newCard(card, T0), Rating.Easy, T0).card.fsrs)
  })

  it('keeps the grader’s judgment however often the learner changes it', () => {
    const partial = stored({
      id: 'partial',
      result: 'partial',
      rating: Rating.Hard,
      proposedRating: Rating.Hard,
    })
    const up = stored({
      id: 'up',
      result: 'partial',
      rating: Rating.Good,
      proposedRating: Rating.Hard,
      overridden: true,
      receivedAt: at(MINUTE),
    })
    const back = stored({ ...up, id: 'back', rating: Rating.Hard, receivedAt: at(2 * MINUTE) })
    const raised = replayItem(card, [partial, up], fixed).answers[0]?.log
    expect(raised).toMatchObject({ result: 'right', graded: 'partial', proposed: Rating.Hard })
    const lowered = replayItem(card, [partial, up, back], fixed).answers[0]?.log
    expect(lowered).toMatchObject({ result: 'partial', graded: 'partial', proposed: Rating.Hard })

    const missed = stored({ ...up, id: 'missed', result: 'right', rating: Rating.Again })
    const right = stored({ id: 'right' })
    expect(replayItem(card, [right, missed], fixed).answers[0]?.log).toMatchObject({
      result: 'wrong',
      graded: 'right',
    })
  })

  it('changes that answer even after later answers, which are replayed on top', () => {
    const later = stored({ id: 'later', reviewedAt: at(15 * MINUTE) })
    const lateChange = { ...change, receivedAt: at(20 * MINUTE) }
    const replayed = replayItem(card, [answer, later, lateChange], fixed)
    const first = fixed.review(newCard(card, T0), Rating.Again, T0)
    const second = fixed.review(first.card, Rating.Good, at(15 * MINUTE))
    expect(replayed.card.fsrs).toEqual(second.card.fsrs)
    expect(replayed.answers.map((entry) => entry.eventIds)).toEqual([
      ['answer', 'change'],
      ['later'],
    ])
  })
})

describe('replayItem: order', () => {
  const events = [
    stored({
      id: 'e1',
      reviewedAt: at(0),
      rating: Rating.Again,
      proposedRating: Rating.Again,
      result: 'wrong',
    }),
    stored({ id: 'e2', reviewedAt: at(MINUTE) }),
    stored({ id: 'e3', reviewedAt: at(11 * MINUTE) }),
    stored({ id: 'e4', reviewedAt: at(3 * DAY), rating: Rating.Easy, proposedRating: Rating.Easy }),
  ]

  it('gives the same card whatever order the events arrived in (replay in order)', () => {
    const inOrder = replayItem(card, events, fuzzed)
    const shuffled = replayItem(
      card,
      [events[3], events[1], events[0], events[2]].flatMap((event) => (event ? [event] : [])),
      fuzzed,
    )
    expect(shuffled).toEqual(inOrder)
    expect(inOrder.answers.map((entry) => entry.eventIds[0])).toEqual(['e1', 'e2', 'e3', 'e4'])
    expect(inOrder.card.fsrs.reps).toBe(4)
  })

  it('counts an answer from an iPad clock that runs ahead as given when it arrived', () => {
    const ahead = stored({ reviewedAt: at(DAY), receivedAt: at(MINUTE) })
    const { card: replayed, answers } = replayItem(card, [ahead], fixed)
    expect(answers[0]?.at).toEqual(at(MINUTE))
    expect(replayed.fsrs.last_review).toEqual(at(MINUTE))
  })

  it('orders answers that count as given at the same moment by when the learner gave them', () => {
    const a = stored({ id: 'b-later', reviewedAt: at(2 * MINUTE), receivedAt: at(MINUTE) })
    const b = stored({ id: 'a-first', reviewedAt: at(MINUTE), receivedAt: at(MINUTE) })
    const c = stored({ id: 'c', reviewedAt: at(MINUTE), receivedAt: at(MINUTE), overridden: true })
    const groups = answerGroups([a, b, c])
    expect(groups.map((group) => group.events.map((event) => event.id))).toEqual([
      ['a-first', 'c'],
      ['b-later'],
    ])
    const tie = answerGroups([
      stored({ id: 'z', reviewedAt: at(3 * MINUTE), receivedAt: at(MINUTE) }),
      stored({ id: 'y', reviewedAt: at(3 * MINUTE + 1), receivedAt: at(MINUTE) }),
      stored({ id: 'x', reviewedAt: at(3 * MINUTE), receivedAt: at(MINUTE) }),
    ])
    expect(tie.map((group) => group.events[0].id)).toEqual(['x', 'y'])
  })

  it('is a new card when there are no answers', () => {
    const replayed = replayItem(card, [], fixed)
    expect(replayed.card.fsrs.state).toBe(State.New)
    expect(replayed.answers).toEqual([])
  })
})

describe('replayItem: baseline', () => {
  const baseline = (overrides: Parameters<typeof stored>[0] = {}) =>
    stored({ mode: 'baseline', gradedBy: 'tutor', answerMs: 6000, ...overrides })

  it('follows their own rating when the learner changes it, or rated it themselves', () => {
    const right = baseline({ id: 'right', reviewedAt: at(0) })
    const missed = baseline({
      id: 'missed',
      reviewedAt: at(0),
      receivedAt: at(MINUTE),
      rating: Rating.Again,
      overridden: true,
    })
    const corrected = replayItem(card, [right, missed], fixed)
    expect(corrected.card.fsrs.state).toBe(State.New)
    expect(corrected.answers[0]).toMatchObject({ log: null, result: 'wrong' })

    const misheard = baseline({
      result: 'wrong',
      rating: Rating.Good,
      proposedRating: Rating.Again,
      overridden: true,
    })
    expect(replayItem(card, [misheard], fixed).card.fsrs.state).toBe(State.Review)

    const self = baseline({
      gradedBy: 'self',
      result: 'partial',
      rating: Rating.Hard,
      proposedRating: Rating.Hard,
    })
    const tough = replayItem(card, [self], fixed)
    expect(tough.card.fsrs.state).toBe(State.New)
    expect(tough.answers[0]).toMatchObject({ log: null, result: 'right' })

    const slow = baseline({
      answerMs: 60_000,
      rating: Rating.Good,
      proposedRating: Rating.Hard,
      overridden: true,
    })
    expect(replayItem(card, [slow], fixed).card.fsrs.state).toBe(State.Review)

    const hinted = baseline({
      hintUsed: true,
      gradedBy: 'self',
      rating: Rating.Easy,
      proposedRating: Rating.Easy,
    })
    expect(replayItem(card, [hinted], fixed).card.fsrs.state).toBe(State.New)

    const started = stored({ id: 'study', reviewedAt: at(-DAY) })
    const again = baseline({
      id: 'again',
      result: 'right',
      rating: Rating.Again,
      proposedRating: Rating.Good,
      overridden: true,
    })
    const reviewed = replayItem(card, [started, again], fixed)
    expect(reviewed.answers[1]?.log).toMatchObject({ context: 'baseline', result: 'wrong' })
    expect(reviewed.answers[1]?.log?.fsrs.rating).toBe(Rating.Again)

    const partial = baseline({
      result: 'partial',
      rating: Rating.Hard,
      proposedRating: Rating.Good,
      overridden: true,
    })
    expect(replayItem(card, [partial], fixed).card.fsrs.state).toBe(State.New)
  })

  it('places a new card the learner knows at Easy', () => {
    const { card: replayed, answers } = replayItem(card, [baseline()], fixed)
    expect(replayed.fsrs.state).toBe(State.Review)
    expect(answers[0]?.log).toMatchObject({ context: 'baseline', proposed: null, result: 'right' })
    expect(answers[0]?.log?.fsrs.rating).toBe(Rating.Easy)
  })

  it('leaves a new card new when the app read a hint first (no help of any kind)', () => {
    const helped = baseline({ hintUsed: true, hintImposed: true })
    const { card: replayed, answers } = replayItem(card, [helped], fixed)
    expect(replayed.fsrs.state).toBe(State.New)
    expect(answers[0]?.log).toBeNull()
  })

  it('leaves a new card new when the learner misses it, and still records the answer', () => {
    const missed = baseline({ result: 'wrong', rating: Rating.Again, proposedRating: Rating.Again })
    const { card: replayed, answers } = replayItem(card, [missed], fixed)
    expect(replayed.fsrs.state).toBe(State.New)
    expect(answers).toEqual([
      {
        itemId: 'card-a',
        eventIds: [missed.id],
        context: 'baseline',
        at: T0,
        result: 'wrong',
        log: null,
      },
    ])
  })

  it('reviews a card the learner has started as usual', () => {
    const first = stored({ reviewedAt: at(0) })
    const later = baseline({
      reviewedAt: at(DAY),
      result: 'wrong',
      rating: Rating.Again,
      proposedRating: Rating.Again,
    })
    const { answers } = replayItem(card, [first, later], fixed)
    expect(answers[1]?.log).toMatchObject({ context: 'baseline', result: 'wrong' })
    expect(answers[1]?.log?.fsrs.rating).toBe(Rating.Again)
  })
})

describe('replayItem: mic practice', () => {
  it('counts a missed must-do as Missed it on its card', () => {
    const missed = stored({
      mode: 'mic-practice',
      result: 'wrong',
      rating: Rating.Again,
      proposedRating: Rating.Again,
    })
    const { card: replayed, answers } = replayItem(card, [missed], fixed)
    expect(replayed.fsrs).toEqual(fixed.missedInPractice(newCard(card, T0), T0).card.fsrs)
    expect(answers[0]?.log).toMatchObject({
      context: 'mic-practice',
      proposed: null,
      result: 'wrong',
    })
  })

  it('applies any other mic-practice rating like a graded answer', () => {
    const passed = stored({ mode: 'mic-practice', gradedBy: 'code' })
    const { answers } = replayItem(card, [passed], fixed)
    expect(answers[0]?.log).toMatchObject({ context: 'mic-practice', proposed: Rating.Good })
  })
})

describe('replayItem: an answer the scheduler refuses', () => {
  it('is left out, stays listed, and the rest still apply', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let calls = 0
    const flaky: Scheduler = {
      ...fixed,
      review: (...args) => {
        calls += 1
        if (calls === 1) throw new Error('refused')
        return fixed.review(...args)
      },
    }
    const events = [
      stored({ id: 'bad', reviewedAt: at(0) }),
      stored({ id: 'ok', reviewedAt: at(MINUTE) }),
    ]
    const replayed = replayItem(card, events, flaky)
    expect(replayed.refused).toEqual(['bad'])
    expect(replayed.answers.map((entry) => entry.eventIds)).toEqual([['ok']])
    expect(replayed.card.fsrs.reps).toBe(1)
    expect(error).toHaveBeenCalledOnce()
    error.mockRestore()
  })
})

describe('replayItems', () => {
  it('replays each card from its own events and skips cards not in the bank', () => {
    const metas = new Map([
      ['card-a', meta('card-a')],
      ['card-b', meta('card-b', { category: 'Standing work' })],
    ])
    const replayed = replayItems(
      metas,
      [
        stored({ itemId: 'card-a' }),
        stored({ itemId: 'card-b', reviewedAt: at(MINUTE) }),
        stored({ itemId: 'card-a', reviewedAt: at(2 * MINUTE) }),
        stored({ itemId: 'gone' }),
      ],
      fixed,
    )
    expect([...replayed.keys()].sort()).toEqual(['card-a', 'card-b'])
    expect(replayed.get('card-a')?.answers).toHaveLength(2)
    expect(replayed.get('card-b')?.card.category).toBe('Standing work')
  })
})
