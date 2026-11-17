import { nextEvaluationDay } from '../study/days'

import { formatShortDate } from '../dashboard/format'

export function nextEvaluation(now: Date): string | null {
  const day = nextEvaluationDay(now)

  return day === null ? null : formatShortDate(new Date(`${day}T12:00:00Z`))
}

export function readinessHeading(now: Date): string {
  const target = nextEvaluation(now)
  return target ? `Ready for ${target}?` : 'Ready 30 days out?'
}

export function recallHeading(now: Date): string {
  const target = nextEvaluation(now)
  return target ? `Predicted recall on ${target}` : 'Predicted recall 30 days out'
}
