// Calendar days in the learner's time zone. Days are computed from local midnight,
// so they stay correct across daylight saving changes.

export const TIME_ZONE = 'America/Los_Angeles'

const MINUTE_MS = 60_000
const DAY_MS = 86_400_000

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone)
  if (cached) return cached
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  formatters.set(timeZone, created)
  return created
}

export function dayKey(at: Date, timeZone: string = TIME_ZONE): string {
  const date = { year: '', month: '', day: '' }
  for (const { type, value } of formatterFor(timeZone).formatToParts(at)) {
    if (type === 'year' || type === 'month' || type === 'day') date[type] = value
  }
  return `${date.year}-${date.month}-${date.day}`
}

const QUARTER_HOUR_MS = 15 * MINUTE_MS

const DAY_REACH_MS = 26 * 60 * MINUTE_MS

export type LocalDay = {
  key: string
  timeZone: string

  start: number
  end: number

  includes(at: Date): boolean

  isOnOrBefore(at: Date): boolean
}

function firstQuarterHour(low: number, high: number, reached: (at: number) => boolean): number {
  let before = low
  let after = high
  while (after - before > QUARTER_HOUR_MS) {
    const middle = before + Math.floor((after - before) / 2 / QUARTER_HOUR_MS) * QUARTER_HOUR_MS
    if (reached(middle)) after = middle
    else before = middle
  }
  return after
}

export function localDay(now: Date, timeZone: string = TIME_ZONE): LocalDay {
  const key = dayKey(now, timeZone)
  const keyAt = (at: number): string => dayKey(new Date(at), timeZone)
  const quarterHour = Math.floor(now.getTime() / QUARTER_HOUR_MS) * QUARTER_HOUR_MS
  const start = firstQuarterHour(quarterHour - DAY_REACH_MS, quarterHour, (at) => keyAt(at) >= key)
  const end = firstQuarterHour(quarterHour, quarterHour + DAY_REACH_MS, (at) => keyAt(at) > key)
  return {
    key,
    timeZone,
    start,
    end,
    includes: (at) => at.getTime() >= start && at.getTime() < end,
    isOnOrBefore: (at) => at.getTime() < end,
  }
}

export function shiftDayKey(key: string, days: number): string {
  const start = Date.parse(`${key}T00:00:00Z`)
  if (Number.isNaN(start)) throw new Error(`Not a YYYY-MM-DD date: ${key}`)
  return new Date(start + days * DAY_MS).toISOString().slice(0, 10)
}

export function addMinutes(at: Date, minutes: number): Date {
  return new Date(at.getTime() + minutes * MINUTE_MS)
}

export function addDays(at: Date, days: number): Date {
  return new Date(at.getTime() + days * DAY_MS)
}
