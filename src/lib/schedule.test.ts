import { describe, expect, it } from 'vitest'

import { dayLabel, dayNumber, SCHEDULE, scheduleSchema } from './schedule'

describe('the learner schedule is data', () => {
  it('loads the sample schedule, milestones in order', () => {
    expect(SCHEDULE.practiceDay < SCHEDULE.firstClass).toBe(true)
    expect(SCHEDULE.paceStart <= SCHEDULE.firstClass).toBe(true)
  })

  it('refuses a first class before the practice day, and a day that is not YYYY-MM-DD', () => {
    expect(
      scheduleSchema.safeParse({
        practiceDay: '2030-02-01',
        paceStart: '2030-01-01',
        firstClass: '2030-01-15',
      }).success,
    ).toBe(false)
    expect(
      scheduleSchema.safeParse({
        practiceDay: 'Feb 1',
        paceStart: '2030-01-01',
        firstClass: '2030-01-15',
      }).success,
    ).toBe(false)
  })

  it('labels and numbers a calendar day with no time zone', () => {
    expect(dayLabel('2030-01-05')).toBe('Jan 5')
    expect(dayLabel('2030-12-31')).toBe('Dec 31')
    expect(dayNumber('2030-01-05')).toBe(20300105)
  })
})
