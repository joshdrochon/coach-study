import { curly } from '../text/curly'

export const TIME_ZONE = 'America/Los_Angeles'

const EPSILON = 1e-9

type PercentOptions = {
  decimals?: 0 | 1

  round?: 'down' | 'up'
}

export function formatPercent(
  ratio: number,
  { decimals = 0, round = 'down' }: PercentOptions = {},
) {
  const factor = 10 ** decimals
  const scaled = ratio * 100 * factor
  const steps = round === 'down' ? Math.floor(scaled + EPSILON) : Math.ceil(scaled - EPSILON)
  const value = steps / factor
  if (ratio > 0 && value === 0) return `<${String(1 / factor)}%`
  return `${value.toFixed(decimals).replace(/\.0$/, '')}%`
}

export function formatSeconds(ms: number): string {
  const tenths = Math.ceil(ms / 100 - EPSILON)
  return `${(tenths / 10).toFixed(1).replace(/\.0$/, '')} s`
}

export function formatClock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes)}:${String(seconds % 60).padStart(2, '0')}`
}

const usdTotal = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const usdCall = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
})

export function formatUsd(amount: number, kind: 'total' | 'call' = 'total'): string {
  return (kind === 'call' ? usdCall : usdTotal).format(amount)
}

const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

export function formatCount(n: number): string {
  return whole.format(n)
}

export function countOf(n: number, of: number): string {
  return `${formatCount(n)} of ${formatCount(of)}`
}

const shortDate = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: TIME_ZONE,
})

export function formatShortDate(date: Date): string {
  return shortDate.format(date)
}

export function todayLabel(now: Date): string {
  return `Today · ${formatShortDate(now)}`
}

export function bandLabel(accuracy: number): 'under band' | 'over band' | null {
  const shown = Math.floor(accuracy * 100 + EPSILON)
  if (shown < 80) return 'under band'
  if (shown > 90) return 'over band'
  return null
}

export function auditSummaryText(summary: string): string {
  return curly(summary.replace(/(?<![\w.])(\d+)\/(\d+)(?![\w/])/g, '$1 of $2'))
}
