import { describe, expect, it, vi } from 'vitest'

import { SOUND_IDS, STUDY_SOUND_IDS, soundLengthMs, soundPath, type SoundId } from './catalog'
import { SoundBank } from './sounds'

function bank(
  options: {
    on?: () => boolean
    path?: (id: SoundId) => string | null
    answer?: (url: string) => Promise<Response>
  } = {},
) {
  const fetched: string[] = []
  let made = 0
  const sounds = new SoundBank({
    fetch: (url) => {
      fetched.push(url)
      return (
        options.answer?.(url) ??
        Promise.resolve(
          new Response(new Uint8Array([0xff, 0xfb, 0x90, 0xc4]), {
            headers: { 'Content-Type': 'audio/mpeg' },
          }),
        )
      )
    },
    objectUrl: { create: () => `blob:${String(++made)}` },
    path: options.path ?? ((id) => `/sounds/${id}.aaaaaaaa.mp3`),
    lengthMs: () => 150,
    on: options.on ?? (() => true),
  })
  return { sounds, fetched }
}

describe('SoundBank', () => {
  it('preloads once and plays from memory', async () => {
    const { sounds, fetched } = bank()
    sounds.preload()
    sounds.preload()
    expect(fetched).toHaveLength(STUDY_SOUND_IDS.length)
    const first = await sounds.url('listen-on')
    expect(first).toMatch(/^blob:/)

    expect(await sounds.url('listen-on')).toBe(first)
    for (const id of SOUND_IDS) expect(await sounds.url(id)).toMatch(/^blob:/)
    expect(fetched).toHaveLength(SOUND_IDS.length)
  })

  it('a sound that failed to load has no URL, and never rejects', async () => {
    const { sounds } = bank({
      answer: (url) =>
        url.includes('right')
          ? Promise.resolve(new Response('missing', { status: 404 }))
          : url.includes('done')
            ? Promise.reject(new TypeError('offline'))
            : url.includes('break')
              ? Promise.resolve(
                  new Response('<html>', { headers: { 'Content-Type': 'text/html' } }),
                )
              : Promise.resolve(new Response('ok', { headers: { 'Content-Type': 'audio/mpeg' } })),
    })
    expect(await sounds.url('right')).toBeNull()
    expect(await sounds.url('done')).toBeNull()
    expect(await sounds.url('break')).toBeNull()
    expect(await sounds.url('results')).toMatch(/^blob:/)
  })

  it('a sound that couldn’t be fetched (offline) is tried again on its next cue; an error status is not', async () => {
    let offline = true
    const { sounds, fetched } = bank({
      answer: (url) =>
        offline
          ? Promise.reject(new TypeError('offline'))
          : url.includes('right')
            ? Promise.resolve(new Response('missing', { status: 404 }))
            : Promise.resolve(new Response('ok', { headers: { 'Content-Type': 'audio/mpeg' } })),
    })
    expect(await sounds.url('listen-on')).toBeNull()
    offline = false
    expect(await sounds.url('listen-on')).toMatch(/^blob:/)
    expect(await sounds.url('right')).toBeNull()
    const asked = fetched.length

    expect(await sounds.url('right')).toBeNull()
    expect(fetched).toHaveLength(asked)
  })

  it('a sound with no file (not made, or turned off in the manifest) is never fetched', async () => {
    const { sounds, fetched } = bank({
      path: (id) => (id === 'promoted' ? null : `/sounds/${id}.mp3`),
    })
    expect(await sounds.url('promoted')).toBeNull()
    expect(fetched).not.toContain(expect.stringContaining('promoted'))
    expect(fetched).toHaveLength(STUDY_SOUND_IDS.length - 1)
  })

  it('appSounds(): one bank per page, on the browser’s fetch, blob URLs and stored setting', async () => {
    vi.resetModules()
    const fetched: string[] = []
    vi.stubGlobal('window', {
      fetch: (url: string) => {
        fetched.push(url)
        return Promise.resolve(new Response('mp3', { headers: { 'Content-Type': 'audio/mpeg' } }))
      },
      localStorage: { getItem: () => 'off', setItem: () => undefined },
    })
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:made')
    try {
      const { appSounds } = await import('./sounds')
      const bank = appSounds()
      expect(appSounds()).toBe(bank)

      expect(bank.on()).toBe(false)
      expect(await bank.url('right')).toBeNull()
      expect(fetched).toEqual([])

      bank.preload()
      const playable = STUDY_SOUND_IDS.map((id) => soundPath(id)).filter((p) => p !== null)
      expect(fetched).toEqual(playable)

      expect(bank.lengthMs('done')).toBe(soundLengthMs('done'))
    } finally {
      created.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it('with sounds off nothing loads and no URL is given', async () => {
    const on = vi.fn(() => false)
    const { sounds, fetched } = bank({ on })
    expect(await sounds.url('listen-on')).toBeNull()
    expect(fetched).toEqual([])
    expect(sounds.on()).toBe(false)
    expect(sounds.lengthMs('listen-on')).toBe(150)
  })
})
