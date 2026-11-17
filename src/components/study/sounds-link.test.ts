import { describe, expect, it } from 'vitest'

import { LANDING_TAP_GUARD_MS, LandingGuard } from '../tap-guard'

import { toggleSounds } from './sounds-link'

function setup() {
  let t = 1000
  const log: string[] = []
  const deps = {
    save: (on: boolean) => log.push(`save ${on}`),
    preload: () => log.push('preload'),
    voice: {
      stopCue: () => log.push('stopCue'),
      preview: (id: string) => {
        log.push(`preview ${id}`)
        return Promise.resolve()
      },
    },
    guard: new LandingGuard(() => t),
  }
  return {
    deps,
    log,
    advance: (ms: number) => {
      t += ms
    },
  }
}

describe('the Take five sounds link', () => {
  it('a double tap on Turn off sounds turns them off once, not off and on again', () => {
    const { deps, log, advance } = setup()
    let on = toggleSounds(true, deps)
    advance(150)
    on = toggleSounds(on, deps)
    expect(on).toBe(false)
    expect(log).toEqual(['save false', 'stopCue'])
  })

  it('a double tap on Turn on sounds turns them on once, with one preview', () => {
    const { deps, log, advance } = setup()
    let on = toggleSounds(false, deps)
    advance(LANDING_TAP_GUARD_MS - 1)
    on = toggleSounds(on, deps)
    expect(on).toBe(true)
    expect(log).toEqual(['save true', 'preload', 'preview right'])
  })

  it('a second tap once the guard has passed counts', () => {
    const { deps, log, advance } = setup()
    let on = toggleSounds(true, deps)
    advance(LANDING_TAP_GUARD_MS)
    on = toggleSounds(on, deps)
    expect(on).toBe(true)
    expect(log).toEqual(['save false', 'stopCue', 'save true', 'preload', 'preview right'])
  })
})
