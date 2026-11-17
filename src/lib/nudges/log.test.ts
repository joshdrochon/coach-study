import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { openTestDb, type Db } from '../db/client'
import { nudges } from '../db/schema'

import { nudgeMessage } from './copy'
import { claimNudge, dayLog, finishNudge, lastNudgeAt, recentNudges, type Claim } from './log'

let db: Db
beforeAll(async () => {
  db = await openTestDb()
})
beforeEach(async () => {
  await db.delete(nudges)
})

const MORNING = new Date('2026-08-17T15:07:00Z')

function claim(overrides: Partial<Claim> = {}): Claim {
  return {
    day: '2026-08-17',
    seq: 0,
    reason: 'not-studied',
    message: nudgeMessage({
      daysToPracticeDay: 2,
      daysToFirstClass: 19,
      cardsLeft: 40,
      reason: 'not-studied',
    }),
    cardsLeft: 40,
    now: MORNING,
    ...overrides,
  }
}

describe('the reminder log', () => {
  it('logs send time, what it said and how many devices took it', async () => {
    const id = await claimNudge(db, claim())
    if (id === null) throw new Error('not claimed')
    const sentAt = new Date(MORNING.getTime() + 900)
    await finishNudge(db, id, { delivered: 1, failed: 1, removed: 1, sentAt })
    expect(await recentNudges(db)).toEqual([
      {
        day: '2026-08-17',
        seq: 0,
        status: 'sent',
        reason: 'not-studied',
        title: 'Two days to practice day.',
        body: '40 cards for today. Start when you’re ready.',
        cardsLeft: 40,
        delivered: 1,
        failed: 1,
        removed: 1,
        createdAt: MORNING,
        sentAt,
      },
    ])
  })

  it('lets only one of two runs at the same moment claim a reminder', async () => {
    const [first, second] = await Promise.all([claimNudge(db, claim()), claimNudge(db, claim())])
    expect([first, second].filter((id) => id !== null)).toHaveLength(1)
    expect(await recentNudges(db)).toHaveLength(1)
  })

  it('counts sent and going-out reminders toward the 2 a day, not failed ones', async () => {
    const failed = await claimNudge(db, claim())
    if (failed === null) throw new Error('not claimed')
    await finishNudge(db, failed, { delivered: 0, failed: 1, removed: 0, sentAt: MORNING })
    expect(await dayLog(db, '2026-08-17')).toEqual({ counted: 0, attempts: 1 })
    expect(await lastNudgeAt(db)).toBeNull()

    const later = new Date(MORNING.getTime() + 3_600_000)
    const sending = await claimNudge(db, claim({ seq: 1, now: later }))
    expect(sending).not.toBeNull()
    expect(await dayLog(db, '2026-08-17')).toEqual({ counted: 1, attempts: 2 })
    expect(await lastNudgeAt(db)).toEqual(later)

    expect(await dayLog(db, '2026-08-18')).toEqual({ counted: 0, attempts: 0 })
  })

  it('marks a reminder no device took as failed', async () => {
    const id = await claimNudge(db, claim())
    if (id === null) throw new Error('not claimed')
    await finishNudge(db, id, { delivered: 0, failed: 2, removed: 0, sentAt: MORNING })
    const [row] = await recentNudges(db)
    expect(row?.status).toBe('failed')
  })
})
