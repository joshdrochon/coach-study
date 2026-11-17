import { Rating } from 'ts-fsrs'
import { beforeEach, describe, expect, it } from 'vitest'

import { openTestDb, type Db } from '../db/client'
import { gateResults, itemFlags, practices, profile } from '../db/schema'
import { defaultScheduler, newCard } from '../scheduler/fsrs'
import { DAILY_NEW_CAP, todayPlan } from '../scheduler/queue'
import { meanRecall } from '../scheduler/readiness'
import { storeCheckDone } from '@/test/baseline-done'
import { insertPractice } from '@/test/practice-rows'
import { at, DAY, HOUR, MINUTE, posted, T0 } from '@/test/study-fixtures'

import { loadDeck } from './deck'
import {
  canonicalTimeZone,
  daysUntil,
  endOfEvaluationDay,
  endOfPacificDay,
  homeView,
  micPracticesOn,
  weakestMustDo,
  weakestMustDoLabel,
} from './home'
import { progressView } from './progress'
import { loadStudyState, recordReview } from './state'

const MORNING = T0
const deck = loadDeck()

describe('dates in their calendar', () => {
  it('counts days to the milestones', () => {
    expect(daysUntil('2026-08-19', MORNING)).toBe(2)
    expect(daysUntil('2026-09-10', MORNING)).toBe(24)

    expect(daysUntil('2026-08-19', new Date('2026-08-19T06:30:00Z'))).toBe(1)
    expect(daysUntil('2026-08-16', MORNING)).toBe(-1)
  })

  it('counts in the time zone their iPad sends', () => {
    const lateEveningPacific = new Date('2026-08-19T06:30:00Z')
    expect(daysUntil('2026-08-19', lateEveningPacific, 'America/New_York')).toBe(0)
    expect(daysUntil('2026-08-19', lateEveningPacific, 'Pacific/Honolulu')).toBe(1)
  })

  it('finds the end of their day', () => {
    expect(endOfPacificDay(MORNING).toISOString()).toBe('2026-08-18T06:59:59.999Z')

    expect(endOfPacificDay(new Date('2026-11-12T20:00:00Z')).toISOString()).toBe(
      '2026-11-13T07:59:59.999Z',
    )
  })

  it('knows a real time zone, by its canonical name, from a made-up one', () => {
    expect(canonicalTimeZone('America/Los_Angeles')).toBe('America/Los_Angeles')
    expect(canonicalTimeZone('america/los_angeles')).toBe('America/Los_Angeles')
    expect(canonicalTimeZone('Europe/Lisbon')).toBe('Europe/Lisbon')
    expect(canonicalTimeZone('Mars/Olympus_Mons')).toBeNull()
    expect(canonicalTimeZone('')).toBeNull()
    expect(canonicalTimeZone('A'.repeat(65))).toBeNull()
  })
})

describe('homeView', () => {
  let db: Db
  beforeEach(async () => {
    db = await openTestDb()
  })

  it('shows day one: the day-1 check first, no weakest must-do, the starting title', async () => {
    expect(await homeView(db, deck, MORNING)).toEqual({
      daysToPracticeDay: 2,
      daysToFirstClass: 24,

      dueToday: 60 + DAILY_NEW_CAP,
      weakestMustDo: null,
      title: 'Starter',
      name: 'Coach Alex',
      avatarUrl: '/api/avatar?v=default',
      baseline: { label: 'Day-1 check', cards: 60 },
      micPracticesToday: 0,

      readiness: null,
      paceStart: null,
      studiedToday: false,
    })
  })

  it('uses the title the learner set and the time zone their iPad sends', async () => {
    await db.insert(profile).values({ id: 1, title: 'Practitioner' })
    const lateEveningPacific = new Date('2026-08-19T06:30:00Z')
    const view = await homeView(db, deck, lateEveningPacific, 'America/New_York')
    expect(view).toMatchObject({
      title: 'Practitioner',
      daysToPracticeDay: 0,
      daysToFirstClass: 22,
    })
  })

  it('never changes their title for a streak, answers or mic practice scores', async () => {
    await db.insert(profile).values({ id: 1, title: 'Starter' })
    const metas = deck.metas.slice(0, 12)
    for (let day = 0; day < 4; day += 1) {
      for (const [index, meta] of metas.entries()) {
        const when = at(day * DAY + index * MINUTE)
        await recordReview(
          db,
          deck,
          posted({ itemId: meta.itemId, reviewedAt: when.toISOString() }),
          when,
        )
      }
      await insertPractice(db, {
        doneAt: at(day * DAY + HOUR),
        verdicts: { C1: 'pass', C2: 'pass', B2: 'pass' },
      })
    }
    const later = at(4 * DAY)
    const stored = await db.select({ title: profile.title }).from(profile)
    expect(stored).toEqual([{ title: 'Starter' }])
    expect((await homeView(db, deck, later)).title).toBe('Starter')
    expect((await progressView(db, deck, later)).title).toBe('Starter')
  })

  it('counts what Start will work through: the scheduler’s plan for today', async () => {
    const [first, second, third] = deck.metas
    if (!first || !second || !third) throw new Error('empty deck')

    await storeCheckDone(
      db,
      deck.metas.map((meta) => newCard(meta, T0)),
    )

    await recordReview(
      db,
      deck,
      posted({ itemId: first.itemId, reviewedAt: at(0).toISOString() }),
      at(0),
    )
    await recordReview(
      db,
      deck,
      posted({
        itemId: second.itemId,
        result: 'wrong',
        rating: 1,
        proposedRating: 1,
        reviewedAt: at(MINUTE).toISOString(),
      }),
      at(MINUTE),
    )
    await db.insert(itemFlags).values({ itemId: third.itemId, reason: 'this-looks-wrong' })
    const now = at(2 * MINUTE)
    const state = await loadStudyState(db, deck, now)
    const plan = todayPlan({ cards: state.cards, history: state.history, now })
    const view = await homeView(db, deck, now)
    expect(view.dueToday).toBe(plan.total)
    expect(plan.learning).toBe(2)

    expect(plan.new).toBe(DAILY_NEW_CAP - 2)
    expect(view.dueToday).toBe(DAILY_NEW_CAP)
    expect(view.baseline).toBeNull()

    const tomorrow = await homeView(db, deck, at(DAY))
    expect(tomorrow.baseline).toEqual({ label: 'Check before Aug 19', cards: 60 })
    expect(tomorrow.dueToday).toBe(60 + 2 + DAILY_NEW_CAP)
  })
})

describe('homeView, readiness for Sep 10', () => {
  let db: Db
  beforeEach(async () => {
    db = await openTestDb()
  })
  const [first, second] = deck.metas
  if (!first || !second) throw new Error('empty deck')
  const FIRST_CLASS_END = endOfEvaluationDay('2026-09-10')

  const DAY_2 = at(DAY)
  const DAY_3 = at(2 * DAY)
  const DAY_4 = at(3 * DAY)
  const DAY_5 = at(4 * DAY)
  const DAY_6 = at(5 * DAY)
  const DAY_7 = at(6 * DAY)

  const answer = (itemId: string, when: Date) =>
    recordReview(db, deck, posted({ itemId, reviewedAt: when.toISOString() }), when)

  const meanWith = (answered: [string, Date][]): number => {
    const cards = deck.metas.map((meta) => {
      const card = newCard(meta, T0)
      const when = answered.find(([itemId]) => itemId === meta.itemId)?.[1]
      return when ? defaultScheduler.review(card, Rating.Good, when).card : card
    })
    return meanRecall(cards, FIRST_CLASS_END)
  }

  it('starts their pace line from what the learner knew when Aug 21 began, and never moves it', async () => {
    await answer(first.itemId, DAY_2)
    await answer(second.itemId, DAY_4)
    const expected = meanWith([
      [first.itemId, DAY_2],
      [second.itemId, DAY_4],
    ])
    expect(expected).toBeGreaterThan(0)
    expect((await homeView(db, deck, DAY_5)).paceStart).toBeCloseTo(expected, 12)

    await answer(first.itemId, new Date(DAY_5.getTime() + HOUR))
    await answer(second.itemId, DAY_6)
    const later = await homeView(db, deck, DAY_7)
    expect(later.paceStart).toBeCloseTo(expected, 12)
    expect(later.readiness?.now).toBeGreaterThan(expected)
  })

  it('has no pace line before Aug 21 or after Sep 10', async () => {
    expect((await homeView(db, deck, DAY_4)).paceStart).toBeNull()
    expect((await homeView(db, deck, new Date('2026-09-11T17:00:00Z'))).paceStart).toBeNull()
    expect((await homeView(db, deck, new Date('2026-09-11T17:00:00Z'))).readiness).toBeNull()
  })

  it('is their readiness on Sep 10 over every card, and what today’s cards would make it', async () => {
    await answer(first.itemId, DAY_5)
    const view = await homeView(db, deck, DAY_6)
    const state = await loadStudyState(db, deck, DAY_6)
    expect(view.readiness?.now).toBeCloseTo(meanRecall(state.cards, FIRST_CLASS_END), 12)
    expect(view.readiness?.afterToday).toBeGreaterThan(view.readiness?.now ?? 1)
    expect(view.readiness?.afterToday).toBeLessThanOrEqual(1)

    expect(view.studiedToday).toBe(false)
    await answer(second.itemId, new Date(DAY_6.getTime() + MINUTE))
    expect((await homeView(db, deck, new Date(DAY_6.getTime() + 2 * MINUTE))).studiedToday).toBe(
      true,
    )
  })

  it('shows readiness from Aug 20 (the day after practice day) through Sep 10', async () => {
    expect((await homeView(db, deck, DAY_3)).readiness).toBeNull()
    expect((await homeView(db, deck, DAY_4)).readiness).not.toBeNull()
    expect((await homeView(db, deck, new Date('2026-09-10T17:00:00Z'))).readiness).not.toBeNull()
  })
})

describe('weakestMustDo', () => {
  let db: Db
  beforeEach(async () => {
    db = await openTestDb()
  })

  let practiceNumber = 0
  async function practice(doneAt: Date, verdicts: Record<string, 'pass' | 'miss'>) {
    practiceNumber += 1
    const id = `00000000-0000-4000-8000-${String(practiceNumber).padStart(12, '0')}`
    await db.insert(practices).values({
      id,
      deviceId: 'ipad',
      sceneKind: 'main-set',
      scene: {},
      transcript: {},
      startedAt: doneAt,
      doneAt,
    })
    await db
      .insert(gateResults)
      .values(
        Object.entries(verdicts).map(([gateId, verdict]) => ({ practiceId: id, gateId, verdict })),
      )
  }

  it('is null before any practice', async () => {
    expect(await weakestMustDo(db)).toBeNull()
    expect(await weakestMustDoLabel(db)).toBeNull()
  })

  it('breaks a tie with the most recent miss', async () => {
    await practice(at(0), { A2: 'miss' })
    await practice(at(MINUTE), { C1: 'miss' })
    expect(await weakestMustDo(db)).toBe('C1')
  })

  it('looks only at their last 10 practices', async () => {
    for (let n = 0; n < 5; n += 1) await practice(at(n * MINUTE), { A2: 'miss' })
    await practice(at(10 * MINUTE), { C1: 'miss', A2: 'pass' })
    for (let n = 0; n < 9; n += 1) await practice(at((n + 11) * MINUTE), { A2: 'pass' })
    expect(await weakestMustDo(db)).toBe('C1')
  })
})

describe('micPracticesOn', () => {
  it('counts the mic practices the learner finished on their Pacific day only', async () => {
    const db = await openTestDb()

    await insertPractice(db, { doneAt: at(-(9 * 60 + 30) * MINUTE) })
    await insertPractice(db, { doneAt: at(-60 * MINUTE) })
    await insertPractice(db, { doneAt: at(14 * 60 * MINUTE + 30 * MINUTE) })
    await insertPractice(db, { doneAt: at(DAY) })
    expect(await micPracticesOn(db, MORNING)).toBe(2)
    const view = await homeView(db, deck, MORNING)
    expect(view.micPracticesToday).toBe(2)
  })
})
