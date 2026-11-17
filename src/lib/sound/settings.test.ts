import { beforeEach, describe, expect, it, vi } from 'vitest'

type Settings = typeof import('./settings')
let settings: Settings

beforeEach(async () => {
  vi.resetModules()
  settings = await import('./settings')
})

function memory(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial))
  return {
    items,
    store: () => ({
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => {
        items.set(key, value)
      },
    }),
  }
}

const broken = () => {
  throw new Error('SecurityError: site data blocked')
}

describe('sounds on or off', () => {
  it('on when storage is empty or throws', () => {
    const { soundsOn, SOUNDS_KEY } = settings
    expect(soundsOn(memory().store)).toBe(true)
    expect(soundsOn(broken)).toBe(true)
    expect(
      soundsOn(() => ({
        getItem: () => {
          throw new Error('unreadable')
        },
        setItem: () => undefined,
      })),
    ).toBe(true)

    expect(soundsOn(memory({ [SOUNDS_KEY]: 'garbled' }).store)).toBe(true)
  })

  it('turns off and back on, on this iPad', () => {
    const { setSoundsOn, soundsOn, SOUNDS_KEY } = settings
    const m = memory()
    expect(setSoundsOn(false, m.store)).toBe(true)
    expect(m.items.get(SOUNDS_KEY)).toBe('off')
    expect(soundsOn(m.store)).toBe(false)
    expect(setSoundsOn(true, m.store)).toBe(true)
    expect(soundsOn(m.store)).toBe(true)
  })

  it('a write that fails says so, and the choice still holds for this page', () => {
    const { setSoundsOn, soundsOn } = settings
    expect(setSoundsOn(false, broken)).toBe(false)

    expect(soundsOn(broken)).toBe(false)
    expect(setSoundsOn(true, broken)).toBe(false)
    expect(soundsOn(broken)).toBe(true)
  })

  it('uses the iPad’s localStorage by default, and no window means on', () => {
    const { setSoundsOn, soundsOn, SOUNDS_KEY } = settings

    expect(soundsOn()).toBe(true)
    const m = memory()
    vi.stubGlobal('window', { localStorage: m.store() })
    try {
      expect(soundsOn()).toBe(true)
      expect(setSoundsOn(false)).toBe(true)
      expect(m.items.get(SOUNDS_KEY)).toBe('off')
      expect(soundsOn()).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
