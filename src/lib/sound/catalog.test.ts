import { describe, expect, it } from 'vitest'

import manifestJson from '../../../design/sounds.json'

import {
  CUE_GUARD_MS,
  CUE_START_MS,
  CUE_STUCK_MS,
  manifestSchema,
  SOUND_IDS,
  SYNTH_SOUND_IDS,
  SOUND_MANIFEST,
  soundEntry,
  soundLengthMs,
  soundPath,
  targetDb,
  type SoundManifest,
} from './catalog'

function copy(): SoundManifest {
  return structuredClone(SOUND_MANIFEST)
}

function withVariantB(): SoundManifest {
  const m = copy()
  m.alternates = [
    {
      variant: 'B',
      label: 'glass bell',

      sounds: m.sounds
        .filter((sound) => SYNTH_SOUND_IDS.some((id) => id === sound.id))
        .map((sound) => {
          if (!sound.sha256 || !sound.made || !sound.measured)
            throw new Error(`${sound.id} not made`)
          return {
            id: sound.id,
            file: `${sound.id}.b.${sound.sha256.slice(0, 8)}.mp3`,
            sha256: sound.sha256,
            made: { ...sound.made, variant: 'B' },
            measured: sound.measured,
          }
        }),
    },
  ]
  return m
}

describe('the sound manifest', () => {
  it('lists exactly the seven study sounds', () => {
    expect(SOUND_MANIFEST.sounds.map((sound) => sound.id)).toEqual([
      'listen-on',
      'listen-off',
      'right',
      'results',
      'break',
      'done',
      'promoted',
    ])
    expect(SOUND_IDS).toHaveLength(7)

    expect(SOUND_MANIFEST.sounds.map((sound) => sound.id).join(' ')).not.toMatch(/miss|wrong/)
  })

  it('rejects an eighth sound, a missing one, or an unknown id', () => {
    const extra = copy()
    const first = extra.sounds[0]
    if (!first) throw new Error('no sounds')
    extra.sounds.push({ ...first })
    expect(manifestSchema.safeParse(extra).success).toBe(false)
    const missing = copy()
    missing.sounds.pop()
    expect(manifestSchema.safeParse(missing).success).toBe(false)
    const unknown = structuredClone(manifestJson) as { sounds: { id: string }[] }
    const sound = unknown.sounds[0]
    if (sound) sound.id = 'miss'
    expect(manifestSchema.safeParse(unknown).success).toBe(false)
  })

  it('a file goes with its hash, is named after its sound, and carries the hash', () => {
    const sha = 'a'.repeat(64)
    const ok = copy()
    const entry = ok.sounds[0]
    if (!entry) throw new Error('no sounds')
    Object.assign(entry, { file: 'listen-on.aaaaaaaa.mp3', sha256: sha })
    expect(manifestSchema.safeParse(ok).success).toBe(true)
    for (const bad of [
      { file: 'listen-on.aaaaaaaa.mp3', sha256: null },
      { file: 'right.aaaaaaaa.mp3', sha256: sha },
      { file: 'listen-on.bbbbbbbb.mp3', sha256: sha },
      { file: 'listen-on.mp3', sha256: sha },
    ]) {
      const broken = copy()
      Object.assign(broken.sounds[0] ?? {}, bad)
      expect(manifestSchema.safeParse(broken).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it('an alternate set has all seven, each named <id>.<variant>.<hash8>.mp3', () => {
    expect(SOUND_MANIFEST.alternates).toEqual([])
    const ok = withVariantB()
    expect(manifestSchema.safeParse(ok).success).toBe(true)

    const none = structuredClone(manifestJson) as Record<string, unknown>
    delete none.alternates
    expect(manifestSchema.parse(none).alternates).toEqual([])
    const breakers: ((m: SoundManifest) => void)[] = [
      (m) => m.alternates[0]?.sounds.pop(),

      (m) => {
        const s = m.alternates[0]?.sounds[0]
        if (s) s.file = `${s.id}.${s.sha256.slice(0, 8)}.mp3`
      },

      (m) => {
        const s = m.alternates[0]?.sounds[0]
        if (s) s.file = s.file.replace(s.id, 'right')
      },
      (m) => {
        const s = m.alternates[0]?.sounds[0]
        if (s) s.file = s.file.replace(/\.[a-z]\./, '.z.')
      },

      (m) => {
        const s = m.alternates[0]?.sounds[0]
        if (s) s.sha256 = 'f'.repeat(64)
      },
    ]
    for (const [i, breakIt] of breakers.entries()) {
      const broken = withVariantB()
      breakIt(broken)
      expect(manifestSchema.safeParse(broken).success, String(i)).toBe(false)
    }
  })

  it('the app never plays an alternate: soundPath only ever names the live set', () => {
    for (const id of SOUND_IDS) {
      const live = soundPath(id)
      const alternateFiles = SOUND_MANIFEST.alternates.flatMap((set) =>
        set.sounds.map((s) => `/sounds/${s.file}`),
      )
      expect(alternateFiles).not.toContain(live)
    }
  })

  it('keeps every target length inside its range', () => {
    const broken = copy()
    Object.assign(broken.sounds[0] ?? {}, { lengthMs: 500 })
    expect(manifestSchema.safeParse(broken).success).toBe(false)
  })

  it('serves a sound only when it has a file and is enabled', () => {
    const manifest = copy()
    const entry = manifest.sounds.find((sound) => sound.id === 'right')
    if (!entry) throw new Error('no right')
    Object.assign(entry, { file: null, sha256: null })
    expect(soundPath('right', manifest)).toBeNull()
    Object.assign(entry, { file: 'right.aaaaaaaa.mp3', sha256: 'a'.repeat(64) })
    expect(soundPath('right', manifest)).toBe('/sounds/right.aaaaaaaa.mp3')
    entry.enabled = false
    expect(soundPath('right', manifest)).toBeNull()
  })

  it('times a cue by its measured length, else its target', () => {
    const manifest = copy()
    const entry = soundEntry('done', manifest)
    entry.measured = null
    expect(soundLengthMs('done', manifest)).toBe(entry.lengthMs)
    entry.measured = {
      lengthMs: 1111,
      levelDb: -26,
      peakDb: -6,
      onsetMs: 0,
      clickDb: -20,
      lufs: null,
      truePeakDb: null,
    }
    expect(soundLengthMs('done', manifest)).toBe(1111)
    expect(() => soundEntry('nope' as never, manifest)).toThrow()
  })

  it('sets each target level against the voice, quieter for the frequent listen cues', () => {
    const level = (id: (typeof SOUND_IDS)[number]) => targetDb(soundEntry(id))
    expect(level('listen-on')).toBe(SOUND_MANIFEST.voice.levelDb - 10)
    expect(level('listen-on')).toBeLessThan(level('right'))
    expect(level('right')).toBeLessThan(level('done'))
    for (const sound of SOUND_MANIFEST.sounds) expect(targetDb(sound)).toBeLessThan(0)
  })

  it('holds the timing rules: 200 ms guard, 300 ms start, length + 250 ms', () => {
    expect([CUE_GUARD_MS, CUE_START_MS, CUE_STUCK_MS]).toEqual([200, 300, 250])
    expect(SOUND_MANIFEST.limits).toMatchObject({ guardMs: 200, startMs: 300, stuckMs: 250 })
  })

  it('refuses timing in the manifest that differs from the code’s', () => {
    for (const key of ['guardMs', 'startMs', 'stuckMs'] as const) {
      const changed = copy()
      changed.limits = { ...changed.limits, [key]: changed.limits[key] + 50 }
      expect(manifestSchema.safeParse(changed).success, key).toBe(false)
    }
  })
})
