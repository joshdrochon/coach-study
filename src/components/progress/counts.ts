import { countOf } from '@/lib/dashboard/format'

type Counted = { done: number; of: number }

export function profileCounts(practiceSessions: Counted, practiceClasses: Counted): string {
  const classes = `Practice classes ${countOf(practiceClasses.done, practiceClasses.of)}`
  return practiceSessions.done > 0
    ? `Practice sessions ${countOf(practiceSessions.done, practiceSessions.of)} · ${classes}`
    : classes
}
