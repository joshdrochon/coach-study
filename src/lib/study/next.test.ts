import { Rating } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'

import { decideDifficulty } from '@/lib/scheduler/difficulty'
import { createScheduler, newCard } from '@/lib/scheduler/fsrs'
import { DAILY_NEW_CAP } from '@/lib/scheduler/queue'
import type { ReviewLog, SchedulerCard } from '@/lib/scheduler/types'
import { checkDone } from '@/test/baseline-done'
import { at, DAY, MINUTE, T0 } from '@/test/study-fixtures'

import { roundOrder } from './baseline'
import { nextResponseSchema } from './contract'
import { loadDeck } from './deck'
import { daySeed, modeRequest, nextView, todayCounts, type NextQuery } from './next'
import { homeCounts } from './pick'
import type { StudyState } from './state'

const fixed = createScheduler({ enableFuzz: false })
const deck = loadDeck()

function dayOneState(): StudyState {
  return {
    cards: deck.metas.map((meta) => newCard(meta, T0)),
    history: [],
    answersToday: 0,
    baselineAnswers: [],
  }
}

function freshState(): StudyState {
  const state = dayOneState()
  return { ...state, baselineAnswers: checkDone(state.cards) }
}

const query = (overrides: Partial<NextQuery> = {}): NextQuery => ({
  mode: 'start',
  categories: [],
  exclude: [],
  ...overrides,
})

describe('modeRequest', () => {
  it('takes start and together as they are', () => {
    expect(modeRequest(query())).toEqual({ mode: 'start' })
    expect(modeRequest(query({ mode: 'together', categories: ['Floor work'] }))).toEqual({
      mode: 'together',
    })
  })

  it('needs at least one known category for focus', () => {
    expect(
      modeRequest(
        query({ mode: 'focus', categories: ['Floor work', 'Floor work', 'Standing work'] }),
      ),
    ).toEqual({ mode: 'focus', categories: ['Floor work', 'Standing work'] })
    expect(modeRequest(query({ mode: 'focus' }))).toBeNull()

    expect(modeRequest(query({ mode: 'baseline' }))).toBeNull()
    expect(modeRequest(query({ mode: 'focus', categories: ['Floor work', 'Cardio'] }))).toBeNull()
  })
})

describe('daySeed', () => {
  it('is the same all day in their time zone and changes at their midnight', () => {
    expect(daySeed(T0)).toBe('study|2026-08-17')
    expect(daySeed(new Date('2026-08-18T06:59:00Z'))).toBe('study|2026-08-17')
    expect(daySeed(new Date('2026-08-18T07:00:00Z'))).toBe('study|2026-08-18')
  })
})

describe('nextView', () => {
  it('starts day 1 with a new card and the day’s new cards ahead', () => {
    const view = nextView(query(), freshState(), deck, T0, fixed)
    expect(view && nextResponseSchema.parse(view)).toEqual(view)
    expect(view?.card?.format).toBe('free')
    expect(view?.card?.hintFirst).toBe(false)
    expect(view?.today).toEqual({ due: 0, newLeft: DAILY_NEW_CAP, done: 0 })
  })

  it('is the same card for the same state on the same day', () => {
    const first = nextView(query(), freshState(), deck, T0, fixed)
    const again = nextView(query(), freshState(), deck, at(5 * MINUTE), fixed)
    expect(again?.card?.itemId).toBe(first?.card?.itemId)
  })

  it('never hands back a card the learner skipped this session', () => {
    const first = nextView(query(), freshState(), deck, T0, fixed)?.card?.itemId ?? ''
    const next = nextView(query({ exclude: [first] }), freshState(), deck, T0, fixed)
    expect(next?.card?.itemId).not.toBe(first)
  })

  it('keeps focus inside the chosen categories', () => {
    const view = nextView(
      query({ mode: 'focus', categories: ['Standing work'] }),
      freshState(),
      deck,
      T0,
      fixed,
    )
    expect(view?.card?.category).toBe('Standing work')
    expect(view?.today.newLeft).toBe(DAILY_NEW_CAP)
  })

  it('refuses focus without a category', () => {
    expect(nextView(query({ mode: 'focus' }), freshState(), deck, T0, fixed)).toBeNull()
  })

  it('is done for today in Put it all together before anything is learned', () => {
    const view = nextView(query({ mode: 'together' }), freshState(), deck, T0, fixed)
    expect(view).toEqual({ card: null, today: { due: 0, newLeft: 0, done: 0 } })
  })

  it('is done for today when every card is pulled from rotation', () => {
    const state = freshState()
    const pulled = { ...state, cards: state.cards.map((card) => ({ ...card, quarantined: true })) }
    expect(nextView(query(), pulled, deck, T0, fixed)).toEqual({
      card: null,
      today: { due: 0, newLeft: 0, done: 0 },
    })
  })

  it('gives a hint first and choices for a struggling card below 80%', () => {
    const item = deck.bank.items.find((entry) => entry.choices)
    const meta = item ? deck.metaById.get(item.id) : undefined
    if (!item || !meta) throw new Error('no card with choices')
    const missedAt = T0
    const missed = fixed.review(newCard(meta, T0), Rating.Again, missedAt, {
      proposed: Rating.Again,
      result: 'wrong',
    })

    const others: { card: SchedulerCard; log: ReviewLog }[] = deck.metas
      .filter((entry) => entry.itemId !== meta.itemId)
      .slice(0, 5)
      .map((entry, index) =>
        fixed.review(newCard(entry, T0), Rating.Again, at((index + 1) * 1000), {
          proposed: Rating.Again,
          result: 'wrong',
        }),
      )
    expect(decideDifficulty([...others.map(() => 'wrong' as const), 'wrong']).band).toBe('below')
    const replaced = new Map([missed, ...others].map((entry) => [entry.card.itemId, entry.card]))
    const state: StudyState = {
      ...freshState(),
      cards: freshState().cards.map((card) => replaced.get(card.itemId) ?? card),
      history: [missed.log, ...others.map((entry) => entry.log)],
      answersToday: 6,
    }

    const view = nextView(query(), state, deck, at(2 * MINUTE), fixed)
    expect(view?.card?.itemId).toBe(meta.itemId)
    expect(view?.card?.hintFirst).toBe(true)
    expect(view?.card?.format).toBe('choices')
    expect(view?.card?.choices?.toSorted()).toEqual(item.choices?.toSorted())

    expect(view?.today).toEqual({ due: 6, newLeft: 0, done: 6 })
  })
})

describe('todayCounts', () => {
  it('leaves the cards the learner skipped out of the counts, as they are out of the queue', () => {
    const state = freshState()
    const learned = state.cards.slice(0, 2).map((card) => {
      const first = fixed.review(card, Rating.Good, new Date(T0.getTime() - 3 * 86_400_000))
      return fixed.review(first.card, Rating.Good, new Date(first.card.fsrs.due.getTime())).card
    })
    const withDue = { ...state, cards: [...learned, ...state.cards.slice(2)] }
    const skipped = learned[0]?.itemId ?? ''
    const plain = nextView(query(), withDue, deck, T0, fixed)
    const skipping = nextView(query({ exclude: [skipped] }), withDue, deck, T0, fixed)
    expect(plain?.today.due).toBe(2)
    expect(skipping?.today.due).toBe(1)
    expect(skipping?.card?.itemId).not.toBe(skipped)
  })

  it('counts new cards for Put it all together only above 90%, and only harder formats', () => {
    const state = freshState()
    const above = { ...decideDifficulty(Array.from({ length: 25 }, () => 'right' as const)) }
    expect(above.promoteFormats).toBe(true)
    const harder = state.cards.filter((card) =>
      ['cue', 'scenario', 'audit'].includes(card.itemType),
    )
    expect(todayCounts({ mode: 'together' }, state, above, T0).newLeft).toBe(
      Math.min(harder.length, DAILY_NEW_CAP),
    )
    expect(todayCounts({ mode: 'together' }, state, decideDifficulty([]), T0).newLeft).toBe(0)
  })
})

describe('the baseline check (mode baseline)', () => {
  const dayOne = roundOrder(dayOneState().cards, 'day-1').slice(0, 60)
  const answered = (count: number, from: Date = T0) =>
    dayOne.slice(0, count).map((itemId, index) => ({ itemId, at: at(index * MINUTE, from) }))

  it('asks the round’s cards in order, as free recall with no hint first and no preview', () => {
    const view = nextView(query({ mode: 'baseline' }), dayOneState(), deck, T0, fixed)
    expect(view && nextResponseSchema.parse(view)).toEqual(view)
    expect(view?.card).toMatchObject({ itemId: dayOne[0], format: 'free', hintFirst: false })
    expect(view?.card?.choices).toBeUndefined()
    expect(view?.card?.dueInMs).toBeUndefined()
    expect(view?.today).toEqual({ due: 60, newLeft: 0, done: 0 })
  })

  it('asks the same way below 80% right, and leaves out what the learner answered or skipped', () => {
    const misses = deck.metas.slice(0, 6).map((meta, index) => {
      const missed = fixed.review(newCard(meta, T0), Rating.Again, at(index * 1000), {
        proposed: Rating.Again,
        result: 'wrong',
      })
      return missed.log
    })
    const state: StudyState = {
      ...dayOneState(),
      history: misses,
      baselineAnswers: answered(3),
    }
    expect(decideDifficulty(misses.map((log) => log.result)).band).toBe('below')
    const view = nextView(
      query({ mode: 'baseline', exclude: [dayOne[3] ?? ''] }),
      state,
      deck,
      at(10 * MINUTE),
      fixed,
    )
    expect(view?.card).toMatchObject({ itemId: dayOne[4], format: 'free', hintFirst: false })

    expect(view?.today).toEqual({ due: 57, newLeft: 0, done: 0 })
  })

  it('is what Start serves first while the round is due, marked as the check’s; not Focus or Together', () => {
    const view = nextView(query(), dayOneState(), deck, T0, fixed)
    expect(view?.card).toMatchObject({
      itemId: dayOne[0],
      baseline: true,
      format: 'free',
      hintFirst: false,
    })

    expect(view?.today).toEqual({ due: 60, newLeft: DAILY_NEW_CAP, done: 0 })
    const focus = nextView(
      query({ mode: 'focus', categories: ['Floor work'] }),
      dayOneState(),
      deck,
      T0,
    )
    expect(focus?.card?.baseline).toBeUndefined()
    const together = nextView(query({ mode: 'together' }), dayOneState(), deck, T0, fixed)
    expect(together?.card).toBeNull()

    const after = { ...dayOneState(), baselineAnswers: answered(60) }
    const mix = nextView(query(), after, deck, at(2 * 60 * MINUTE), fixed)
    expect(mix?.card).not.toBeNull()
    expect(mix?.card?.baseline).toBeUndefined()
  })

  it('asks a card the learner has already studied like any other (a real retrieval)', () => {
    const state = dayOneState()
    const studied = state.cards.map((card) =>
      card.itemId === dayOne[0] ? fixed.review(card, Rating.Good, at(-DAY)).card : card,
    )
    const view = nextView(
      query({ mode: 'baseline' }),
      { ...state, cards: studied },
      deck,
      T0,
      fixed,
    )
    expect(view?.card).toMatchObject({ itemId: dayOne[0], format: 'free', hintFirst: false })
  })

  it('is done once every card of the round is answered (card null)', () => {
    const state = { ...dayOneState(), baselineAnswers: answered(60) }
    expect(nextView(query({ mode: 'baseline' }), state, deck, at(2 * 60 * MINUTE), fixed)).toEqual({
      card: null,
      today: { due: 0, newLeft: 0, done: 0 },
    })
  })

  it('names the round on Home, with the cards left, until it is done', () => {
    expect(homeCounts(dayOneState(), T0, 'America/Los_Angeles').baseline).toEqual({
      label: 'Day-1 check',
      cards: 60,
    })
    const halfway = { ...dayOneState(), baselineAnswers: answered(25) }
    expect(homeCounts(halfway, at(MINUTE * 30), 'America/New_York').baseline).toEqual({
      label: 'Day-1 check',
      cards: 35,
    })
    const done = { ...dayOneState(), baselineAnswers: answered(60) }
    expect(homeCounts(done, at(2 * 60 * MINUTE), 'America/Los_Angeles').baseline).toBeNull()

    expect(homeCounts(done, at(DAY), 'America/Los_Angeles').baseline).toEqual({
      label: 'Check before Aug 19',
      cards: 60,
    })
  })
})
