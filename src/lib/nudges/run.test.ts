import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { insertPractice } from '@/test/practice-rows'
import { posted } from '@/test/study-fixtures'
import { fakeDevice } from '@/test/web-push'

import { openTestDb, type Db } from '../db/client'
import {
  cardStates,
  gateResults,
  itemFlags,
  nudges,
  practices,
  pushSubscriptions,
  reviewEvents,
} from '../db/schema'
import { loadDeck } from '../study/deck'
import { homeView } from '../study/home'
import { recordReview } from '../study/state'

import type { NudgeMessage } from './copy'
import { recentNudges } from './log'
import type { Delivery, PushSender } from './push'
import { lastActivityAt, runNudges } from './run'
import { listSubscriptions, saveSubscription } from './subscriptions'

const HOUR = 3_600_000
const deck = loadDeck()
let db: Db

beforeAll(async () => {
  db = await openTestDb()
  vi.useFakeTimers({ toFake: ['Date'] })
}, 60_000)
afterAll(() => {
  vi.useRealTimers()
})
beforeEach(async () => {
  for (const table of [
    nudges,
    pushSubscriptions,
    reviewEvents,
    cardStates,
    itemFlags,
    gateResults,
    practices,
  ]) {
    await db.delete(table)
  }
})

type Sent = { endpoint: string; message: NudgeMessage; ttl: number }

function fakeSender(answer: (endpoint: string) => Delivery = () => ({ ok: true })) {
  const sent: Sent[] = []
  const send: PushSender = (target, message, ttl) => {
    sent.push({ endpoint: target.endpoint, message, ttl })
    return Promise.resolve(answer(target.endpoint))
  }
  return { sent, send }
}

async function check(at: string, send: PushSender) {
  const now = new Date(at)
  vi.setSystemTime(now)
  return runNudges(db, () => deck, now, send)
}

async function turnOn(device = fakeDevice()) {
  await saveSubscription(db, device.subscription, new Date('2026-08-16T20:00:00Z'))
  return device
}

const pacificTime = (at: Date) =>
  at.toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })

describe('the hourly reminder check', () => {
  it('sends two daily reminders on a day the learner hasn’t studied, and logs each one', async () => {
    const device = await turnOn()
    const sender = fakeSender()
    const outcomes: string[] = []

    for (let hour = 0; hour < 24; hour += 1) {
      const at = new Date(Date.parse('2026-08-17T07:07:00Z') + hour * HOUR).toISOString()
      const result = await check(at, sender.send)
      outcomes.push(result.outcome)
    }
    expect(outcomes.filter((outcome) => outcome === 'sent')).toHaveLength(2)
    expect(sender.sent.map((s) => s.endpoint)).toEqual([
      device.subscription.endpoint,
      device.subscription.endpoint,
    ])
    expect(sender.sent[0]?.message).toEqual({
      title: 'Two days to practice day.',

      body: '100 cards for today. Start when you’re ready.',
      url: '/',
      tag: 'coach-study-reminder',
    })
    const log = await recentNudges(db)
    expect(log.map((row) => [row.seq, row.status, pacificTime(row.createdAt)])).toEqual([
      [1, 'sent', '14:07'],
      [0, 'sent', '08:07'],
    ])
    expect(log.every((row) => row.day === '2026-08-17' && row.delivered === 1)).toBe(true)
  })

  it('says the same as Home: the countdown and the cards for today', async () => {
    await turnOn()
    const sender = fakeSender()
    const at = '2026-08-18T16:07:00Z'
    await check(at, sender.send)
    const home = await homeView(db, deck, new Date(at))
    expect(sender.sent[0]?.message.title).toBe('One day to practice day.')
    expect(sender.sent[0]?.message.body).toBe(
      `${String(home.dueToday)} cards for today. Start when you’re ready.`,
    )
  })

  it('does nothing without a device that turned reminders on', async () => {
    const sender = fakeSender()
    expect(await check('2026-08-17T16:07:00Z', sender.send)).toEqual({
      outcome: 'skipped',
      reason: 'no-subscription',
      delivered: 0,
      failed: 0,
      removed: 0,
    })
    expect(await recentNudges(db)).toEqual([])
  })

  it('keeps quiet hours without waking the database or reading the card bank', async () => {
    const asleep = new Proxy(
      {},
      {
        get() {
          throw new Error('the database was used in quiet hours')
        },
      },
    ) as Db
    const noDeck = () => {
      throw new Error('the card bank was read in quiet hours')
    }
    const sender = fakeSender()
    for (const night of ['2026-08-18T05:07:00Z', '2026-08-18T14:07:00Z']) {
      expect(await runNudges(asleep, noDeck, new Date(night), sender.send)).toMatchObject({
        outcome: 'skipped',
        reason: 'quiet-hours',
      })
    }
    expect(sender.sent).toEqual([])
  })

  it('waits while the learner studies, then reminds them about the cards left', async () => {
    await turnOn()
    const sender = fakeSender()
    const [first] = deck.metas
    if (!first) throw new Error('empty deck')

    const answeredAt = new Date('2026-08-17T15:40:00Z')
    await recordReview(
      db,
      deck,
      posted({ itemId: first.itemId, reviewedAt: answeredAt.toISOString() }),
      answeredAt,
    )
    expect(await lastActivityAt(db)).toEqual(answeredAt)
    expect(await check('2026-08-17T16:07:00Z', sender.send)).toMatchObject({
      outcome: 'skipped',
      reason: 'studying',
    })
    const later = await check('2026-08-17T17:07:00Z', sender.send)
    expect(later).toMatchObject({ outcome: 'sent', reason: 'cards-left', delivered: 1 })
    expect(sender.sent[0]?.message.body).toMatch(
      / cards left for today\. Start when you’re ready\.$/,
    )
  })

  it('counts a mic practice as studying too', async () => {
    await turnOn()
    const practicedAt = new Date('2026-08-17T15:50:00Z')
    await insertPractice(db, { doneAt: practicedAt })
    expect(await lastActivityAt(db)).toEqual(practicedAt)
    expect(await check('2026-08-17T16:07:00Z', fakeSender().send)).toMatchObject({
      reason: 'studying',
    })
  })

  it('sends nothing when the learner has no cards left for today', async () => {
    await turnOn()
    await db
      .insert(itemFlags)
      .values(deck.metas.map((meta) => ({ itemId: meta.itemId, reason: 'dispute' as const })))
    expect(await check('2026-08-17T16:07:00Z', fakeSender().send)).toMatchObject({
      outcome: 'skipped',
      reason: 'nothing-left',
    })
  })

  it('deletes a device its push service says is gone and still reaches the others', async () => {
    const gone = await turnOn()
    const kept = await turnOn()
    const sender = fakeSender((endpoint) =>
      endpoint === gone.subscription.endpoint
        ? { ok: false, gone: true, status: 410 }
        : { ok: true },
    )
    expect(await check('2026-08-17T16:07:00Z', sender.send)).toEqual({
      outcome: 'sent',
      reason: 'not-studied',
      delivered: 1,
      failed: 1,
      removed: 1,
    })
    expect((await listSubscriptions(db)).map((s) => s.endpoint)).toEqual([
      kept.subscription.endpoint,
    ])
    expect((await recentNudges(db))[0]).toMatchObject({ delivered: 1, failed: 1, removed: 1 })
  })

  it('does not count a reminder no push service took, so the next hour tries again', async () => {
    await turnOn()
    const down = fakeSender(() => ({ ok: false, gone: false, status: 503 }))
    expect(await check('2026-08-17T15:07:00Z', down.send)).toMatchObject({
      outcome: 'failed',
      delivered: 0,
      failed: 1,
    })
    const up = fakeSender()
    expect(await check('2026-08-17T16:07:00Z', up.send)).toMatchObject({ outcome: 'sent' })
    expect((await recentNudges(db)).map((row) => [row.seq, row.status])).toEqual([
      [1, 'sent'],
      [0, 'failed'],
    ])
  })

  it('stops after 4 attempts a day when no push service takes them', async () => {
    await turnOn()
    const down = fakeSender(() => ({ ok: false, gone: false, status: 403 }))
    const outcomes: string[] = []
    for (let hour = 0; hour < 24; hour += 1) {
      const at = new Date(Date.parse('2026-08-17T07:07:00Z') + hour * HOUR).toISOString()
      outcomes.push((await check(at, down.send)).outcome)
    }
    expect(outcomes.filter((outcome) => outcome === 'failed')).toHaveLength(4)
    expect(down.sent).toHaveLength(4)
    expect((await recentNudges(db)).every((row) => row.status === 'failed')).toBe(true)
  })

  it('sends one reminder when two checks run at the same moment', async () => {
    await turnOn()
    const sender = fakeSender()
    const now = new Date('2026-08-17T16:07:00Z')
    vi.setSystemTime(now)
    const results = await Promise.all([
      runNudges(db, () => deck, now, sender.send),
      runNudges(db, () => deck, now, sender.send),
    ])
    expect(results.filter((result) => result.outcome === 'sent')).toHaveLength(1)
    expect(sender.sent).toHaveLength(1)
    expect(await recentNudges(db)).toHaveLength(1)
  })

  it('lets a push service hold a reminder only until quiet hours', async () => {
    await turnOn()
    const sender = fakeSender()
    await check('2026-08-18T03:30:00Z', sender.send)
    expect(sender.sent[0]?.ttl).toBe(30 * 60)
  })
})
