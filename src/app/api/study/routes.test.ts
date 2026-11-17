import { randomUUID } from 'node:crypto'

import { NextRequest } from 'next/server'
import { Rating, State } from 'ts-fsrs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Db } from '@/lib/db/client'
import { cardStates, itemFlags, reviewEvents } from '@/lib/db/schema'
import { defaultScheduler, newCard } from '@/lib/scheduler/fsrs'
import { DAILY_NEW_CAP } from '@/lib/scheduler/queue'
import {
  homeViewSchema,
  nextResponseSchema,
  syncResponseSchema,
  type CardView,
  type NextResponse,
  type ReviewEvent,
} from '@/lib/study/contract'
import { loadDeck } from '@/lib/study/deck'
import { learningView } from '@/lib/study/learning'
import { loadStudyState } from '@/lib/study/state'
import { storeCheckDone } from '@/test/baseline-done'
import { DAY, MINUTE, T0 } from '@/test/study-fixtures'

import { TEST_ENV } from '../../../../e2e/test-env'

const BASE = 'http://127.0.0.1:3000'
const deck = loadDeck()
let db: Db

beforeAll(async () => {
  for (const [key, value] of Object.entries(TEST_ENV)) {
    if (key !== 'NODE_ENV') vi.stubEnv(key, value)
  }
  const { getDb } = await import('@/lib/db/client')
  db = await getDb()
  await Promise.all([
    import('./next/route'),
    import('./review/route'),
    import('./sync/route'),
    import('../home/route'),
  ])
  vi.useFakeTimers({ toFake: ['Date'] })
}, 60_000)

afterAll(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

const cards = deck.metas.map((meta) => newCard(meta, T0))
let CHECK = 0

beforeEach(async () => {
  await db.delete(reviewEvents)
  await db.delete(cardStates)
  await db.delete(itemFlags)
  CHECK = await storeCheckDone(db, cards)
  vi.setSystemTime(T0)
})

const now = (): Date => new Date()
const advance = (ms: number): void => {
  vi.setSystemTime(new Date(Date.now() + ms))
}

async function getNext(search: string): Promise<{ status: number; body: unknown }> {
  const { GET } = await import('./next/route')
  const response = await GET(new NextRequest(`${BASE}/api/study/next?${search}`))
  return { status: response.status, body: await response.json() }
}

async function next(search = 'mode=start'): Promise<NextResponse> {
  const { status, body } = await getNext(search)
  expect(status).toBe(200)
  return nextResponseSchema.parse(body)
}

async function post(body: unknown): Promise<{ status: number; body: unknown; type: string }> {
  const { POST } = await import('./review/route')
  const response = await POST(
    new NextRequest(`${BASE}/api/study/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )
  return {
    status: response.status,
    body: await response.json(),
    type: response.headers.get('content-type') ?? '',
  }
}

async function home(search = ''): Promise<ReturnType<typeof homeViewSchema.parse>> {
  const { GET } = await import('../home/route')
  const response = await GET(new NextRequest(`${BASE}/api/home${search}`))
  expect(response.status).toBe(200)
  return homeViewSchema.parse(await response.json())
}

type Rated = 1 | 2 | 3 | 4

function answer(
  card: Pick<CardView, 'itemId'>,
  rating: Rated = 3,
  overrides: Partial<ReviewEvent> = {},
): ReviewEvent {
  return {
    eventId: randomUUID(),
    itemId: card.itemId,
    mode: 'start',
    result: rating === 1 ? 'wrong' : 'right',
    rating,
    proposedRating: rating,
    overridden: false,
    answerText: 'their answer',
    answerMs: 6000,
    hintUsed: false,
    gradedBy: 'tutor',
    traceId: null,
    reviewedAt: now().toISOString(),
    ...overrides,
  }
}

async function stored(event: ReviewEvent): Promise<void> {
  const response = await post(event)
  expect(response).toMatchObject({ status: 200, body: { ok: true } })
}

async function fsrsOf(itemId: string) {
  const state = await loadStudyState(db, deck, now())
  return state.cards.find((card) => card.itemId === itemId)?.fsrs
}

async function studyUntilDone(search = 'mode=start', limit = 400) {
  const seen = new Map<string, number>()
  let last: NextResponse | null = null
  for (let turn = 0; turn < limit; turn += 1) {
    last = await next(search)
    if (last.card === null) return { seen, last, answers: turn }
    advance(20_000)
    await stored(answer(last.card, 3, { mode: search.includes('focus') ? 'focus' : 'start' }))
    seen.set(last.card.itemId, (seen.get(last.card.itemId) ?? 0) + 1)
    advance(5_000)
  }
  throw new Error(`still studying after ${String(limit)} cards`)
}

describe('a day of studying in Start', () => {
  it('works through the day’s new cards until Done for today', async () => {
    const morning = await next()
    expect(morning.today).toEqual({ due: 0, newLeft: DAILY_NEW_CAP, done: CHECK })
    expect((await home()).dueToday).toBe(morning.today.due + morning.today.newLeft)

    const { seen, last, answers } = await studyUntilDone()

    expect([...seen.values()].every((count) => count === 2)).toBe(true)

    expect(seen.size).toBe(DAILY_NEW_CAP)
    expect(last.today).toEqual({ due: 0, newLeft: 0, done: CHECK + answers })

    const categories = new Set(deck.metas.map((meta) => meta.category))
    const studied = new Set([...seen.keys()].map((id) => deck.metaById.get(id)?.category))
    expect(studied).toEqual(categories)
    expect((await home()).dueToday).toBe(0)

    advance(2 * DAY)
    const later = await next()
    expect(later.card).not.toBeNull()
    expect(later.today.due).toBeGreaterThan(0)
    expect((await home()).dueToday).toBe(later.today.due + later.today.newLeft)
  }, 120_000)
})

describe('POST /api/study/review', () => {
  it('stores a resent answer once (409 with a JSON body) and changes nothing', async () => {
    const { card } = await next()
    if (!card) throw new Error('no card')
    const event = answer(card)
    await stored(event)
    const before = await db.select().from(cardStates)
    const resend = await post(event)
    expect(resend).toMatchObject({ status: 409, body: { error: 'duplicate' } })
    expect(resend.type).toContain('application/json')
    expect(await db.select().from(cardStates)).toEqual(before)
    expect(await db.select().from(reviewEvents)).toHaveLength(CHECK + 1)
  })

  it('refuses a card not in the bank with a JSON 404, and a malformed event with a 400', async () => {
    const unknown = await post(answer({ itemId: 'not-a-card' }))
    expect(unknown).toMatchObject({ status: 404, body: { error: 'unknown-item' } })
    expect(unknown.type).toContain('application/json')
    expect(await post('{not json')).toMatchObject({ status: 400, body: { error: 'invalid' } })
    const noId = Object.fromEntries(
      Object.entries(answer({ itemId: 'term-tempo' })).filter(([key]) => key !== 'eventId'),
    )
    expect((await post(noId)).status).toBe(400)
    expect((await post({ ...answer({ itemId: 'term-tempo' }), rating: 5 })).status).toBe(400)
    expect(await db.select().from(reviewEvents)).toHaveLength(CHECK)
  })

  it('stores every answer with exactly one of the four FSRS ratings, and nothing else', async () => {
    const item = { itemId: 'term-tempo' }
    for (const bad of [0, 5, 2.5, '3', null, -1]) {
      expect((await post({ ...answer(item), rating: bad })).status).toBe(400)
      expect((await post({ ...answer(item), proposedRating: bad })).status).toBe(400)
    }
    const noRating = Object.fromEntries(
      Object.entries(answer(item)).filter(([key]) => key !== 'rating'),
    )
    expect((await post(noRating)).status).toBe(400)
    expect(await db.select().from(reviewEvents)).toHaveLength(CHECK)

    const grades = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as const
    const posted = grades.map((grade, index) => {
      const meta = deck.metas[index]
      if (!meta) throw new Error('deck too small')
      return answer(meta, grade)
    })
    for (const event of posted) await stored(event)
    const rows = await db.select().from(reviewEvents)
    const mine = rows.filter((row) => posted.some((event) => event.eventId === row.id))
    expect(mine.map((row) => [row.rating, row.proposedRating]).toSorted()).toEqual(
      grades.map((grade) => [grade, grade]),
    )

    expect(rows.every((row) => ([1, 2, 3, 4] as number[]).includes(row.rating))).toBe(true)
  })

  it('ends a rating the learner changes later as if the learner had picked it', async () => {
    const { card } = await next()
    if (!card) throw new Error('no card')
    const given = answer(card, 3)
    await stored(given)
    advance(30_000)

    await stored({ ...given, eventId: randomUUID(), rating: 1, overridden: true })
    const meta = deck.metaById.get(card.itemId)
    if (!meta) throw new Error('not in deck')
    const expected = defaultScheduler.review(newCard(meta, T0), Rating.Again, T0).card.fsrs
    expect(await fsrsOf(card.itemId)).toEqual(expected)

    advance(2 * MINUTE)
    const again = await next()
    expect(again.card?.itemId).toBe(card.itemId)
    expect(again.today.done).toBe(CHECK + 1)
  })

  it('gives the same state when two tabs post interleaved answers out of order', async () => {
    const [c1, c2, c3] = deck.metas
    if (!c1 || !c2 || !c3) throw new Error('empty deck')
    const at = (ms: number) => new Date(T0.getTime() + ms).toISOString()
    const tabA = [
      answer(c1, 3, { reviewedAt: at(0), deviceId: 'tab-a' }),
      answer(c2, 1, { reviewedAt: at(30_000), deviceId: 'tab-a' }),
      answer(c2, 3, { reviewedAt: at(2 * MINUTE), deviceId: 'tab-a' }),
      answer(c1, 3, { reviewedAt: at(12 * MINUTE), deviceId: 'tab-a' }),
    ]
    const tabB = [
      answer(c3, 3, { reviewedAt: at(10_000), deviceId: 'tab-b' }),
      answer(c1, 1, { reviewedAt: at(40_000), deviceId: 'tab-b' }),
      answer(c3, 3, { reviewedAt: at(11 * MINUTE), deviceId: 'tab-b' }),
    ]
    const inOrder = [...tabA, ...tabB].toSorted((a, b) => a.reviewedAt.localeCompare(b.reviewedAt))

    const outOfOrder = [...tabB, ...tabA.toReversed()]

    async function run(events: ReviewEvent[]) {
      await db.delete(reviewEvents)
      await db.delete(cardStates)
      await storeCheckDone(db, cards)
      vi.setSystemTime(new Date(T0.getTime() + 20 * MINUTE))
      for (const event of events) await stored(event)
      const cache = (await db.select().from(cardStates))
        .map(({ itemId, card, eventCount }) => ({ itemId, card, eventCount }))
        .toSorted((a, b) => a.itemId.localeCompare(b.itemId))
      return { cache, next: await next(), home: await home() }
    }
    const expected = await run(inOrder)
    expect(await run(outOfOrder)).toEqual(expected)
    expect(expected.cache).toHaveLength(3)
    expect(expected.next.today.done).toBe(CHECK + 7)
  })
})

describe('Focus', () => {
  it('refuses focus without a category, an unknown category, or an unknown mode', async () => {
    for (const search of [
      'mode=focus',
      'mode=focus&categories=',
      'mode=focus&categories=Cardio',
      'mode=everything',
      '',
    ]) {
      expect(await getNext(search)).toEqual({ status: 400, body: { error: 'invalid' } })
    }
  })
})

describe('the 25-answer dial', () => {
  it('below 80% right: a hint first, choices for struggling cards, no new cards', async () => {
    const withChoices = deck.bank.items.filter((item) => item.choices).slice(0, 6)
    for (const item of withChoices) {
      await stored(answer({ itemId: item.id }, 1))
      advance(1000)
    }
    advance(2 * MINUTE)
    const view = await next()
    expect(view.card?.hintFirst).toBe(true)
    expect(view.card?.format).toBe('choices')
    const item = deck.bank.byId.get(view.card?.itemId ?? '')
    expect(view.card?.choices?.toSorted()).toEqual(item?.choices?.toSorted())
    expect(view.today).toMatchObject({ newLeft: 0, due: 6, done: CHECK + 6 })
    expect((await home()).dueToday).toBe(view.today.due + view.today.newLeft)

    const card = view.card
    if (!card) throw new Error('no card')
    advance(20_000)
    await stored(answer(card, 3, { hintUsed: true, hintImposed: true, format: 'choices' }))
    const fsrs = await fsrsOf(card.itemId)
    expect(fsrs?.learning_steps).toBe(1)
    expect(fsrs && fsrs.due.getTime() - Date.now()).toBe(10 * MINUTE)
  })
})

describe('the baseline check', () => {
  it('serves the day-1 round as free recall until it is done; Home and the Learning tab follow', async () => {
    await db.delete(reviewEvents)
    await db.delete(cardStates)

    expect((await home()).baseline).toEqual({ label: 'Day-1 check', cards: 60 })
    const first = await next()
    expect(first.card?.baseline).toBe(true)
    expect(first.card?.itemId).toBe((await next('mode=baseline')).card?.itemId)
    const served: string[] = []
    for (let turn = 0; turn < 100; turn += 1) {
      const view = await next('mode=baseline')
      if (!view.card) break
      expect(view.card).toMatchObject({ format: 'free', hintFirst: false })
      expect(view.card.choices).toBeUndefined()
      expect(view.card.dueInMs).toBeUndefined()
      expect(view.today).toEqual({ due: 60 - turn, newLeft: 0, done: turn })
      served.push(view.card.itemId)
      advance(20_000)

      await stored(answer(view.card, turn % 4 === 0 ? 1 : 3, { mode: 'baseline' }))
      advance(5_000)
    }
    expect(served).toHaveLength(60)
    expect(new Set(served).size).toBe(60)
    expect((await next('mode=baseline')).card).toBeNull()
    expect((await home()).baseline).toBeNull()

    const state = await loadStudyState(db, deck, now())
    const placed = state.cards.filter(
      (card) => served.includes(card.itemId) && card.fsrs.state === State.Review,
    )
    expect(placed).toHaveLength(45)
    expect(
      state.cards.filter((card) => served.includes(card.itemId) && card.fsrs.state === State.New),
    ).toHaveLength(15)

    expect(await learningView(db, deck, now())).toMatchObject({
      baseline: { label: 'Baseline · Aug 17', pct: 0.75, of: 60 },
      now: null,
    })

    const start = await next()
    expect(start.card).not.toBeNull()
    expect(start.today).toMatchObject({ newLeft: DAILY_NEW_CAP, done: 60 })
  }, 120_000)
})

describe('GET /api/home', () => {
  it('counts days in the time zone their iPad sends, and in theirs for an unknown one', async () => {
    vi.setSystemTime(new Date('2026-08-19T06:30:00Z'))
    expect((await home('?tz=America%2FNew_York')).daysToPracticeDay).toBe(0)
    expect((await home('?tz=america%2Fnew_york')).daysToPracticeDay).toBe(0)
    expect((await home('?tz=Mars%2FOlympus')).daysToPracticeDay).toBe(1)
    expect(await home()).toMatchObject({
      daysToPracticeDay: 1,
      name: 'Coach Alex',
      avatarUrl: '/api/avatar?v=default',
      weakestMustDo: null,
    })
  })

  it('leaves a flagged card out of rotation', async () => {
    const first = (await next()).card
    if (!first) throw new Error('no card')
    await db.insert(itemFlags).values({ itemId: first.itemId, reason: 'this-looks-wrong' })
    expect((await next()).card?.itemId).not.toBe(first.itemId)
  })
})

describe('GET /api/study/sync', () => {
  async function getSync(search = '') {
    const { GET } = await import('./sync/route')
    const response = await GET(new NextRequest(`${BASE}/api/study/sync${search}`))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    return syncResponseSchema.parse(await response.json())
  }

  it('gives the iPad the deck once, then every answer and the cards pulled from rotation', async () => {
    await db.delete(reviewEvents)
    const first = await getSync()
    expect(first.deck).toHaveLength(deck.metas.length)
    expect(first.events).toEqual([])
    const { card } = await next()
    if (!card) throw new Error('no card')
    const event = answer(card)
    await stored(event)
    await db.insert(itemFlags).values({ itemId: card.itemId, reason: 'this-looks-wrong' })
    const again = await getSync(`?deck=${first.deckVersion}`)
    expect(again.deck).toBeNull()
    expect(again.deckVersion).toBe(first.deckVersion)
    expect(again.events.map((stored) => stored.id)).toEqual([event.eventId])
    expect(again.quarantined).toEqual([card.itemId])
  })
})

describe('the passcode gate', () => {
  it('refuses the study routes without their session and lets them through with it', async () => {
    const { proxy } = await import('@/proxy')
    const { SESSION_COOKIE, signSession } = await import('@/lib/auth/session')
    const token = await signSession('app', TEST_ENV.SESSION_SECRET ?? '')
    for (const path of [
      '/api/study/next?mode=start',
      '/api/study/review',
      '/api/study/sync',
      '/api/home',
    ]) {
      const refused = await proxy(new NextRequest(`${BASE}${path}`))
      expect(refused.status).toBe(401)
      const allowed = await proxy(
        new NextRequest(`${BASE}${path}`, {
          headers: { cookie: `${SESSION_COOKIE.app}=${token}` },
        }),
      )
      expect(allowed.status).toBe(200)
      expect(allowed.headers.get('x-middleware-next')).toBe('1')
    }
  })
})
