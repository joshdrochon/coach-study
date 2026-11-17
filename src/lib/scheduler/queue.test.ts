import { Rating, State, type Grade } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'

import {
  dueReview,
  fakeLog,
  fixed,
  graduated,
  makeCard,
  notDueReview,
  reviewedAt,
  T0,
  TYPES,
  windowOf,
} from '@/test/scheduler-fixtures'

import { addDays, addMinutes, dayKey, localDay } from './calendar'
import { HARDER_FORMATS } from './difficulty'
import {
  DAILY_NEW_CAP,
  dailyNewCap,
  LEARN_AHEAD_MINUTES,
  isDueReview,
  isStruggling,
  newCardIsDue,
  nextCard,
  STRUGGLING_LAPSES,
  STRUGGLING_RECALL,
  STUDY_MINUTES_PER_DAY,
  todayPlan,
  TOGETHER_WEIGHTS,
  type NextCard,
  type QueuedCard,
  type QueueInput,
} from './queue'
import { createScheduler } from './fsrs'
import { reviewAnswer } from './rating'
import { seededRandom } from './seeded'
import type { Correctness, ModeRequest, ReviewLog, SchedulerCard } from './types'

const START: ModeRequest = { mode: 'start' }
const TOGETHER: ModeRequest = { mode: 'together' }
const focusOn = (...categories: [string, ...string[]]): ModeRequest => ({
  mode: 'focus',
  categories,
})

type Session = {
  cards: Map<string, SchedulerCard>
  history: ReviewLog[]
  now: Date
  picks: QueuedCard[]
}

function session(
  cards: readonly SchedulerCard[],
  history: readonly ReviewLog[] = [],
  now: Date = T0,
): Session {
  return {
    cards: new Map(cards.map((card) => [card.itemId, card])),
    history: [...history],
    now,
    picks: [],
  }
}

type Extra = Partial<Omit<QueueInput, 'mode' | 'cards' | 'history' | 'now'>>

function ask(s: Session, mode: ModeRequest, extra: Extra = {}): NextCard {
  return nextCard(
    { mode, cards: [...s.cards.values()], history: s.history, now: s.now, seed: 'seed', ...extra },
    fixed,
  )
}

function study(
  s: Session,
  mode: ModeRequest,
  answer: (shown: QueuedCard) => Grade = () => Rating.Good,
  limit = 600,
  extra: Extra = {},
): NextCard | null {
  for (let i = 0; i < limit; i += 1) {
    const next = ask(s, mode, extra)
    if (next.kind === 'done') return next
    s.picks.push(next)
    const result = fixed.review(next.card, answer(next), s.now)
    s.cards.set(result.card.itemId, result.card)
    s.history.push(result.log)
    s.now = addMinutes(s.now, 0.5)
  }
  return null
}

const inBand = (s: Session) => (): Grade => (s.picks.length % 7 === 0 ? Rating.Again : Rating.Good)

const capUsedToday = (count: number): ReviewLog[] =>
  Array.from({ length: count }, (_, i) =>
    fakeLog(`old-${String(i)}`, Rating.Good, addMinutes(T0, -60 + i), { state: State.New }),
  )

function answerAll(
  s: Session,
  mode: ModeRequest,
  correct: (shown: QueuedCard) => Correctness,
  limit = 40,
): { last: NextCard; shown: string[] } {
  const shown: string[] = []
  let last = ask(s, mode)
  for (let i = 0; i < limit && last.kind === 'card'; i += 1) {
    const next: QueuedCard = last
    s.picks.push(next)
    shown.push(`${next.card.itemId}:${next.reason}:${next.format}`)
    const result = reviewAnswer(
      next.card,
      {
        correct: correct(next),
        answerMs: 6_000,
        hintUsed: next.hintFirst,
        hintImposed: next.hintFirst,
        itemType: next.card.itemType,
        format: next.format,
      },
      s.now,
      fixed,
    )
    s.cards.set(result.card.itemId, result.card)
    s.history.push(result.log)
    s.now = addMinutes(s.now, 0.5)
    last = ask(s, mode)
  }
  return { last, shown }
}

const introducedOn = (history: readonly ReviewLog[], day: string): number =>
  history.filter(
    (log) =>
      log.context === 'study' && log.fsrs.state === State.New && dayKey(log.fsrs.review) === day,
  ).length

function windowWithNewCard(correct: number, fromEnd: number): ReviewLog[] {
  return windowOf(correct, 25, T0).map((log, i) =>
    i === 25 - 1 - fromEnd ? { ...log, fsrs: { ...log.fsrs, state: State.New } } : log,
  )
}

const CATEGORIES = ['Floor work', 'Standing work', 'Glossary'] as const

function spread(
  count: number,
  make: (itemId: string, category: string, index: number) => SchedulerCard,
): SchedulerCard[] {
  return CATEGORIES.flatMap((category) =>
    Array.from({ length: count }, (_, i) => make(`${category}-${String(i)}`, category, i)),
  )
}

describe('Start mode', () => {
  it('works through every due card across all categories, never the same category twice in a row', () => {
    const s = session(spread(6, (id, category) => dueReview(id, { category })))
    const done = study(s, START)
    expect(done).toMatchObject({ kind: 'done' })
    expect(s.picks).toHaveLength(18)
    expect(s.picks.every((pick) => pick.reason === 'review')).toBe(true)
    expect(new Set(s.picks.map((pick) => pick.card.itemId)).size).toBe(18)
    const categories = s.picks.map((pick) => pick.card.category)
    categories.slice(1).forEach((category, i) => {
      expect(category).not.toBe(categories[i])
    })
  })

  it('serves every review due today, so Done for today leaves nothing due today', () => {
    const laterToday = graduated(makeCard('later-today'), addMinutes(addDays(T0, -2), 170)).card
    expect(dayKey(laterToday.fsrs.due)).toBe('2026-08-17')
    expect(laterToday.fsrs.due.getTime()).toBeGreaterThan(T0.getTime())
    const s = session([laterToday])
    expect(todayPlan({ cards: [...s.cards.values()], history: s.history, now: T0 }).review).toBe(1)
    expect(study(s, START)).toMatchObject({ kind: 'done' })
    expect(s.picks.map((pick) => pick.reason)).toEqual(['review'])
    expect(
      todayPlan({ cards: [...s.cards.values()], history: s.history, now: s.now }),
    ).toMatchObject({
      review: 0,
      total: 0,
    })
  })

  it('says when the next card comes due: a review at the start of its due day', () => {
    const tomorrow = notDueReview('tomorrow')
    expect(dayKey(tomorrow.fsrs.due)).toBe('2026-08-18')
    expect(ask(session([tomorrow]), START)).toMatchObject({
      kind: 'done',
      nextDueAt: new Date('2026-08-18T07:00:00.000Z'),
    })
  })

  it('puts due work before an unpaced new card, even from the same category as the last card', () => {
    const last = graduated(
      makeCard('c0', { category: 'Floor work' }, addDays(T0, -1)),
      addMinutes(T0, -11),
    )
    const cards = [
      last.card,
      ...Array.from({ length: 6 }, (_, i) =>
        dueReview(`c${String(i + 1)}`, { category: 'Floor work' }),
      ),
      makeCard('o-new', { category: 'Standing work' }),
    ]

    const history = [...windowWithNewCard(20, 2), ...last.logs]
    const next = ask(session(cards, history), START)
    expect(next).toMatchObject({ reason: 'review', card: { category: 'Floor work' } })
    expect(next.decision.band).toBe('within')
  })

  it('repeats a category only when nothing else is left', () => {
    const cards = [
      dueReview('c1', { category: 'Floor work' }),
      dueReview('c2', { category: 'Floor work' }),
      dueReview('c3', { category: 'Floor work' }),
      dueReview('o1', { category: 'Standing work' }),
    ]
    const s = session(cards)
    study(s, START)
    expect(s.picks.map((pick) => pick.card.category)).toEqual([
      'Floor work',
      'Standing work',
      'Floor work',
      'Floor work',
    ])
  })

  it('scales the cap to the study time: 40 at 45 minutes', () => {
    expect(DAILY_NEW_CAP).toBe(40)
    expect(STUDY_MINUTES_PER_DAY).toBe(45)
    expect(dailyNewCap()).toBe(40)
    expect(dailyNewCap(45)).toBe(40)
    expect(dailyNewCap(30)).toBe(27)
    expect(dailyNewCap(15)).toBe(13)
    expect(dailyNewCap(90)).toBe(40)
    expect(dailyNewCap(0)).toBe(0)
    expect(dailyNewCap(-30)).toBe(0)

    expect(dailyNewCap(45, 'more')).toBe(40)
    expect(dailyNewCap(15, 'more')).toBe(13)
    expect(dailyNewCap(45, 'steady')).toBe(40)
    expect(dailyNewCap(45, 'none')).toBe(0)

    const s = session(spread(10, (id, category) => makeCard(id, { category })))
    study(s, START, inBand(s), 600, { studyMinutesPerDay: 15 })
    expect(introducedOn(s.history, '2026-08-17')).toBe(13)
  })

  it('counts the day in their time zone', () => {
    const lateFirstEvening = new Date('2026-08-18T05:30:00.000Z')
    const history = Array.from({ length: 50 }, (_, i) =>
      fakeLog(`old-${String(i)}`, Rating.Good, addMinutes(lateFirstEvening, i / 10), {
        state: State.New,
      }),
    )
    const s = session([makeCard('fresh')], history, new Date('2026-08-18T16:00:00.000Z'))
    expect(ask(s, START)).toMatchObject({ kind: 'card', reason: 'new' })
    expect(ask(s, START, { timeZone: 'UTC' })).toMatchObject({ kind: 'done' })
  })

  it('shows a due learning step before anything else', () => {
    const learning = fixed.review(
      makeCard('l', { category: 'Floor work' }),
      Rating.Good,
      addMinutes(T0, -15),
    )
    const s = session(
      [
        learning.card,
        dueReview('r', { category: 'Standing work' }),
        makeCard('n', { category: 'Glossary' }),
      ],
      [learning.log, fakeLog('elsewhere', Rating.Good, addMinutes(T0, -1))],
    )
    expect(ask(s, START)).toMatchObject({ kind: 'card', reason: 'learning', card: { itemId: 'l' } })
  })

  it('shows a learning step up to 20 minutes early only when nothing else is left', () => {
    expect(LEARN_AHEAD_MINUTES).toBe(20)
    const step = fixed.review(makeCard('l'), Rating.Good, T0).card
    const at = (minutes: number): SchedulerCard => ({
      ...step,
      fsrs: { ...step.fsrs, due: addMinutes(T0, minutes) },
    })
    expect(ask(session([at(15)]), START)).toMatchObject({ kind: 'card', reason: 'learn-ahead' })
    expect(ask(session([at(25)]), START)).toMatchObject({
      kind: 'done',
      nextDueAt: addMinutes(T0, 25),
    })
    expect(ask(session([at(15), dueReview('r')]), START)).toMatchObject({
      reason: 'review',
    })
  })

  it('is done with nothing scheduled when every card is new and new cards are paused', () => {
    expect(ask(session([makeCard('n')], windowOf(10, 25, T0)), START)).toMatchObject({
      kind: 'done',
      nextDueAt: null,
      decision: { band: 'below' },
    })
  })
})

describe('the difficulty dial in the queue', () => {
  const struggling = fixed.review(
    makeCard('struggling', { category: 'Floor work', hasChoices: true }),
    Rating.Again,
    addMinutes(T0, -5),
  ).card

  it('below 80%: no new cards, a hint first, and pick-from-choices for a struggling card', () => {
    const below = windowOf(19, 25, T0)
    const first = ask(
      session([struggling, dueReview('r', { hasChoices: true }), makeCard('n')], below),
      START,
    )
    expect(first).toMatchObject({
      kind: 'card',
      card: { itemId: 'struggling' },
      format: 'choices',
      hintFirst: true,
      decision: { band: 'below', newCards: 'none' },
    })

    const review = ask(session([dueReview('r', { hasChoices: true }), makeCard('n')], below), START)
    expect(review).toMatchObject({ card: { itemId: 'r' }, format: 'free', hintFirst: true })

    expect(ask(session([makeCard('n')], below), START)).toMatchObject({ kind: 'done' })
  })

  it('inside the band: free recall and no hint', () => {
    expect(ask(session([struggling], windowOf(21, 25, T0)), START)).toMatchObject({
      format: 'free',
      hintFirst: false,
    })
  })

  it('below 80%: choices too for a due card the learner is close to losing or keeps forgetting', () => {
    expect(STRUGGLING_RECALL).toBe(0.7)
    expect(STRUGGLING_LAPSES).toBe(2)
    const below = windowOf(19, 25, T0)

    const overdue = dueReview('overdue', { hasChoices: true }, addDays(T0, -27))
    expect(fixed.retrievability(overdue, T0)).toBeLessThan(0.7)
    const forgetful = dueReview('forgetful', { hasChoices: true })
    const lapsed = { ...forgetful, fsrs: { ...forgetful.fsrs, lapses: 2 } }
    const onTrack = dueReview('on-track', { hasChoices: true })
    expect(fixed.retrievability(onTrack, T0)).toBeGreaterThan(0.7)
    expect(ask(session([overdue], below), START)).toMatchObject({ format: 'choices' })
    expect(ask(session([lapsed], below), START)).toMatchObject({ format: 'choices' })
    expect(ask(session([onTrack], below), START)).toMatchObject({ format: 'free' })
  })

  it('knows a struggling card', () => {
    expect(isStruggling(fixed.review(makeCard('l'), Rating.Again, T0).card, T0)).toBe(true)
    expect(isStruggling(dueReview('d', {}, addDays(T0, -27)), T0, fixed)).toBe(true)
    expect(isStruggling(dueReview('d'), T0)).toBe(false)

    const notDue = notDueReview('n')
    expect(isStruggling({ ...notDue, fsrs: { ...notDue.fsrs, lapses: 3 } }, T0)).toBe(false)
    expect(isStruggling(makeCard('new'), T0)).toBe(false)

    const laterToday = reviewedAt('later', addMinutes(T0, -20 * 60), 1)
    expect(dayKey(laterToday.fsrs.due)).toBe('2026-08-17')
    const lapsed = (card: SchedulerCard): SchedulerCard => ({
      ...card,
      fsrs: { ...card.fsrs, lapses: 2 },
    })
    expect(isStruggling(lapsed(laterToday), T0)).toBe(true)

    const recent = reviewedAt('recent', addMinutes(T0, -60), 0.5)
    expect(dayKey(recent.fsrs.due)).toBe('2026-08-17')
    expect(isStruggling(lapsed(recent), T0, fixed, localDay(T0))).toBe(false)
  })

  it('below 80%, right answers after the hints it gave still move cards through their steps', () => {
    const below = windowOf(0, 25, addMinutes(T0, -1))
    const cards = ['a', 'b', 'c'].map(
      (id) => fixed.review(makeCard(id), Rating.Again, addMinutes(T0, -30)).card,
    )
    const s = session(cards, below)
    const done = study(
      s,
      START,
      (shown) =>
        reviewAnswer(
          shown.card,
          {
            correct: 'right',
            answerMs: 6_000,
            hintUsed: shown.hintFirst,
            hintImposed: shown.hintFirst,
            itemType: shown.card.itemType,
          },
          s.now,
          fixed,
        ).log.fsrs.rating,
    )

    expect(s.picks.map((pick) => pick.reason)).toEqual([
      ...Array.from({ length: 6 }, (_, i) => (i < 3 ? 'learning' : 'learn-ahead')),
      'again',
      'again',
      'again',
    ])
    expect(s.picks.every((pick) => pick.hintFirst && pick.decision.band === 'below')).toBe(true)
    expect([...s.cards.values()].every((card) => card.fsrs.state === State.Review)).toBe(true)
    expect(done).toMatchObject({ kind: 'done', decision: { band: 'below' } })
  })

  it('choices only for cards that ship them', () => {
    const plain = fixed.review(makeCard('plain'), Rating.Again, addMinutes(T0, -5)).card
    expect(ask(session([plain], windowOf(19, 25, T0)), START)).toMatchObject({ format: 'free' })
  })

  it('spreads new cards evenly through what is due, twice as fast above 90%', () => {
    expect(newCardIsDue(9, 3, 0, 'steady')).toBe(false)
    expect(newCardIsDue(9, 3, 2, 'steady')).toBe(false)
    expect(newCardIsDue(9, 3, 3, 'steady')).toBe(true)
    expect(newCardIsDue(9, 3, 0, 'more')).toBe(false)
    expect(newCardIsDue(9, 3, 1, 'more')).toBe(true)
    expect(newCardIsDue(1, 40, 0, 'steady')).toBe(false)
    expect(newCardIsDue(1, 40, 1, 'steady')).toBe(true)
    expect(newCardIsDue(0, 3, 0, 'steady')).toBe(true)
    expect(newCardIsDue(9, 0, 9, 'more')).toBe(false)
    expect(newCardIsDue(9, 3, 9, 'none')).toBe(false)

    const cards = [
      ...spread(3, (id, category) => dueReview(`due-${id}`, { category })),
      ...spread(1, (id, category) => makeCard(`new-${id}`, { category })),
    ]

    expect(ask(session(cards, windowWithNewCard(21, 2)), START)).toMatchObject({
      reason: 'review',
      decision: { band: 'within' },
    })
    expect(ask(session(cards, windowWithNewCard(24, 2)), START)).toMatchObject({
      reason: 'new',
      decision: { band: 'above' },
    })
  })

  it('above 90%: promotes a harder format once the recall cards on its topic are learned', () => {
    const cards = [
      notDueReview('sample move a-recall', {
        category: 'Floor work',
        itemType: 'recall',
        topic: 'sample move a',
      }),
      makeCard('sample move a-cue', {
        category: 'Floor work',
        itemType: 'cue',
        topic: 'sample move a',
        position: 50,
      }),
      makeCard('lift-recall', {
        category: 'Floor work',
        itemType: 'recall',
        topic: 'lift',
        position: 1,
      }),
      makeCard('side-cue', {
        category: 'Standing work',
        itemType: 'cue',
        topic: 'side',
        position: 2,
      }),
    ]
    expect(ask(session(cards, windowOf(25, 25, T0)), START)).toMatchObject({
      reason: 'new',
      card: { itemId: 'sample move a-cue' },
    })
    expect(ask(session(cards, windowOf(21, 25, T0)), START)).toMatchObject({
      reason: 'new',
      card: { itemId: 'lift-recall' },
    })
  })
})

describe('Focus mode', () => {
  it('shows a due learning step before extra practice, even from the category the learner just did', () => {
    const step = fixed.review(
      makeCard('a-step', { category: 'Floor work' }),
      Rating.Good,
      addMinutes(T0, -12),
    )
    const cards = [step.card, notDueReview('b-practice', { category: 'Standing work' })]
    expect(ask(session(cards, [step.log]), focusOn('Floor work', 'Standing work'))).toMatchObject({
      reason: 'learning',
      card: { itemId: 'a-step' },
    })
  })

  const cards = (): SchedulerCard[] => [
    dueReview('a1', { category: 'Floor work' }),
    makeCard('a2', { category: 'Floor work' }),
    notDueReview('a3', { category: 'Floor work' }),
    dueReview('b1', { category: 'Standing work' }),
    makeCard('b2', { category: 'Standing work' }),
  ]

  it('serves only the chosen categories: due cards first, then new ones, then extra practice', () => {
    const s = session(cards())
    study(s, focusOn('Floor work'), () => Rating.Good, 3)
    expect(s.picks.map((pick) => pick.reason)).toEqual(['review', 'new', 'practice'])
    expect(s.picks.every((pick) => pick.card.category === 'Floor work')).toBe(true)

    const both = session(cards())
    study(both, focusOn('Floor work', 'Standing work'), () => Rating.Good, 4)
    expect(both.picks.map((pick) => pick.reason)).toEqual(['review', 'review', 'new', 'new'])
  })

  it('updates the one main schedule: extra practice pushes the next review later', () => {
    const s = session([notDueReview('a3', { category: 'Floor work' })])
    const before = s.cards.get('a3')?.fsrs.due.getTime() ?? 0
    study(s, focusOn('Floor work'), () => Rating.Good, 1)
    expect(s.picks[0]?.reason).toBe('practice')
    const after = s.cards.get('a3')?.fsrs.due.getTime() ?? 0
    expect(after).toBeGreaterThan(before)

    expect(ask(s, START)).toMatchObject({
      kind: 'done',
      nextDueAt: new Date(localDay(new Date(after)).start),
    })
  })

  it('practices each card at most once a day, so the session comes to an end', () => {
    const cards = [0, 1, 2].map((i) =>
      notDueReview(`core-${String(i)}`, { category: 'Floor work' }),
    )
    const s = session(cards)
    expect(study(s, focusOn('Floor work'), () => Rating.Good, 20)).toMatchObject({
      kind: 'done',
    })
    expect(s.picks.map((pick) => pick.reason)).toEqual(['practice', 'practice', 'practice'])
    expect(new Set(s.picks.map((pick) => pick.card.itemId)).size).toBe(3)

    s.now = addDays(T0, 1)
    expect(ask(s, focusOn('Floor work'))).toMatchObject({ kind: 'card' })
  })

  it('does not practice a card the learner already reviewed today in another mode', () => {
    const due = dueReview('due', { category: 'Floor work' })
    const s = session([due])
    study(s, START, () => Rating.Good, 5)
    expect(s.picks.map((pick) => pick.reason)).toEqual(['review'])
    expect(ask(s, focusOn('Floor work'))).toMatchObject({ kind: 'done' })
  })

  it('still counts new cards against the daily cap', () => {
    const history = capUsedToday(50)
    expect(
      ask(session([makeCard('a2', { category: 'Floor work' })], history), focusOn('Floor work')),
    ).toMatchObject({
      kind: 'done',
    })
  })
})

describe('Put it all together', () => {
  it('is weighted toward scenarios, sequence audits and spoken cues, and still mixed', () => {
    expect(HARDER_FORMATS.map((type) => TOGETHER_WEIGHTS[type])).toEqual([3, 3, 3])
    expect(TOGETHER_WEIGHTS.recall).toBe(1)
    const cards = ['Floor work', 'Standing work'].flatMap((category) =>
      TYPES.flatMap((itemType) =>
        [0, 1, 2].map((i) =>
          notDueReview(`${category}-${itemType}-${String(i)}`, { category, itemType }),
        ),
      ),
    )
    const counts = new Map<string, number>()
    for (let i = 0; i < 400; i += 1) {
      const next = ask(session(cards), TOGETHER, { seed: `together-${String(i)}` })
      if (next.kind !== 'card') throw new Error('expected a card')
      expect(next.reason).toBe('practice')
      counts.set(next.card.itemType, (counts.get(next.card.itemType) ?? 0) + 1)
    }
    const heavy = HARDER_FORMATS.reduce((sum, type) => sum + (counts.get(type) ?? 0), 0)

    expect(heavy / 400).toBeGreaterThan(0.72)
    expect(heavy / 400).toBeLessThan(0.92)
    expect(counts.get('recall') ?? 0).toBeGreaterThan(0)
    expect(counts.get('list') ?? 0).toBeGreaterThan(0)
  })

  it('comes to an end too', () => {
    const cards = TYPES.map((itemType, i) => notDueReview(`p-${String(i)}`, { itemType }))
    const s = session(cards)
    expect(study(s, TOGETHER, () => Rating.Good, 50)).toMatchObject({ kind: 'done' })
    expect(s.picks).toHaveLength(TYPES.length)
  })

  it('serves due cards before extra practice', () => {
    const cards = [
      notDueReview('practice', { itemType: 'scenario' }),
      dueReview('due', { itemType: 'recall' }),
    ]
    expect(ask(session(cards), TOGETHER)).toMatchObject({
      reason: 'review',
      card: { itemId: 'due' },
    })
  })

  it('adds new cards only above 90%, and only harder formats', () => {
    const cards = [
      notDueReview('sample move a-recall', {
        category: 'Floor work',
        itemType: 'recall',
        topic: 'sample move a',
      }),
      makeCard('sample move a-cue', {
        category: 'Floor work',
        itemType: 'cue',
        topic: 'sample move a',
      }),
      makeCard('audit-1', { category: 'Basics', itemType: 'audit' }),
      makeCard('new-recall', { category: 'Standing work', itemType: 'recall' }),
    ]
    expect(ask(session(cards, windowOf(22, 25, T0)), TOGETHER)).toMatchObject({
      reason: 'practice',
    })

    const s = session(cards, windowOf(25, 25, T0))
    expect(ask(s, TOGETHER)).toMatchObject({ reason: 'new', card: { itemId: 'sample move a-cue' } })
    study(s, TOGETHER, () => Rating.Good, 12)
    const shown = s.picks.map((pick) => pick.card.itemId)
    expect(shown).toContain('audit-1')
    expect(shown).not.toContain('new-recall')
  })

  it('shows due learning steps first', () => {
    const learning = fixed.review(
      makeCard('l', { itemType: 'recall' }),
      Rating.Again,
      addMinutes(T0, -5),
    )
    const cards = [
      learning.card,
      dueReview('due', { itemType: 'scenario', category: 'Standing work' }),
    ]
    expect(ask(session(cards), TOGETHER)).toMatchObject({
      reason: 'learning',
      card: { itemId: 'l' },
    })
  })
})

describe('interleaving and determinism', () => {
  it('takes the category of their last answer into account', () => {
    const last = graduated(
      makeCard('c0', { category: 'Floor work' }, addDays(T0, -1)),
      addMinutes(T0, -30),
    )
    const cards = [
      last.card,
      dueReview('c1', { category: 'Floor work' }),
      dueReview('o1', { category: 'Standing work' }),
    ]
    expect(ask(session(cards, last.logs), START)).toMatchObject({ card: { itemId: 'o1' } })
  })

  it('orders answers given at the same moment by card, so the last one is well defined', () => {
    const a = notDueReview('a', { category: 'Floor work' })
    const b = notDueReview('b', { category: 'Standing work' })
    const cards = [
      a,
      b,
      dueReview('c1', { category: 'Floor work' }),
      dueReview('o1', { category: 'Standing work' }),
    ]
    const sameMoment = addMinutes(T0, -1)
    const history = [fakeLog('b', Rating.Good, sameMoment), fakeLog('a', Rating.Good, sameMoment)]

    expect(ask(session(cards, history), START)).toMatchObject({ card: { itemId: 'c1' } })
    expect(ask(session(cards, history.toReversed()), START)).toMatchObject({
      card: { itemId: 'c1' },
    })
  })

  it('takes the last card and the seed from their newest study answer only', () => {
    const cards = TYPES.map((itemType, i) =>
      dueReview(`p-${String(i)}`, {
        itemType,
        category: i % 2 === 0 ? 'Floor work' : 'Standing work',
      }),
    )
    const study = [
      ...windowOf(21, 24, addMinutes(T0, -5)),
      fakeLog('p-0', Rating.Good, addMinutes(T0, -3)),
    ]
    const others = [
      fakeLog('p-1', Rating.Again, addMinutes(T0, -1), { context: 'mic-practice' }),
      fakeLog('p-3', Rating.Easy, addMinutes(T0, -2), { context: 'baseline' }),
      fakeLog('p-2', Rating.Good, addDays(T0, -3), { context: 'baseline' }),
    ]
    for (const mode of [START, TOGETHER, focusOn('Floor work', 'Standing work')]) {
      for (const seed of ['a', 'b', 'c', 'd']) {
        const input: QueueInput = { mode, cards, history: study, now: T0, seed }
        const withOthers = nextCard({ ...input, history: [...study, ...others] }, fixed)
        expect(withOthers).toEqual(nextCard(input, fixed))

        expect(withOthers).toMatchObject({ card: { category: 'Standing work' } })
      }
    }
  })

  it('ignores logs older than today and their last 25 answers', () => {
    const cards = TYPES.map((itemType, i) =>
      notDueReview(`p-${String(i)}`, {
        itemType,
        category: i % 2 === 0 ? 'Floor work' : 'Standing work',
      }),
    )
    const recent = windowOf(21, 25, T0)
    const old = Array.from({ length: 40 }, (_, i) =>
      fakeLog(`old-${String(i)}`, Rating.Again, addDays(T0, -5 - i)),
    )
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const input: QueueInput = { mode: TOGETHER, cards, history: recent, now: T0, seed }
      expect(nextCard({ ...input, history: [...old, ...recent] }, fixed)).toEqual(
        nextCard(input, fixed),
      )
    }
  })

  it('gives the same card for the same inputs, whatever their order', () => {
    const cards = [
      ...spread(4, (id, category) => dueReview(`due-${id}`, { category })),
      ...spread(4, (id, category) => makeCard(`new-${id}`, { category })),
    ]
    const history = windowOf(21, 25, T0)
    const input: QueueInput = { mode: START, cards, history, now: T0, seed: 'fixed-seed' }
    const forward = nextCard(input, fixed)
    expect(nextCard(input, fixed)).toEqual(forward)
    expect(
      nextCard({ ...input, cards: cards.toReversed(), history: history.toReversed() }, fixed),
    ).toEqual(forward)
  })

  it('lets the seed break ties between equally urgent cards', () => {
    const cards = Array.from({ length: 12 }, (_, i) => dueReview(`tie-${String(i)}`))
    const firsts = new Set(
      Array.from({ length: 20 }, (_, i) => {
        const next = ask(session(cards), START, { seed: `seed-${String(i)}` })
        return next.kind === 'card' ? next.card.itemId : 'done'
      }),
    )
    expect(firsts.size).toBeGreaterThan(1)
    expect(firsts.has('done')).toBe(false)
  })

  it('uses the app scheduler when none is given', () => {
    const input: QueueInput = {
      mode: START,
      cards: [dueReview('r')],
      history: [],
      now: T0,
      seed: 's',
    }
    expect(nextCard(input)).toEqual(nextCard(input, fixed))
  })
})

describe('rotation', () => {
  it('leaves out cards the learner skipped this session', () => {
    const cards = [dueReview('a'), dueReview('b')]
    expect(ask(session(cards), START, { skip: ['a'] })).toMatchObject({ card: { itemId: 'b' } })
    expect(ask(session(cards), START, { skip: ['a', 'b'] })).toMatchObject({ kind: 'done' })
  })
})

describe('a missed must-do', () => {
  it('comes back within minutes, even after the daily cap is used', () => {
    const capUsed = capUsedToday(50)
    const missed = fixed.missedInPractice(
      makeCard('pace-order', { category: 'Coaching voice' }),
      T0,
    )
    const s = session(
      [missed.card, makeCard('waiting')],
      [...capUsed, missed.log],
      addMinutes(T0, 1),
    )
    const done = study(s, START)
    expect(s.picks.map((pick) => [pick.card.itemId, pick.reason])).toEqual([
      ['pace-order', 'learning'],
      ['pace-order', 'learn-ahead'],
    ])
    expect(done).toMatchObject({ kind: 'done' })
    expect(s.cards.get('waiting')?.fsrs.state).toBe(State.New)
  })
})

describe('a struggle day: below 80% with nothing else left in Start', () => {
  function answeredToday(): { cards: SchedulerCard[]; logs: ReviewLog[] } {
    const hourAgo = addMinutes(T0, -60)
    const missed = fixed.review(dueReview('missed', { hasChoices: true }), Rating.Again, hourAgo, {
      result: 'wrong',
    })
    const relearned = fixed.review(missed.card, Rating.Good, addMinutes(hourAgo, 10))
    const partly = fixed.review(dueReview('partly'), Rating.Hard, addMinutes(hourAgo, 15), {
      result: 'partial',
    })
    const good = fixed.review(dueReview('good'), Rating.Good, addMinutes(hourAgo, 16))
    const easy = fixed.review(dueReview('easy'), Rating.Easy, addMinutes(hourAgo, 17))
    return {
      cards: [relearned.card, partly.card, good.card, easy.card],
      logs: [missed.log, relearned.log, partly.log, good.log, easy.log],
    }
  }

  it('shows the cards the learner answered earlier today once more: misses, partials, then lowest recall', () => {
    const { cards, logs } = answeredToday()

    const s = session(cards, [...windowOf(0, 20, addMinutes(T0, -120)), ...logs])
    expect(ask(s, START)).toMatchObject({ decision: { band: 'below' }, hintFirst: true })
    expect(todayPlan({ cards, history: s.history, now: T0 })).toMatchObject({ again: 4, total: 4 })
    const { last, shown } = answerAll(s, START, () => 'right')
    expect(shown).toEqual([
      'missed:again:choices',
      'partly:again:free',
      'good:again:free',
      'easy:again:free',
    ])
    expect(last).toMatchObject({ kind: 'done', decision: { band: 'below' } })

    expect(
      todayPlan({ cards: [...s.cards.values()], history: s.history, now: s.now }),
    ).toMatchObject({ again: 0, total: 0 })
  })

  it('never counts a card that is due as one to show again', () => {
    const history = [
      ...windowOf(0, 24, addMinutes(T0, -120)),
      fakeLog('due', Rating.Good, addMinutes(T0, -30)),
    ]
    expect(todayPlan({ cards: [dueReview('due')], history, now: T0 })).toMatchObject({
      review: 1,
      again: 0,
      total: 1,
    })
  })

  it('is only for below 80%', () => {
    const { cards, logs } = answeredToday()

    const s = session(cards, [...windowOf(18, 20, addMinutes(T0, -120)), ...logs])
    expect(ask(s, START)).toMatchObject({ kind: 'done', decision: { band: 'within' } })
    expect(todayPlan({ cards, history: s.history, now: T0 }).again).toBe(0)

    expect(ask(s, focusOn('Floor work'))).toMatchObject({ kind: 'done' })
  })

  it('stops as soon as the learner is back in the band, and new cards resume', () => {
    const { cards, logs } = answeredToday()

    const s = session(
      [...cards, makeCard('new-one', { category: 'Standing work' })],
      [...windowOf(16, 20, addMinutes(T0, -120)), ...logs],
    )
    const first = ask(s, START)
    expect(first).toMatchObject({ reason: 'again', decision: { band: 'below' } })
    const { shown } = answerAll(s, START, () => 'right', 2)
    expect(shown).toEqual(['missed:again:choices', 'new-one:new:free'])
    expect(s.picks[1]?.decision.band).toBe('within')
  })
})

describe('reviews due later today: early only after half the interval', () => {
  it('does not bring a 1-day card answered at 23:50 back just after midnight', () => {
    const card = reviewedAt('late', new Date('2026-08-18T06:50:00.000Z'), 1)
    const tenPast = new Date('2026-08-18T07:10:00.000Z')
    const halfwayThere = new Date('2026-08-18T18:50:00.000Z')
    expect(ask(session([card], [], tenPast), START)).toMatchObject({
      kind: 'done',
      nextDueAt: halfwayThere,
    })
    expect(todayPlan({ cards: [card], history: [], now: tenPast }).review).toBe(0)
    expect(ask(session([card], [], addMinutes(halfwayThere, -1)), START)).toMatchObject({
      kind: 'done',
    })
    expect(ask(session([card], [], halfwayThere), START)).toMatchObject({ reason: 'review' })
    expect(todayPlan({ cards: [card], history: [], now: halfwayThere }).review).toBe(1)
  })

  it('on the 25-hour Nov 1, waits half the interval before bringing a card back that day', () => {
    const card = reviewedAt('fall-back', new Date('2026-11-01T07:30:00.000Z'), 1)
    expect(dayKey(card.fsrs.due)).toBe('2026-11-01')
    const quarterPast = new Date('2026-11-01T07:45:00.000Z')
    expect(ask(session([card], [], quarterPast), START)).toMatchObject({
      kind: 'done',
      nextDueAt: new Date('2026-11-01T19:30:00.000Z'),
    })
    expect(todayPlan({ cards: [card], history: [], now: quarterPast }).review).toBe(0)
    const afternoon = new Date('2026-11-01T20:30:00.000Z')
    expect(ask(session([card], [], afternoon), START)).toMatchObject({ reason: 'review' })
    expect(todayPlan({ cards: [card], history: [], now: afternoon }).review).toBe(1)
  })

  it('always serves a review once its due time has come', () => {
    const card = reviewedAt('due', addDays(T0, -1), 1)
    expect(isDueReview(card, T0, localDay(T0))).toBe(true)
    expect(isDueReview(makeCard('new'), T0, localDay(T0))).toBe(false)

    const odd = { ...card, fsrs: { ...card.fsrs, last_review: undefined, due: addMinutes(T0, 60) } }
    expect(isDueReview(odd, T0, localDay(T0))).toBe(false)
    expect(isDueReview(odd, addMinutes(T0, 60), localDay(T0))).toBe(true)
  })
})

describe('todayPlan (Home: cards for today)', () => {
  it('leaves out the cards the learner skipped, which wait for their next session', () => {
    const cards = [dueReview('a'), dueReview('b')]
    expect(todayPlan({ cards, history: [], now: T0 }).review).toBe(2)
    expect(todayPlan({ cards, history: [], now: T0, skip: ['a'] }).review).toBe(1)
    const s = session(cards)
    expect(study(s, START, () => Rating.Good, 10, { skip: ['a'] })).toMatchObject({ kind: 'done' })
    expect(s.picks.map((pick) => pick.card.itemId)).toEqual(['b'])
    const after = { cards: [...s.cards.values()], history: s.history, now: s.now }
    expect(todayPlan({ ...after, skip: ['a'] }).total).toBe(0)

    expect(todayPlan(after).review).toBe(1)
  })

  it('counts due reviews, learning cards and the new cards left under the cap', () => {
    const laterToday = graduated(makeCard('later'), addMinutes(addDays(T0, -2), 170)).card
    const cards = [
      dueReview('due-1'),
      dueReview('due-2'),
      laterToday,
      notDueReview('tomorrow-or-later'),
      fixed.review(makeCard('learning'), Rating.Again, T0).card,
      ...Array.from({ length: 50 }, (_, i) => makeCard(`new-${String(i)}`)),
      { ...dueReview('pulled'), quarantined: true },
    ]
    expect(dayKey(laterToday.fsrs.due)).toBe('2026-08-17')
    expect(laterToday.fsrs.due.getTime()).toBeGreaterThan(T0.getTime())
    const history = Array.from({ length: 5 }, (_, i) =>
      fakeLog(`intro-${String(i)}`, Rating.Good, addMinutes(T0, -30 + i), { state: State.New }),
    )
    expect(todayPlan({ cards, history, now: T0 })).toEqual({
      review: 3,
      learning: 1,
      new: 35,
      again: 0,
      total: 39,
    })
    expect(todayPlan({ cards, history, now: T0, studyMinutesPerDay: 15 }).new).toBe(8)
    expect(todayPlan({ cards, history: [], now: T0, timeZone: 'UTC' }).new).toBe(40)
  })

  it('plans new cards the way the dial stands', () => {
    const cards = Array.from({ length: 60 }, (_, i) => makeCard(`new-${String(i)}`))
    expect(todayPlan({ cards, history: windowOf(19, 25, T0), now: T0 }).new).toBe(0)
    expect(todayPlan({ cards, history: windowOf(21, 25, T0), now: T0 }).new).toBe(40)
    expect(todayPlan({ cards, history: windowOf(25, 25, T0), now: T0 }).new).toBe(40)
  })
})

describe('speed', () => {
  it('picks 300 cards from 200 with a 2,000-answer history in under 2 seconds', () => {
    const cards = spread(67, (id, category, i) =>
      i % 3 === 0
        ? makeCard(id, { category, position: i })
        : i % 3 === 1
          ? dueReview(id, { category })
          : notDueReview(id, { category }),
    ).slice(0, 200)
    expect(cards).toHaveLength(200)
    const history = Array.from({ length: 2_000 }, (_, i) =>
      fakeLog(
        `old-${String(i % 150)}`,
        i % 6 === 0 ? Rating.Again : Rating.Good,
        addMinutes(T0, i - 2_000),
        {
          state: i % 9 === 0 ? State.New : State.Review,
        },
      ),
    )
    const s = session(cards, history)
    let picking = 0
    let calls = 0
    for (const mode of [START, focusOn('Floor work', 'Standing work'), TOGETHER]) {
      for (let i = 0; i < 100; i += 1) {
        const input: QueueInput = {
          mode,
          cards: [...s.cards.values()],
          history: s.history,
          now: s.now,
          seed: 'speed',
        }
        const started = process.cpuUsage()
        const next = nextCard(input, fixed)
        const used = process.cpuUsage(started)
        picking += (used.user + used.system) / 1_000
        calls += 1
        if (next.kind === 'done') continue
        const result = fixed.review(next.card, Rating.Good, s.now)
        s.cards.set(result.card.itemId, result.card)
        s.history.push(result.log)
        s.now = addMinutes(s.now, 0.5)
      }
    }
    expect(calls).toBe(300)
    expect(picking).toBeLessThan(2_000)
  })
})

describe('three days of study, simulated', () => {
  function simulate(): { history: ReviewLog[]; picks: QueuedCard[]; leftLearningOn: Grade[] } {
    const cards = spread(30, (id, category, i) =>
      makeCard(id, { category, itemType: TYPES[i % TYPES.length] ?? 'recall', position: i }),
    )
    const s = session(cards)
    const random = seededRandom('learner')
    const leftLearningOn: Grade[] = []
    for (let day = 0; day < 3; day += 1) {
      s.now = addDays(T0, day)
      for (let i = 0; i < 300; i += 1) {
        const next = ask(s, START)
        if (next.kind === 'done') break
        s.picks.push(next)
        const p = next.card.fsrs.state === State.New ? 0.6 : fixed.retrievability(next.card, s.now)
        const rating = random() < p ? Rating.Good : Rating.Again
        const result = fixed.review(next.card, rating, s.now)
        if (next.card.fsrs.state !== State.Review && result.card.fsrs.state === State.Review) {
          leftLearningOn.push(rating)
        }
        s.cards.set(result.card.itemId, result.card)
        s.history.push(result.log)
        s.now = addMinutes(s.now, 0.5)
      }
    }
    return { history: s.history, picks: s.picks, leftLearningOn }
  }

  it('keeps every rule at once, the same way every time', () => {
    const run = simulate()
    for (const day of ['2026-08-17', '2026-08-18', '2026-08-19']) {
      expect(introducedOn(run.history, day)).toBeLessThanOrEqual(DAILY_NEW_CAP)
    }
    expect(introducedOn(run.history, '2026-08-17')).toBeGreaterThan(0)

    expect(run.leftLearningOn.length).toBeGreaterThan(0)
    expect(run.leftLearningOn.every((rating) => rating === Rating.Good)).toBe(true)

    const categories = run.picks.map((pick) => pick.card.category)
    const repeats = categories.slice(1).filter((category, i) => category === categories[i]).length
    expect(repeats / categories.length).toBeLessThan(0.05)

    expect(new Set(run.picks.map((pick) => pick.decision.band)).size).toBeGreaterThan(1)
    expect(simulate()).toEqual(run)
  })
})

describe('two weeks of daily study, simulated', () => {
  it('keeps them near the 80-90% band and brings in the whole bank by Aug 30', () => {
    const scheduler = createScheduler()
    const sizes: [string, number][] = [
      ['Floor work', 160],
      ['Standing work', 110],
      ['Glossary', 40],
      ['Coaching voice', 90],
      ['Basics', 80],
      ['Basics', 80],
    ]
    const cards = new Map<string, SchedulerCard>()
    for (const [category, size] of sizes) {
      for (let i = 0; i < size; i += 1) {
        const card = makeCard(`${category}-${String(i)}`, {
          category,
          itemType: TYPES[i % TYPES.length],
          position: i,
          topic: `${category}-${String(Math.floor(i / TYPES.length))}`,
          hasChoices: i % 2 === 0,
        })
        cards.set(card.itemId, card)
      }
    }
    const history: ReviewLog[] = []
    const random = seededRandom('two-weeks')
    // A learner who studies longer than the default day, so the whole bank comes in.
    const SIM_MINUTES = 120
    const accuracy: number[] = []
    let sessionsDone = 0
    for (let day = 0; day < 14; day += 1) {
      let now = addMinutes(addDays(T0, day), day % 2 === 0 ? 0 : 9 * 60)
      const end = addMinutes(now, SIM_MINUTES)
      let shown = 0
      let right = 0
      while (now < end) {
        const next = nextCard(
          {
            mode: START,
            cards: [...cards.values()],
            history,
            now,
            seed: `day-${String(day)}`,
            studyMinutesPerDay: SIM_MINUTES,
          },
          scheduler,
        )
        if (next.kind === 'done') {
          expect(
            todayPlan({
              cards: [...cards.values()],
              history,
              now,
              studyMinutesPerDay: SIM_MINUTES,
            }),
          ).toMatchObject({
            review: 0,
            learning: 0,
            total: 0,
          })
          sessionsDone += 1
          break
        }
        const { card } = next
        let p = card.fsrs.state === State.New ? 0.45 : scheduler.retrievability(card, now)
        if (next.hintFirst) p = Math.min(1, p + 0.25)
        if (next.format === 'choices') p = Math.min(1, p + 0.2)
        const correct = random() < p
        const result = reviewAnswer(
          card,
          {
            correct: correct ? 'right' : 'wrong',
            answerMs: 6_000,
            hintUsed: next.hintFirst,
            hintImposed: next.hintFirst,
            itemType: card.itemType,
            format: next.format,
          },
          now,
          scheduler,
        )
        cards.set(card.itemId, result.card)
        history.push(result.log)
        shown += 1
        if (correct) right += 1
        now = addMinutes(now, 0.5)
      }
      accuracy.push(right / shown)
      const introduced = introducedOn(history, dayKey(addDays(T0, day)))
      expect(introduced).toBeLessThanOrEqual(DAILY_NEW_CAP)
    }
    expect(sessionsDone).toBeGreaterThan(0)

    const inBandDays = accuracy.filter((share) => share >= 0.8 && share <= 0.9).length
    expect(inBandDays).toBeGreaterThan(accuracy.length / 2)
    expect(Math.min(...accuracy)).toBeGreaterThan(0.75)
    expect(Math.max(...accuracy)).toBeLessThan(0.92)

    const started = [...cards.values()].filter((card) => card.fsrs.state !== State.New).length
    expect(started / cards.size).toBeGreaterThanOrEqual(0.95)
  }, 60_000)
})
