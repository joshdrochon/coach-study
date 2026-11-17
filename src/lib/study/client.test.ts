import { describe, expect, it } from 'vitest'

import {
  createStudyClient,
  HOME_KEY,
  OUTBOX_KEY,
  StudyClientError,
  type FetchLike,
  type ReviewEvent,
  type StorageLike,
  type Timers,
} from './client'

const CARD = {
  itemId: 'term-range',
  category: 'Floor work',
  type: 'recall',
  prompt: 'Sample Move A: what does it need?',
  answer: 'A mat, a strap and the rollers.',
  explanation: 'Sample Move A needs a mat first.',
  citation: { label: 'Sample guide', quote: 'A mat first.' },
}

const HOME = {
  daysToPracticeDay: 1,
  daysToFirstClass: 18,
  dueToday: 49,
  weakestMustDo: null,
  title: 'Starter',
  name: 'Coach Alex',
  avatarUrl: '/api/profile/avatar',
}

const EVENT: ReviewEvent = {
  eventId: '6f1c2c1e-1b1a-4c55-9a43-7f3f0e7b1a01',
  itemId: 'term-range',
  mode: 'start',
  result: 'right',
  rating: 3,
  proposedRating: 3,
  overridden: false,
  answerText: 'a mat',
  answerMs: 4200,
  hintUsed: false,
  gradedBy: 'tutor',
  traceId: 'trace-1',
  reviewedAt: '2026-08-18T15:00:00.000Z',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const ID = {
  second: '00000000-0000-4000-8000-000000000002',
  dup: '00000000-0000-4000-8000-000000000003',
  bad: '00000000-0000-4000-8000-000000000004',
  later: '00000000-0000-4000-8000-000000000005',
  stuck: '00000000-0000-4000-8000-000000000006',
  fine: '00000000-0000-4000-8000-000000000007',
}

type Call = { url: string; method: string; body: unknown }

function memoryStorage(
  initial: Record<string, string> = {},
): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
  }
}

function server(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetch: FetchLike = async (input, init) => {
    const call = {
      url: input,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    }
    calls.push(call)
    return handler(call)
  }
  return { fetch, calls }
}

const json = (body: unknown, status = 200) => Response.json(body, { status })

describe('StudyClient: next card', () => {
  it('turns away a card that breaks the contract', async () => {
    const { fetch } = server(() =>
      json({ card: { ...CARD, photo: null }, today: { due: 30, newLeft: 8, done: 11 } }),
    )
    const next = createStudyClient({ fetch, storage: null }).next({
      mode: 'start',
      categories: [],
      exclude: [],
    })
    await expect(next).rejects.toMatchObject({ kind: 'invalid' })
  })

  it('keeps the optional fields when the server sends them', async () => {
    const card = {
      ...CARD,
      choices: ['A mat', 'Pegs', 'Hinges'],
      format: 'choices',
      hintFirst: true,
      parts: ['A mat'],
      ordered: false,
      photo: { src: '/api/media/sample-photo-1', alt: 'A sample photo' },
      exercise: 'Sample move a',
      dueInMs: [60_000, 600_000, 259_200_000, 691_200_000],
    }
    const { fetch, calls } = server(() => json({ card, today: { due: 0, newLeft: 0, done: 0 } }))
    const next = await createStudyClient({ fetch, storage: null }).next({
      mode: 'start',
      categories: [],
      exclude: [],
    })
    expect(calls[0]?.url).toBe('/api/study/next?mode=start')
    expect(next.card).toEqual(card)
  })

  it('says when nothing is left', async () => {
    const { fetch } = server(() => json({ card: null, today: { due: 0, newLeft: 0, done: 49 } }))
    const next = await createStudyClient({ fetch, storage: null }).next({
      mode: 'start',
      categories: [],
      exclude: [],
    })
    expect(next.card).toBeNull()
  })

  it('throws typed errors: http, invalid body, no connection', async () => {
    const request = { mode: 'start' as const, categories: [], exclude: [] }
    const http = createStudyClient({ fetch: server(() => json({}, 503)).fetch, storage: null })
    await expect(http.next(request)).rejects.toMatchObject({ kind: 'http', status: 503 })
    const invalid = createStudyClient({
      fetch: server(() => json({ card: 3 })).fetch,
      storage: null,
    })
    await expect(invalid.next(request)).rejects.toMatchObject({ kind: 'invalid' })
    const notJson = createStudyClient({
      fetch: server(() => new Response('<html>', { status: 200 })).fetch,
      storage: null,
    })
    await expect(notJson.next(request)).rejects.toMatchObject({ kind: 'invalid' })
    const offline = createStudyClient({
      fetch: () => Promise.reject(new TypeError('Load failed')),
      storage: null,
    })
    const error: unknown = await offline.next(request).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(StudyClientError)
    expect(error).toMatchObject({ kind: 'network', message: 'network' })
  })

  it('times out instead of hanging', async () => {
    let fire: (() => void) | undefined
    const timers: Timers = {
      after: (_ms, run) => {
        fire = run
        return () => undefined
      },
    }
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      })
    const client = createStudyClient({ fetch, storage: null, timers })
    const pending = client.next({ mode: 'start', categories: [], exclude: [] })
    fire?.()
    await expect(pending).rejects.toMatchObject({ kind: 'timeout' })
  })
})

describe('StudyClient: grading', () => {
  const request = {
    itemId: CARD.itemId,
    answer: 'a mat',
    answerMs: 4200,
    hintUsed: false,
    entry: 'voice' as const,
  }
  const graded = {
    corrections: [{ heard: 'mad', readAs: 'mat' }],
    result: 'right',
    missing: [],
    inOrder: null,
    spoken: 'Got it.',
    followUp: null,
    source: 'tutor',
    traceId: 'trace-1',
  }

  it('posts the answer and returns the grade', async () => {
    const { fetch, calls } = server(() => json(graded))
    const outcome = await createStudyClient({ fetch, storage: null }).grade(request)
    expect(calls[0]).toEqual({ url: '/api/tutor/card', method: 'POST', body: request })
    expect(outcome).toEqual({ ok: true, grade: graded })
  })

  it('reads a grade from an older server (no corrections) as one with none', async () => {
    const older: Partial<typeof graded> = { ...graded }
    delete older.corrections
    const { fetch } = server(() => json(older))
    const outcome = await createStudyClient({ fetch, storage: null }).grade(request)
    expect(outcome).toEqual({ ok: true, grade: { ...older, corrections: [] } })
  })

  it('turns every failure into a reason to self-grade, never a throw', async () => {
    const cases: [() => Response | Promise<Response>, string][] = [
      [() => json({ error: 'daily-cap', fallback: 'self-grade' }, 429), 'daily-cap'],
      [() => json({ error: 'spend-limit', fallback: 'self-grade' }, 429), 'spend-limit'],
      [() => json({ error: 'timeout', fallback: 'self-grade' }, 504), 'timeout'],
      [() => json({ error: 'something new' }, 500), 'http'],
      [() => new Response('Bad gateway', { status: 502 }), 'http'],
      [() => json({ result: 'maybe' }), 'invalid'],
      [() => new Response('not json', { status: 200 }), 'invalid'],
      [() => Promise.reject(new TypeError('Load failed')), 'network'],
    ]
    for (const [handler, reason] of cases) {
      const outcome = await createStudyClient({
        fetch: server(handler).fetch,
        storage: null,
      }).grade(request)
      expect(outcome).toEqual({ ok: false, reason })
    }
  })
})

describe('StudyClient: the outbox (nothing lost)', () => {
  it('saves the review before sending it, then clears it once the server has it', async () => {
    const storage = memoryStorage()
    let seenBeforeSend: string | undefined
    const { fetch, calls } = server(() => {
      seenBeforeSend = storage.getItem(OUTBOX_KEY) ?? undefined
      return json({ ok: true })
    })
    const client = createStudyClient({ fetch, storage })
    await client.review(EVENT)
    expect(calls[0]).toEqual({ url: '/api/study/review', method: 'POST', body: EVENT })

    expect(JSON.parse(seenBeforeSend ?? '[]')).toMatchObject([{ kind: 'review', body: EVENT }])
    expect(client.pendingCount()).toBe(0)
  })

  it('keeps reviews while offline and sends them in order when back', async () => {
    const storage = memoryStorage()
    let online = false
    const { fetch, calls } = server(() =>
      online ? json({ ok: true }) : Promise.reject(new TypeError('offline')),
    )
    const client = createStudyClient({ fetch, storage })
    await client.review(EVENT)
    await client.review({ ...EVENT, eventId: ID.second })
    await client.flag(EVENT.itemId, 'my trainer said groupB too')
    expect(client.pendingCount()).toBe(3)
    online = true
    await client.flush()
    expect(client.pendingCount()).toBe(0)
    const sent = calls.slice(-3).map((call) => [call.url, call.body])
    const flagId = (calls.at(-1)?.body as { flagId?: string } | undefined)?.flagId
    expect(flagId).toMatch(UUID)
    expect(sent).toEqual([
      ['/api/study/review', EVENT],
      ['/api/study/review', { ...EVENT, eventId: ID.second }],
      ['/api/flags', { itemId: EVENT.itemId, note: 'my trainer said groupB too', flagId }],
    ])
  })

  it('sends a note again with the same ID after a timeout, so the server stores it once', async () => {
    let attempt = 0
    const { fetch, calls } = server(() =>
      ++attempt === 1 ? Promise.reject(new TypeError('timed out')) : json({ ok: true }),
    )
    const client = createStudyClient({ fetch, storage: memoryStorage() })
    await client.flag(EVENT.itemId, 'my trainer said groupB too')
    expect(client.pendingCount()).toBe(1)
    await client.flag('floor-glide-parts', 'another card')
    expect(client.pendingCount()).toBe(0)
    const flags = calls.filter((call) => call.url === '/api/flags')
    const ids = flags.map((call) => (call.body as { flagId?: string }).flagId)
    expect(ids).toHaveLength(3)
    expect(ids[0]).toMatch(UUID)

    expect(ids[1]).toBe(ids[0])
    expect(ids[2]).not.toBe(ids[0])
  })

  it('sends the answer a note is about with it, kept through the outbox', async () => {
    const storage = memoryStorage()
    let online = false
    const { fetch, calls } = server(() =>
      online ? json({ ok: true }) : Promise.reject(new TypeError('offline')),
    )
    const answer = {
      text: 'a mat and rollers',
      reviewedAt: EVENT.reviewedAt,
      result: 'partial' as const,
      gradedBy: 'tutor' as const,
      entry: 'typed' as const,
    }
    await createStudyClient({ fetch, storage }).flag(EVENT.itemId, 'it heard me wrong', answer)
    online = true

    await createStudyClient({ fetch, storage }).flush()
    const flags = calls.filter((call) => call.url === '/api/flags')
    expect(flags.at(-1)?.body).toEqual({
      itemId: EVENT.itemId,
      note: 'it heard me wrong',
      flagId: expect.stringMatching(UUID) as unknown,
      answer,
    })

    const ids = new Set(flags.map((call) => (call.body as { flagId?: string }).flagId))
    expect(ids.size).toBe(1)
  })

  it('keeps a queued note whose answer doesn’t parse, sending it without the answer', async () => {
    const queued = {
      kind: 'flag',
      body: { itemId: EVENT.itemId, note: 'kept', answer: { text: 'x', reviewedAt: 'soon' } },
    }
    const storage = memoryStorage({ [OUTBOX_KEY]: JSON.stringify([queued]) })
    const { fetch, calls } = server(() => json({ ok: true }))
    await createStudyClient({ fetch, storage }).flush()
    expect(calls.map((call) => [call.url, call.body])).toEqual([
      ['/api/flags', { itemId: EVENT.itemId, note: 'kept' }],
    ])
  })

  it('still sends a note an older copy of the app queued without an ID', async () => {
    const legacy = { kind: 'flag', body: { itemId: EVENT.itemId, note: 'queued before ids' } }
    const storage = memoryStorage({ [OUTBOX_KEY]: JSON.stringify([legacy]) })
    const { fetch, calls } = server(() => json({ ok: true }))
    await createStudyClient({ fetch, storage }).flush()
    expect(calls.map((call) => [call.url, call.body])).toEqual([['/api/flags', legacy.body]])
    expect(storage.getItem(OUTBOX_KEY)).toBe('[]')
  })

  it('still sends after a pass that found nothing to send (Home flushes an empty outbox first)', async () => {
    const { fetch, calls } = server(() => json({ ok: true }))
    const client = createStudyClient({ fetch, storage: memoryStorage() })
    await client.flush()
    await client.review(EVENT)
    expect(calls.map((call) => call.url)).toEqual(['/api/study/review'])
    expect(client.pendingCount()).toBe(0)
  })

  it('survives a reload: a new client sends what the last one saved', async () => {
    const storage = memoryStorage({
      [OUTBOX_KEY]: JSON.stringify([{ kind: 'review', body: EVENT }]),
    })
    const { fetch, calls } = server(() => json({ ok: true }))
    await createStudyClient({ fetch, storage }).flush()
    expect(calls).toHaveLength(1)
    expect(storage.getItem(OUTBOX_KEY)).toBe('[]')
  })

  it('treats a duplicate as delivered, drops a malformed one, and retries a server error', async () => {
    const statuses = [409, 400, 503]
    const { fetch, calls } = server(() => json({}, statuses.shift() ?? 200))
    const client = createStudyClient({ fetch, storage: memoryStorage() })
    await client.review({ ...EVENT, eventId: ID.dup })
    await client.review({ ...EVENT, eventId: ID.bad })
    await client.review({ ...EVENT, eventId: ID.later })
    expect(client.pendingCount()).toBe(1)
    await client.flush()
    expect(client.pendingCount()).toBe(0)
    expect(calls.map((call) => (call.body as ReviewEvent).eventId)).toEqual([
      ID.dup,
      ID.bad,
      ID.later,
      ID.later,
    ])
  })

  it('keeps a review when the route is not there yet or the learner is signed out', async () => {
    const notDeployed = () =>
      new Response('<!DOCTYPE html><title>404</title>', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      })
    for (const handler of [notDeployed, () => json({}, 401), () => json({}, 429)]) {
      const client = createStudyClient({ fetch: server(handler).fetch, storage: memoryStorage() })
      await client.review(EVENT)
      expect(client.pendingCount()).toBe(1)
    }
  })

  it('drops a note about a card the server says doesn’t exist', async () => {
    const client = createStudyClient({
      fetch: server(() => json({ error: 'unknown card' }, 404)).fetch,
      storage: memoryStorage(),
    })
    await client.flag('no-such-card', 'wrong')
    expect(client.pendingCount()).toBe(0)
  })

  it('a stuck entry never holds up the ones behind it; no connection stops the pass', async () => {
    const storage = memoryStorage()
    const { fetch, calls } = server((call) =>
      (call.body as ReviewEvent).eventId === ID.stuck ? json({}, 500) : json({ ok: true }),
    )
    const client = createStudyClient({ fetch, storage })
    await client.review({ ...EVENT, eventId: ID.stuck })
    await client.review({ ...EVENT, eventId: ID.fine })
    expect(client.pendingCount()).toBe(1)
    expect(JSON.parse(storage.getItem(OUTBOX_KEY) ?? '[]')).toMatchObject([
      { kind: 'review', body: { ...EVENT, eventId: ID.stuck } },
    ])
    expect(calls.map((call) => (call.body as ReviewEvent).eventId)).toEqual([
      ID.stuck,
      ID.stuck,
      ID.fine,
    ])

    let attempts = 0
    const offline = createStudyClient({
      fetch: () => {
        attempts += 1
        return Promise.reject(new TypeError('offline'))
      },
      storage: memoryStorage({
        [OUTBOX_KEY]: JSON.stringify([
          { kind: 'review', body: EVENT },
          { kind: 'review', body: { ...EVENT, eventId: ID.second } },
        ]),
      }),
    })
    await offline.flush()
    expect(attempts).toBe(1)
    expect(offline.pendingCount()).toBe(2)
  })

  it('a review queued while a pass is running is sent before its review() resolves', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { fetch, calls } = server(async (call) => {
      if (call.url === '/api/flags') await gate
      return json({ ok: true })
    })
    const client = createStudyClient({ fetch, storage: memoryStorage() })
    const flagged = client.flag(EVENT.itemId, 'my trainer said groupB too')
    let reviewed = false
    const review = client.review(EVENT).then(() => {
      reviewed = true
    })
    await Promise.resolve()
    expect(reviewed).toBe(false)
    release?.()
    await Promise.all([flagged, review])
    expect(calls.map((call) => call.url)).toEqual(['/api/flags', '/api/study/review'])
    expect(client.pendingCount()).toBe(0)
  })

  it('when storage is full, the outbox carries on in memory: nothing lost, nothing sent twice', async () => {
    const stored = memoryStorage()
    let full = false
    const storage: StorageLike = {
      getItem: (key) => stored.getItem(key),
      setItem: (key, value) => {
        if (full) throw new DOMException('full', 'QuotaExceededError')
        stored.setItem(key, value)
      },
    }
    let online = false
    const { fetch, calls } = server(() =>
      online ? json({ ok: true }) : Promise.reject(new TypeError('offline')),
    )
    const client = createStudyClient({ fetch, storage })
    await client.review(EVENT)
    full = true
    await client.flag(EVENT.itemId, 'note')
    expect(client.pendingCount()).toBe(2)
    online = true
    await client.flush()
    expect(client.pendingCount()).toBe(0)
    await client.flush()
    expect(calls.filter((call) => call.method === 'POST' && call.body !== undefined)).toHaveLength(
      4,
    )
    expect(calls.slice(-2).map((call) => call.url)).toEqual(['/api/study/review', '/api/flags'])
  })

  it('sends each review once even when flushes overlap', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { fetch, calls } = server(async () => {
      await gate
      return json({ ok: true })
    })
    const client = createStudyClient({ fetch, storage: memoryStorage() })
    const first = client.review(EVENT)
    const second = client.flush()
    release?.()
    await Promise.all([first, second])
    expect(calls).toHaveLength(1)
  })

  it('ignores a corrupt outbox and works without storage', async () => {
    const corrupt = memoryStorage({ [OUTBOX_KEY]: '{"not":"a list"}' })
    expect(
      createStudyClient({ fetch: server(() => json({})).fetch, storage: corrupt }).pendingCount(),
    ).toBe(0)
    const junk = memoryStorage({ [OUTBOX_KEY]: '[{"kind":"other"}, "x"]' })
    expect(
      createStudyClient({ fetch: server(() => json({})).fetch, storage: junk }).pendingCount(),
    ).toBe(0)
    const unreadable = memoryStorage({ [OUTBOX_KEY]: 'not json' })
    expect(
      createStudyClient({
        fetch: server(() => json({})).fetch,
        storage: unreadable,
      }).pendingCount(),
    ).toBe(0)

    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    let online = false
    const { fetch } = server(() => (online ? json({ ok: true }) : json({}, 503)))
    const client = createStudyClient({ fetch, storage: throwing })
    await client.review(EVENT)
    expect(client.pendingCount()).toBe(1)
    online = true
    await client.flush()
    expect(client.pendingCount()).toBe(0)
  })
})

describe('StudyClient: Home', () => {
  it('sends their time zone, caches Home, and reads the cache back', async () => {
    const storage = memoryStorage()
    const { fetch, calls } = server(() => json(HOME))
    const client = createStudyClient({ fetch, storage, timeZone: () => 'America/New_York' })
    expect(client.cachedHome()).toBeNull()
    expect(await client.home()).toEqual(HOME)
    expect(calls[0]?.url).toBe('/api/home?tz=America%2FNew_York')
    expect(JSON.parse(storage.getItem(HOME_KEY) ?? '{}')).toEqual(HOME)
    expect(createStudyClient({ fetch, storage }).cachedHome()).toEqual(HOME)
  })

  it('works without a time zone or storage, and ignores a bad cache', async () => {
    const { fetch, calls } = server(() => json(HOME))
    const client = createStudyClient({ fetch, storage: null, timeZone: () => undefined })
    await client.home()
    expect(calls[0]?.url).toBe('/api/home')
    expect(client.cachedHome()).toEqual(HOME)
    const bad = memoryStorage({ [HOME_KEY]: '{"daysToPracticeDay":"soon"}' })
    expect(createStudyClient({ fetch, storage: bad }).cachedHome()).toBeNull()
    const broken = memoryStorage({ [HOME_KEY]: '{' })
    expect(createStudyClient({ fetch, storage: broken }).cachedHome()).toBeNull()
    const full: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
    }
    const cached = createStudyClient({ fetch, storage: full })
    await cached.home()
    expect(cached.cachedHome()).toEqual(HOME)
  })

  it('uses the real fetch, storage and time zone by default', () => {
    const client = createStudyClient()
    expect(client.pendingCount()).toBe(0)
    expect(client.cachedHome()).toBeNull()
  })
})

describe('StudyClient: sending keeps failing (the outbox)', () => {
  it('a try that gets one answer through but must keep another still counts as failing', async () => {
    const storage = memoryStorage()
    let stuckAnswered = 0
    const { fetch } = server((call) => {
      const id = (call.body as { eventId?: string } | undefined)?.eventId
      if (id === ID.stuck) {
        stuckAnswered += 1
        return json({ error: 'rate_limited' }, 429)
      }
      return json({ ok: true })
    })
    const client = createStudyClient({ fetch, storage, local: null })
    await client.review({ ...EVENT, eventId: ID.stuck })
    expect(client.sendTrouble()).toBe(false)
    await client.review({ ...EVENT, eventId: ID.fine })

    expect(client.pendingCount()).toBe(1)
    expect(stuckAnswered).toBe(2)
    expect(client.sendTrouble()).toBe(true)
  })

  it('an answer the server can never take (400) is dropped, not waited on: no trouble', async () => {
    const { fetch } = server(() => json({ error: 'invalid' }, 400))
    const client = createStudyClient({ fetch, storage: memoryStorage(), local: null })
    await client.review(EVENT)
    await client.flush()
    expect(client.pendingCount()).toBe(0)
    expect(client.sendTrouble()).toBe(false)
  })

  it('flushes asked for while a try is running join it: one try, not several', async () => {
    const storage = memoryStorage({
      [OUTBOX_KEY]: JSON.stringify([{ kind: 'review', body: EVENT }]),
    })
    const { fetch, calls } = server(() => Promise.reject(new TypeError('offline')))
    const client = createStudyClient({ fetch, storage, local: null })

    await Promise.all([client.flush(), client.flush(), client.flush()])
    expect(calls.length).toBeGreaterThan(1)
    expect(client.sendTrouble()).toBe(false)
    await client.flush()
    expect(client.sendTrouble()).toBe(true)
  })

  it('a waiting note counts as waiting work too, and clears when it goes', async () => {
    let online = false
    const { fetch } = server(() =>
      online ? json({ ok: true }) : Promise.reject(new TypeError('offline')),
    )
    const client = createStudyClient({ fetch, storage: memoryStorage(), local: null })
    await client.flag(EVENT.itemId, 'my trainer said groupB too')
    await client.flush()
    expect(client.sendTrouble()).toBe(true)
    online = true
    await client.flush()
    expect(client.sendTrouble()).toBe(false)
  })
})
