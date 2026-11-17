import { afterEach, describe, expect, it, vi } from 'vitest'

import { audioSessionPort, browserAudioSession } from './audio-session'

function fakeSession(initial = 'auto') {
  const set: string[] = []
  let type = initial
  return {
    set,
    session: {
      get type() {
        return type
      },
      set type(value: string) {
        set.push(value)
        type = value
      },
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('audioSessionPort', () => {
  it("'auto' before the mic, 'playback' after it", () => {
    const fake = fakeSession()
    const port = audioSessionPort(() => fake.session as never)
    port.forMic()
    expect(fake.session.type).toBe('auto')

    expect(fake.set).toEqual([])
    port.afterMic()
    expect(fake.set).toEqual(['playback'])
    port.forMic()
    expect(fake.set).toEqual(['playback', 'auto'])
    port.afterMic()
    expect(fake.set).toEqual(['playback', 'auto', 'playback'])
  })

  it('touches nothing until a listen has started', () => {
    const fake = fakeSession()
    const port = audioSessionPort(() => fake.session as never)
    port.afterMic()
    expect(fake.set).toEqual([])
    port.forMic()
    port.afterMic()

    port.afterMic()
    expect(fake.set).toEqual(['playback'])
  })

  it('never throws when the session refuses or is missing', () => {
    const refusing = audioSessionPort(() => ({
      get type(): 'auto' {
        return 'auto'
      },
      set type(_value: string) {
        throw new Error('InvalidStateError')
      },
    }))
    expect(() => {
      refusing.forMic()
      refusing.afterMic()
    }).not.toThrow()
    const missing = audioSessionPort(() => undefined)
    expect(() => {
      missing.forMic()
      missing.afterMic()
    }).not.toThrow()
    const broken = audioSessionPort(() => {
      throw new Error('no navigator')
    })
    expect(() => {
      broken.forMic()
      broken.afterMic()
    }).not.toThrow()
  })
})

describe('browserAudioSession', () => {
  it('uses navigator.audioSession where there is one', () => {
    const fake = fakeSession()
    vi.stubGlobal('navigator', { audioSession: fake.session })
    const port = browserAudioSession()
    port.forMic()
    port.afterMic()
    expect(fake.set).toEqual(['playback'])
  })

  it('does nothing without one (every browser but Safari 16.4+), or without a navigator', () => {
    vi.stubGlobal('navigator', {})
    expect(() => {
      browserAudioSession().forMic()
      browserAudioSession().afterMic()
    }).not.toThrow()
    vi.stubGlobal('navigator', { audioSession: null })
    expect(() => {
      const port = browserAudioSession()
      port.forMic()
      port.afterMic()
    }).not.toThrow()
    vi.stubGlobal('navigator', undefined)
    expect(() => {
      const port = browserAudioSession()
      port.forMic()
      port.afterMic()
    }).not.toThrow()
  })
})
