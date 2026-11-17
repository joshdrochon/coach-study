import { describe, expect, it } from 'vitest'

import {
  auditSummaryText,
  bandLabel,
  countOf,
  formatClock,
  formatCount,
  formatPercent,
  formatSeconds,
  formatShortDate,
  formatUsd,
  todayLabel,
} from './format'

describe('formatPercent', () => {
  it('shows their shares as whole percents', () => {
    expect(formatPercent(0.72)).toBe('72%')
    expect(formatPercent(0.58)).toBe('58%')
    expect(formatPercent(0.29)).toBe('29%')
    expect(formatPercent(1)).toBe('100%')
    expect(formatPercent(0)).toBe('0%')
  })

  it('keeps one decimal for system rates and drops a trailing .0', () => {
    expect(formatPercent(0.968, { decimals: 1 })).toBe('96.8%')
    expect(formatPercent(0.961, { decimals: 1 })).toBe('96.1%')
    expect(formatPercent(1, { decimals: 1 })).toBe('100%')
    expect(formatPercent(0.5, { decimals: 1 })).toBe('50%')
  })

  it('never rounds a share up across a bar it missed', () => {
    expect(formatPercent(0.9496, { decimals: 1 })).toBe('94.9%')
    expect(formatPercent(0.899)).toBe('89%')
    expect(formatPercent(0.9999)).toBe('99%')
  })

  it('rounds a lower-is-better rate up, as the fallback rate is', () => {
    expect(formatPercent(1 / 212, { decimals: 1, round: 'up' })).toBe('0.5%')
    expect(formatPercent(0.02, { decimals: 1, round: 'up' })).toBe('2%')
  })

  it('never shows a non-zero share as 0%', () => {
    expect(formatPercent(0.004)).toBe('<1%')
    expect(formatPercent(0.0004, { decimals: 1 })).toBe('<0.1%')
  })
})

describe('formatSeconds', () => {
  it('shows seconds with at most one decimal', () => {
    expect(formatSeconds(1900)).toBe('1.9 s')
    expect(formatSeconds(1100)).toBe('1.1 s')
    expect(formatSeconds(11_400)).toBe('11.4 s')
    expect(formatSeconds(15_000)).toBe('15 s')
    expect(formatSeconds(2500)).toBe('2.5 s')
    expect(formatSeconds(0)).toBe('0 s')
  })

  it('rounds a latency up, so a miss of the budget never hides', () => {
    expect(formatSeconds(2540)).toBe('2.6 s')
    expect(formatSeconds(2501)).toBe('2.6 s')
  })
})

describe('formatClock', () => {
  it('writes timers as m:ss with no leading zero', () => {
    expect(formatClock(102_000)).toBe('1:42')
    expect(formatClock(252_000)).toBe('4:12')
    expect(formatClock(7000)).toBe('0:07')
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(3_600_000)).toBe('60:00')
    expect(formatClock(-5)).toBe('0:00')
  })
})

describe('formatUsd', () => {
  it('shows totals and caps in cents', () => {
    expect(formatUsd(1.38)).toBe('$1.38')
    expect(formatUsd(5)).toBe('$5.00')
    expect(formatUsd(50)).toBe('$50.00')
    expect(formatUsd(0)).toBe('$0.00')
    expect(formatUsd(1234.5)).toBe('$1,234.50')
  })

  it('shows one call to a tenth of a cent', () => {
    expect(formatUsd(0.041, 'call')).toBe('$0.041')
    expect(formatUsd(0.002, 'call')).toBe('$0.002')
    expect(formatUsd(0, 'call')).toBe('$0.000')
  })
})

describe('counts', () => {
  it('reads N of M with thousands separators', () => {
    expect(countOf(17, 19)).toBe('17 of 19')
    expect(countOf(0, 4405)).toBe('0 of 4,405')
    expect(formatCount(1152)).toBe('1,152')
  })
})

describe('dates in Pacific time', () => {
  it('names the day the way the header does', () => {
    expect(formatShortDate(new Date('2026-08-19T01:30:00Z'))).toBe('Aug 18')
    expect(todayLabel(new Date('2026-08-18T18:00:00Z'))).toBe('Today · Aug 18')
  })
})

describe('bandLabel', () => {
  it('marks sessions outside the 80–90% band, judged on the percent shown', () => {
    expect(bandLabel(0.79)).toBe('under band')
    expect(bandLabel(0.799)).toBe('under band')
    expect(bandLabel(0.8)).toBeNull()
    expect(bandLabel(0.86)).toBeNull()
    expect(bandLabel(0.909)).toBeNull()
    expect(bandLabel(0.91)).toBe('over band')
  })
})

describe('auditSummaryText', () => {
  it('reads counts as N of M and curls quotes, leaving other numbers alone', () => {
    expect(auditSummaryText('43/43 manual quotes; 357/365 agree (97.8%) on 1366x1024')).toBe(
      '43 of 43 manual quotes; 357 of 365 agree (97.8%) on 1366x1024',
    )
    expect(auditSummaryText('eval sets: {"golden":{"cards":20}}')).toBe(
      'eval sets: {“golden”:{“cards”:20}}',
    )
  })
})
