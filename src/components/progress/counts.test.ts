import { describe, expect, it } from 'vitest'

import { profileCounts } from './counts'

describe('the counts under their title', () => {
  it('leaves practice sessions out while nothing has set them', () => {
    expect(profileCounts({ done: 0, of: 3 }, { done: 0, of: 10 })).toBe('Practice classes 0 of 10')
    expect(profileCounts({ done: 0, of: 3 }, { done: 4, of: 10 })).toBe('Practice classes 4 of 10')
  })

  it('shows them once set', () => {
    expect(profileCounts({ done: 1, of: 3 }, { done: 0, of: 10 })).toBe(
      'Practice sessions 1 of 3 · Practice classes 0 of 10',
    )
    expect(profileCounts({ done: 3, of: 3 }, { done: 10, of: 10 })).toBe(
      'Practice sessions 3 of 3 · Practice classes 10 of 10',
    )
  })
})
