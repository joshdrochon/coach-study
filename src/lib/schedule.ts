import { z } from 'zod'

import data from '../../content/method/schedule.json'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')

// The learner's milestones are data (content/method/schedule.json), not code: the practice day,
// the day the daily pace starts, and the first class. The baseline check repeats before the first
// and the last of them.
export const scheduleSchema = z
  .strictObject({ practiceDay: day, paceStart: day, firstClass: day })
  .refine(
    (s) => s.practiceDay < s.firstClass && s.paceStart <= s.firstClass,
    'practiceDay and paceStart must come before firstClass',
  )
export type Schedule = z.infer<typeof scheduleSchema>

export const SCHEDULE: Schedule = scheduleSchema.parse(data)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "2026-10-09" -> "Oct 9": a calendar day, so no time zone applies.
export function dayLabel(isoDay: string): string {
  const [, month = '1', date = '1'] = isoDay.split('-')
  return `${MONTHS[Number(month) - 1] ?? ''} ${String(Number(date))}`
}

// "2026-10-09" -> 20261009, for comparing calendar days as numbers.
export function dayNumber(isoDay: string): number {
  return Number(isoDay.replaceAll('-', ''))
}
