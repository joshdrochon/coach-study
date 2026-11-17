// The reminder job: decides per device and sends through web push, logging each one.

import { max, sql } from 'drizzle-orm'

import type { Db } from '../db/client'
import { practices, reviewEvents } from '../db/schema'
import type { Deck } from '../study/deck'
import { effectiveTimeSql } from '../study/state'
import { homeView } from '../study/home'

import type { NudgeRunResult } from './contract'
import { nudgeMessage } from './copy'
import { claimNudge, dayLog, finishNudge, lastNudgeAt } from './log'
import type { PushSender } from './push'
import { decideNudge, inSendingHours, nudgeDay, pushTtlSeconds, timingSkip } from './schedule'
import { listSubscriptions, removeSubscriptions } from './subscriptions'

export async function lastActivityAt(db: Db): Promise<Date | null> {
  const [[answer], [practice]] = await Promise.all([
    db
      .select({ at: sql<Date | null>`max(${effectiveTimeSql})`.mapWith(reviewEvents.reviewedAt) })
      .from(reviewEvents),
    db
      .select({
        at: max(sql`least(${practices.doneAt}, ${practices.receivedAt})`).mapWith(practices.doneAt),
      })
      .from(practices),
  ])
  const times = [answer?.at, practice?.at].filter((at): at is Date => at instanceof Date)
  return times.length === 0 ? null : new Date(Math.max(...times.map((at) => at.getTime())))
}

const nothingSent = { delivered: 0, failed: 0, removed: 0 }

export async function runNudges(
  db: Db,
  deck: () => Deck,
  now: Date,
  send: PushSender,
): Promise<NudgeRunResult> {
  if (!inSendingHours(now)) return { outcome: 'skipped', reason: 'quiet-hours', ...nothingSent }

  const subscriptions = await listSubscriptions(db)
  if (subscriptions.length === 0) {
    return { outcome: 'skipped', reason: 'no-subscription', ...nothingSent }
  }

  const day = nudgeDay(now)
  const [log, lastSentAt] = await Promise.all([dayLog(db, day), lastNudgeAt(db)])
  const early = timingSkip(now, log.counted, log.attempts, lastSentAt)
  if (early) return { outcome: 'skipped', reason: early, ...nothingSent }

  const [activity, home] = await Promise.all([lastActivityAt(db), homeView(db, deck(), now)])
  const decision = decideNudge({
    now,
    sentToday: log.counted,
    attemptsToday: log.attempts,
    lastSentAt,
    lastActivityAt: activity,
    cardsLeft: home.dueToday,
  })
  if (!decision.send) return { outcome: 'skipped', reason: decision.skip, ...nothingSent }

  const message = nudgeMessage({
    daysToPracticeDay: home.daysToPracticeDay,
    daysToFirstClass: home.daysToFirstClass,
    cardsLeft: home.dueToday,
    reason: decision.reason,
  })
  const id = await claimNudge(db, {
    day,
    seq: log.attempts,
    reason: decision.reason,
    message,
    cardsLeft: home.dueToday,
    now,
  })
  if (id === null) return { outcome: 'skipped', reason: 'busy', ...nothingSent }

  const ttl = pushTtlSeconds(now)
  const deliveries = await Promise.all(
    subscriptions.map(async (target) => ({ target, delivery: await send(target, message, ttl) })),
  )
  const gone = deliveries.flatMap(({ target, delivery }) =>
    !delivery.ok && delivery.gone ? [target.endpoint] : [],
  )
  const removed = await removeSubscriptions(db, gone)
  const delivered = deliveries.filter(({ delivery }) => delivery.ok).length
  const failed = deliveries.length - delivered
  await finishNudge(db, id, { delivered, failed, removed, sentAt: new Date() })
  return {
    outcome: delivered > 0 ? 'sent' : 'failed',
    reason: decision.reason,
    delivered,
    failed,
    removed,
  }
}
