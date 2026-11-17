import { describe, expect, it } from 'vitest'

import { PROGRESS_FIXTURE } from '../dashboard/fixtures'
import type { Fetch } from '../dashboard/http'

import { fetchProgress } from './client'
import { isCoachTitle, isPromotion, TITLES } from './titles'

describe('coach titles', () => {
  it('are exactly the three titles, in order', () => {
    expect(TITLES).toEqual(['Starter', 'Practitioner', 'Mentor'])
  })

  it('leave out titles the learner has not confirmed', () => {
    expect(isCoachTitle('Grandmaster')).toBe(false)
    expect(isCoachTitle('Wayfarer')).toBe(false)
    expect(isCoachTitle('Lead')).toBe(false)
    expect(isCoachTitle('Mentor')).toBe(true)
  })

  it('celebrate only a move up the ladder', () => {
    expect(isPromotion('Starter', 'Practitioner')).toBe(true)
    expect(isPromotion('Practitioner', 'Mentor')).toBe(true)
    expect(isPromotion('Mentor', 'Mentor')).toBe(false)
    expect(isPromotion('Mentor', 'Practitioner')).toBe(false)
  })

  it('are never awarded for app progress: every milestone done, the title stays theirs', async () => {
    const maxedOut = {
      ...PROGRESS_FIXTURE,
      title: 'Starter',
      practiceSessions: { done: 3, of: 3 },
      practiceClasses: { done: 10, of: 10 },
      readiness: [{ category: 'Floor work', ready: 1 }],
    }
    const fetch: Fetch = () => Promise.resolve(new Response(JSON.stringify(maxedOut)))
    const result = await fetchProgress(fetch)
    expect(result.ok && result.data.title).toBe('Starter')
  })
})
