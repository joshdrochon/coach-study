import { describe, expect, it } from 'vitest'

import { LANDING_TAP_GUARD_MS, LandingGuard, tapCounts } from './tap-guard'

describe('a tap that lands where the last one was', () => {
  it('does nothing within the guard, and counts after it', () => {
    expect(LANDING_TAP_GUARD_MS).toBe(600)
    expect(tapCounts(null)).toBe(true)
    expect(tapCounts(0)).toBe(false)
    expect(tapCounts(599)).toBe(false)
    expect(tapCounts(600)).toBe(true)
    expect(tapCounts(300, 200)).toBe(true)
  })

  it('counts every tap until the screen changes under their finger', () => {
    let now = 10_000
    const guard = new LandingGuard(() => now)
    expect(guard.counts()).toBe(true)

    guard.arm()
    now += 120
    expect(guard.counts()).toBe(false)
    now += 480
    expect(guard.counts()).toBe(true)

    guard.arm()
    expect(guard.counts()).toBe(false)
  })
})
