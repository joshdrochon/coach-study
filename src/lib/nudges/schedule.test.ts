import { describe, expect, it } from 'vitest'

import {
  decideNudge,
  inSendingHours,
  localSeconds,
  NUDGE_RULES,
  nudgeDay,
  pushTtlSeconds,
  studiedToday,
  timingSkip,
  type NudgeFacts,
} from './schedule'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

const utc = (iso: string) => new Date(iso)

function facts(overrides: Partial<NudgeFacts> = {}): NudgeFacts {
  return {
    now: utc('2026-08-10T16:07:00Z'),
    sentToday: 0,
    attemptsToday: 0,
    lastSentAt: null,
    lastActivityAt: null,
    cardsLeft: 49,
    ...overrides,
  }
}

function simulate(
  startIso: string,
  hours: number,
  options: { cardsLeft?: number; studiedAt?: (now: Date) => Date | null } = {},
): Date[] {
  const sent: Date[] = []
  const start = utc(startIso).getTime()
  for (let hour = 0; hour < hours; hour += 1) {
    const now = new Date(start + hour * HOUR)
    const today = nudgeDay(now)
    const decision = decideNudge({
      now,
      sentToday: sent.filter((at) => nudgeDay(at) === today).length,
      attemptsToday: sent.filter((at) => nudgeDay(at) === today).length,
      lastSentAt: sent.at(-1) ?? null,
      lastActivityAt: options.studiedAt?.(now) ?? null,
      cardsLeft: options.cardsLeft ?? 49,
    })
    if (decision.send) sent.push(now)
  }
  return sent
}

const pacificTime = (at: Date) =>
  at.toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })

describe('quiet after 9pm, from 08:00 in the morning, their time', () => {
  it('sends from 08:00 up to 20:59 and never at or after 21:00 (quiet after 9pm)', () => {
    expect(inSendingHours(utc('2026-08-10T14:59:59Z'))).toBe(false)
    expect(inSendingHours(utc('2026-08-10T15:00:00Z'))).toBe(true)
    expect(inSendingHours(utc('2026-08-11T03:59:59Z'))).toBe(true)
    expect(inSendingHours(utc('2026-08-11T04:00:00Z'))).toBe(false)
    expect(inSendingHours(utc('2026-08-11T06:30:00Z'))).toBe(false)
    expect(inSendingHours(utc('2026-08-11T09:00:00Z'))).toBe(false)
    expect(decideNudge(facts({ now: utc('2026-08-11T04:00:00Z') }))).toEqual({
      send: false,
      skip: 'quiet-hours',
    })
  })

  it('keeps quiet after 9pm when the clocks fall back (Nov 1 2026)', () => {
    expect(inSendingHours(utc('2026-10-31T15:00:00Z'))).toBe(true)
    expect(inSendingHours(utc('2026-11-01T15:00:00Z'))).toBe(false)
    expect(inSendingHours(utc('2026-11-01T16:00:00Z'))).toBe(true)

    expect(inSendingHours(utc('2026-10-31T04:00:00Z'))).toBe(false)
    expect(inSendingHours(utc('2026-11-02T04:00:00Z'))).toBe(true)
    expect(inSendingHours(utc('2026-11-02T05:00:00Z'))).toBe(false)
  })

  it('keeps quiet after 9pm when the clocks spring forward (Mar 14 2027)', () => {
    expect(inSendingHours(utc('2027-03-13T16:00:00Z'))).toBe(true)
    expect(inSendingHours(utc('2027-03-14T14:59:00Z'))).toBe(false)
    expect(inSendingHours(utc('2027-03-14T15:00:00Z'))).toBe(true)
    expect(inSendingHours(utc('2027-03-14T04:30:00Z'))).toBe(true)
    expect(inSendingHours(utc('2027-03-15T04:00:00Z'))).toBe(false)
  })

  it('sends only between 08:00 and 21:00 their time through both clock changes', () => {
    for (const start of ['2026-10-29T00:07:00Z', '2027-03-11T00:07:00Z']) {
      const sent = simulate(start, 7 * 24)
      expect(sent.length).toBeGreaterThan(0)
      for (const at of sent) {
        const seconds = localSeconds(at)
        expect(seconds, pacificTime(at)).toBeGreaterThanOrEqual(8 * 3600)
        expect(seconds, pacificTime(at)).toBeLessThan(21 * 3600)
      }
    }
  })
})

describe('at most 2 a day', () => {
  it('max 2 per day: a third is never sent on the same day', () => {
    expect(decideNudge(facts({ sentToday: 2, lastSentAt: utc('2026-08-10T09:00:00Z') }))).toEqual({
      send: false,
      skip: 'daily-limit',
    })
    expect(decideNudge(facts({ sentToday: 3 }))).toEqual({ send: false, skip: 'daily-limit' })

    expect(decideNudge(facts({ sentToday: 0, attemptsToday: 3 }))).toEqual({
      send: true,
      reason: 'not-studied',
    })
    expect(decideNudge(facts({ sentToday: 0, attemptsToday: 4 }))).toEqual({
      send: false,
      skip: 'daily-limit',
    })

    const sent = simulate('2026-08-10T07:07:00Z', 72)
    const perDay = new Map<string, number>()
    for (const at of sent) perDay.set(nudgeDay(at), (perDay.get(nudgeDay(at)) ?? 0) + 1)
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(NUDGE_RULES.perDay)
  })

  it('two per day on a day the learner has cards and hasn’t studied: 08:07 and 14:07', () => {
    const sent = simulate('2026-08-10T07:07:00Z', 24)
    expect(sent.map(pacificTime)).toEqual(['08:07', '14:07'])
  })

  it('counts the 2 a day on their calendar day, so a new day starts at their midnight', () => {
    expect(nudgeDay(utc('2026-08-18T06:30:00Z'))).toBe('2026-08-17')
    expect(nudgeDay(utc('2026-08-18T07:30:00Z'))).toBe('2026-08-18')
    const sent = simulate('2026-08-17T07:07:00Z', 3 * 24)
    expect(sent.map((at) => `${nudgeDay(at)} ${pacificTime(at)}`)).toEqual([
      '2026-08-17 08:07',
      '2026-08-17 14:07',
      '2026-08-18 08:07',
      '2026-08-18 14:07',
      '2026-08-19 08:07',
      '2026-08-19 14:07',
    ])
  })

  it(`never sends two within ${String(NUDGE_RULES.minGapHours)} hours`, () => {
    const last = utc('2026-08-10T15:07:00Z')
    expect(timingSkip(utc('2026-08-10T21:06:59Z'), 1, 1, last)).toBe('too-soon')
    expect(timingSkip(utc('2026-08-10T21:07:00Z'), 1, 1, last)).toBeNull()

    expect(timingSkip(utc('2026-08-11T15:07:00Z'), 0, 0, utc('2026-08-11T03:30:00Z'))).toBeNull()
  })
})

describe('only when there is something to do', () => {
  it('sends nothing when the learner has no cards left for today (Start would end at once)', () => {
    expect(decideNudge(facts({ cardsLeft: 0 }))).toEqual({ send: false, skip: 'nothing-left' })
    expect(simulate('2026-08-10T07:07:00Z', 24, { cardsLeft: 0 })).toEqual([])
  })

  it('never interrupts them: nothing within an hour of their last answer or practice', () => {
    const now = utc('2026-08-10T18:07:00Z')
    expect(
      decideNudge(facts({ now, lastActivityAt: new Date(now.getTime() - 59 * MINUTE) })),
    ).toEqual({ send: false, skip: 'studying' })
    expect(
      decideNudge(facts({ now, lastActivityAt: new Date(now.getTime() - 61 * MINUTE) })),
    ).toEqual({ send: true, reason: 'cards-left' })
  })

  it('says why: not studied yet today, or cards left after the learner studied', () => {
    expect(decideNudge(facts())).toEqual({ send: true, reason: 'not-studied' })

    const yesterday = utc('2026-08-10T06:30:00Z')
    expect(studiedToday(utc('2026-08-10T16:07:00Z'), yesterday)).toBe(false)
    expect(decideNudge(facts({ lastActivityAt: yesterday }))).toEqual({
      send: true,
      reason: 'not-studied',
    })

    const thisMorning = utc('2026-08-10T14:00:00Z')
    expect(studiedToday(utc('2026-08-10T16:07:00Z'), thisMorning)).toBe(true)
    expect(decideNudge(facts({ lastActivityAt: thisMorning }))).toEqual({
      send: true,
      reason: 'cards-left',
    })
  })

  it('waits while the learner studies, then reminds them about the cards left', () => {
    const sent = simulate('2026-08-10T07:07:00Z', 24, {
      studiedAt: (now) => {
        const last = utc('2026-08-10T16:30:00Z')
        const first = utc('2026-08-10T15:00:00Z')
        if (now < first) return null
        return now < last ? now : last
      },
    })
    expect(sent.map(pacificTime)).toEqual(['11:07', '17:07'])
  })
})

describe('how long a push service may hold a reminder', () => {
  it('never into quiet hours and never past the gap to the next one', () => {
    expect(pushTtlSeconds(utc('2026-08-11T03:00:00Z'))).toBe(3600)
    expect(pushTtlSeconds(utc('2026-08-11T03:59:30Z'))).toBe(30)
    expect(pushTtlSeconds(utc('2026-08-10T16:07:00Z'))).toBe(NUDGE_RULES.minGapHours * 3600)
    expect(pushTtlSeconds(utc('2026-08-11T04:30:00Z'))).toBe(0)
  })
})
