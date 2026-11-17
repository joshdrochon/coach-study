import { costUsd, MODELS, type ModelId } from '../grader/models'

export type DailyUse = {
  use: string
  model: ModelId
  callsPerDay: number
  inputTokens: number
  outputTokens: number
}

export const DAILY_USE_ESTIMATE: readonly DailyUse[] = [
  {
    use: 'Short-answer grading',
    model: MODELS.haiku,
    callsPerDay: 150,
    inputTokens: 1500,
    outputTokens: 200,
  },

  {
    use: 'Mic practices',
    model: MODELS.sonnet,
    callsPerDay: 15,
    inputTokens: 15_000,
    outputTokens: 2000,
  },

  {
    use: 'Explanations and scenarios',
    model: MODELS.sonnet,
    callsPerDay: 50,
    inputTokens: 3000,
    outputTokens: 500,
  },
]

export function dailyCost(row: DailyUse): number {
  return (
    row.callsPerDay *
    costUsd(row.model, { input_tokens: row.inputTokens, output_tokens: row.outputTokens })
  )
}

export function dailyTotal(rows: readonly DailyUse[]): number {
  return rows.reduce((sum, row) => sum + dailyCost(row), 0)
}

const DAY_MS = 86_400_000

export function daysThrough(first: string, last: string): number {
  const span = Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)
  if (Number.isNaN(span)) throw new Error(`not a YYYY-MM-DD day: ${first} or ${last}`)
  return span < 0 ? 0 : Math.round(span / DAY_MS) + 1
}

export function costThrough(rows: readonly DailyUse[], first: string, last: string): number {
  return dailyTotal(rows) * daysThrough(first, last)
}
