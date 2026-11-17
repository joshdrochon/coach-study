import { describe, expect, it } from 'vitest'

import { bearerMatches } from './bearer'

const SECRET = 'nudge-secret-for-this-test-only-0123456789'

describe('bearerMatches (the hourly job’s token)', () => {
  it('accepts exactly the secret, as a Bearer token', () => {
    expect(bearerMatches(`Bearer ${SECRET}`, SECRET)).toBe(true)
    expect(bearerMatches(`bearer ${SECRET}`, SECRET)).toBe(true)
    expect(bearerMatches(`Bearer  ${SECRET} `, SECRET)).toBe(true)
  })

  it('refuses anything else', () => {
    for (const header of [
      null,
      '',
      'Bearer',
      'Bearer ',
      SECRET,
      `Basic ${SECRET}`,
      `Bearer ${SECRET}x`,
      `Bearer ${SECRET.slice(0, -1)}`,
      `Bearer ${SECRET} extra`,
      `Bearer ${SECRET.toUpperCase()}`,
    ]) {
      expect(bearerMatches(header, SECRET), String(header)).toBe(false)
    }
  })

  it('never matches when no secret is set', () => {
    expect(bearerMatches('Bearer ', '')).toBe(false)
    expect(bearerMatches('Bearer x', '')).toBe(false)
  })
})
