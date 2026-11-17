import { describe, expect, it } from 'vitest'

import { addDays, addMinutes, dayKey, localDay, shiftDayKey, TIME_ZONE } from './calendar'

describe('dayKey', () => {
  it('uses their time zone by default', () => {
    expect(TIME_ZONE).toBe('America/Los_Angeles')

    const lateEvening = new Date('2026-08-11T05:00:00.000Z')
    expect(dayKey(lateEvening)).toBe('2026-08-10')
    expect(dayKey(lateEvening, 'UTC')).toBe('2026-08-11')
    expect(dayKey(new Date('2026-08-11T07:00:00.000Z'))).toBe('2026-08-11')
  })

  it('follows daylight saving time', () => {
    expect(dayKey(new Date('2026-11-02T07:30:00.000Z'))).toBe('2026-11-01')
    expect(dayKey(new Date('2026-11-02T08:30:00.000Z'))).toBe('2026-11-02')
  })
})

describe('localDay', () => {
  const now = new Date('2026-08-10T16:00:00.000Z')
  const today = localDay(now)

  it('knows which instants fall on their day', () => {
    expect(today.key).toBe('2026-08-10')
    expect(today.includes(new Date('2026-08-10T07:00:00.000Z'))).toBe(true)
    expect(today.includes(new Date('2026-08-11T06:59:00.000Z'))).toBe(true)
    expect(today.includes(new Date('2026-08-10T06:59:00.000Z'))).toBe(false)
    expect(today.includes(new Date('2026-08-11T07:00:00.000Z'))).toBe(false)
    expect(today.includes(new Date('2026-07-30T16:00:00.000Z'))).toBe(false)
    expect(today.includes(new Date('2026-08-21T16:00:00.000Z'))).toBe(false)
  })

  it('knows what is due by the end of their day', () => {
    expect(today.isOnOrBefore(new Date('2026-07-11T16:00:00.000Z'))).toBe(true)
    expect(today.isOnOrBefore(now)).toBe(true)
    expect(today.isOnOrBefore(new Date('2026-08-11T06:59:00.000Z'))).toBe(true)
    expect(today.isOnOrBefore(new Date('2026-08-11T07:00:00.000Z'))).toBe(false)
    expect(today.isOnOrBefore(new Date('2026-11-01T16:00:00.000Z'))).toBe(false)
  })

  it('takes a time zone', () => {
    expect(localDay(now, 'UTC').includes(new Date('2026-08-10T23:59:00.000Z'))).toBe(true)
    expect(localDay(now, 'UTC').includes(new Date('2026-08-11T00:00:00.000Z'))).toBe(false)
  })

  it('finds where their day starts and ends, through daylight saving changes', () => {
    const at = (iso: string): number => new Date(iso).getTime()
    expect(today).toMatchObject({
      start: at('2026-08-10T07:00:00Z'),
      end: at('2026-08-11T07:00:00Z'),
    })

    expect(localDay(new Date('2026-11-01T20:00:00Z'))).toMatchObject({
      key: '2026-11-01',
      start: at('2026-11-01T07:00:00Z'),
      end: at('2026-11-02T08:00:00Z'),
    })
    expect(localDay(new Date('2026-03-08T20:00:00Z'))).toMatchObject({
      key: '2026-03-08',
      start: at('2026-03-08T08:00:00Z'),
      end: at('2026-03-09T07:00:00Z'),
    })

    expect(localDay(new Date('2026-08-10T12:00:00Z'), 'Asia/Kathmandu')).toMatchObject({
      key: '2026-08-10',
      start: at('2026-08-09T18:15:00Z'),
      end: at('2026-08-10T18:15:00Z'),
    })

    expect(localDay(new Date('2026-08-11T07:00:00Z')).key).toBe('2026-08-11')
    expect(localDay(new Date('2026-08-11T06:59:59.999Z')).key).toBe('2026-08-10')
  })
})

describe('shiftDayKey', () => {
  it('moves a date by whole days across months', () => {
    expect(shiftDayKey('2026-08-21', -2)).toBe('2026-08-19')
    expect(shiftDayKey('2026-10-31', 1)).toBe('2026-11-01')
    expect(shiftDayKey('2026-09-05', 0)).toBe('2026-09-05')
  })

  it('rejects text that is not a date', () => {
    expect(() => shiftDayKey('Aug 21', 1)).toThrow(/YYYY-MM-DD/)
  })
})

describe('addMinutes and addDays', () => {
  it('return new dates', () => {
    const start = new Date('2026-08-10T16:00:00.000Z')
    expect(addMinutes(start, 90)).toEqual(new Date('2026-08-10T17:30:00.000Z'))
    expect(addDays(start, 30)).toEqual(new Date('2026-09-09T16:00:00.000Z'))
    expect(start).toEqual(new Date('2026-08-10T16:00:00.000Z'))
  })
})
