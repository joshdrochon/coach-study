import { describe, expect, it } from 'vitest'

import {
  SOUND_MANIFEST,
  SYNTH_SOUND_IDS as SYNTH_IDS,
  type SoundManifest,
  type SynthId,
} from '../../src/lib/sound/catalog'

import { measure } from './measure'
import {
  fileName,
  hz,
  INSTRUMENTS,
  level,
  main,
  mergeOnly,
  nextManifest,
  onlyIds,
  pcmProblems,
  RATE,
  recipe,
  render,
  SCORES,
  type Synthesized,
  type VariantName,
} from './synth'

const VARIANTS: VariantName[] = ['A', 'B']

describe('the synthesized family', () => {
  it('renders the same samples every time (nothing random)', () => {
    for (const variant of VARIANTS) {
      const a = render(variant, 'done')
      const b = render(variant, 'done')
      expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true)
    }
  })

  it('every sound of both variants meets its length, level, peak, onset and clean end', () => {
    for (const variant of VARIANTS) {
      for (const id of SYNTH_IDS) {
        const leveled = level(variant, id, SOUND_MANIFEST)
        if ('problem' in leveled) throw new Error(`${variant}/${id}: ${leveled.problem}`)
        const { problems } = pcmProblems(leveled.samples, id, SOUND_MANIFEST)
        expect(problems, `${variant}/${id}`).toEqual([])
      }
    }
  })

  it('is one family in C major: every note is C, D, E, G or A, within C4 to E6', () => {
    const inKey = new Set([0, 2, 4, 7, 9])
    for (const score of Object.values(SCORES)) {
      for (const note of score.play) {
        expect(inKey.has(note.midi % 12), `${score.id} ${String(note.midi)}`).toBe(true)
        expect(note.midi).toBeGreaterThanOrEqual(60)
        expect(note.midi).toBeLessThanOrEqual(88)
      }
    }
    expect(hz(69)).toBe(440)
  })

  it('listen-off is listen-on reversed: rising, then falling', () => {
    const on = SCORES['listen-on'].play.map((n) => n.midi)
    const off = SCORES['listen-off'].play.map((n) => n.midi)
    expect(on[1]).toBeGreaterThan(on[0] ?? Infinity)
    expect(off).toEqual([...on].reverse())
  })

  it('the turn cues sit below the right chime, so the two never sound alike', () => {
    const top = (id: keyof typeof SCORES) => Math.max(...SCORES[id].play.map((n) => n.midi))
    const bottom = (id: keyof typeof SCORES) => Math.min(...SCORES[id].play.map((n) => n.midi))
    expect(bottom('right') - top('listen-on')).toBeGreaterThanOrEqual(12)
  })

  it('the two variants differ in timbre, not in notes', () => {
    expect(INSTRUMENTS.A.label).not.toBe(INSTRUMENTS.B.label)
    const a = render('A', 'right')
    const b = render('B', 'right')
    expect(a.length).toBe(b.length)
    expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(false)
  })

  it('every sound fades to silence: nothing above −60 dBFS at its last sample', () => {
    for (const variant of VARIANTS) {
      for (const id of SYNTH_IDS) {
        const samples = render(variant, id)
        expect(Math.abs(samples[samples.length - 1] ?? 1), `${variant}/${id}`).toBeLessThan(0.001)
        expect(measure(samples, RATE).onsetMs).toBeLessThan(2)
      }
    }
  })
})

describe('files and the manifest', () => {
  it('names a live file <id>.<hash8>.mp3 and an alternate <id>.<variant>.<hash8>.mp3', () => {
    const sha = 'abcdef12'.padEnd(64, '0')
    expect(fileName('right', sha, true, 'A')).toBe('right.abcdef12.mp3')
    expect(fileName('right', sha, false, 'B')).toBe('right.b.abcdef12.mp3')
  })

  it('puts the live variant in sounds and the other in alternates, approval cleared', () => {
    const fake = (variant: VariantName, live: boolean): Synthesized[] =>
      SYNTH_IDS.map((id) => {
        const sha256 = (variant === 'A' ? 'a' : 'b').repeat(64)
        return {
          id,
          variant,
          mp3: new Uint8Array(),
          sha256,
          file: fileName(id, sha256, live, variant),
          made: {
            model: 'synth.ts',
            format: 'mp3_44100_128',
            candidate: 1,
            of: 1,
            naturalMs: 100,
            gainDb: -20,
            on: '2026-08-20',
            variant,
            recipe: recipe(variant, id),
          },
          measured: {
            lengthMs: 100,
            levelDb: -30,
            peakDb: -20,
            onsetMs: 0,
            clickDb: -20,
            lufs: null,
            truePeakDb: -20,
          },
        }
      })
    const approved: SoundManifest = {
      ...SOUND_MANIFEST,
      sounds: SOUND_MANIFEST.sounds.map((s) => ({
        ...s,
        approved: { by: 'the admin', on: '2026-08-19' },
      })),
    }
    const asB = nextManifest(approved, [...fake('A', false), ...fake('B', true)], 'B')

    expect(asB.sounds.every((s) => s.made?.variant === 'B' && s.approved === null)).toBe(true)
    expect(asB.sounds[0]?.file).toBe('listen-on.bbbbbbbb.mp3')
    expect(asB.alternates.map((set) => set.variant)).toEqual(['A'])
    expect(asB.alternates[0]?.sounds[0]?.file).toBe('listen-on.a.aaaaaaaa.mp3')

    expect(asB.sounds[0]?.prompt).toBe(SOUND_MANIFEST.sounds[0]?.prompt)
  })

  it('the committed manifest is this code’s output: variant A live and approved, B removed', () => {
    const isTone = (id: (typeof SOUND_MANIFEST.sounds)[number]['id']): id is SynthId =>
      SYNTH_IDS.some((synth) => synth === id)
    for (const sound of SOUND_MANIFEST.sounds) {
      if (!isTone(sound.id)) {
        expect(sound.made?.model).toBe('eleven_text_to_sound_v2')
        expect(sound.made?.recipe).toBeUndefined()
        expect(sound.approved).toEqual({ by: 'the admin', on: '2026-09-04' })
        continue
      }
      expect(sound.made?.model).toBe('synth.ts')
      expect(sound.made?.variant).toBe('A')
      expect(sound.made?.recipe).toBe(recipe('A', sound.id))

      expect(sound.approved).toEqual({ by: 'the admin', on: '2026-08-19' })
    }
    expect(INSTRUMENTS.A.label).toBe('soft marimba')
    expect(SOUND_MANIFEST.alternates).toEqual([])
  })

  it('--only remakes just the sounds it names; every other sound and approval stays', () => {
    expect(onlyIds(['--only', 'promoted,results'])).toEqual(['promoted', 'results'])
    expect(onlyIds([])).toBeNull()
    const problem = (argv: string[]) => {
      const got = onlyIds(argv)
      return got !== null && 'problem' in got ? got.problem : ''
    }
    expect(problem(['--only', 'miss'])).toMatch(/not miss/)
    expect(problem(['--only'])).toMatch(/not nothing/)
    const sha256 = 'c'.repeat(64)
    const remade: Synthesized = {
      id: 'promoted',
      variant: 'A',
      mp3: new Uint8Array(),
      sha256,
      file: fileName('promoted', sha256, true, 'A'),
      made: {
        model: 'synth.ts',
        format: 'mp3_44100_128',
        candidate: 1,
        of: 1,
        naturalMs: 60,
        gainDb: -20,
        on: '2026-08-30',
        variant: 'A',
        recipe: recipe('A', 'promoted'),
      },
      measured: {
        lengthMs: 60,
        levelDb: -38,
        peakDb: -27,
        onsetMs: 0,
        clickDb: -18,
        lufs: null,
        truePeakDb: -27,
      },
    }
    const next = mergeOnly(SOUND_MANIFEST, [remade])
    const submit = next.sounds.find((s) => s.id === 'promoted')
    expect(submit?.file).toBe('promoted.cccccccc.mp3')
    expect(submit?.approved).toBeNull()
    for (const sound of next.sounds.filter((s) => s.id !== 'promoted')) {
      expect(sound).toEqual(SOUND_MANIFEST.sounds.find((s) => s.id === sound.id))
    }
    expect(next.alternates).toEqual(SOUND_MANIFEST.alternates)
  })

  it('refuses an --only with an unknown sound, before it writes anything', () => {
    const lines: string[] = []
    expect(main(['--only', 'promoted,miss'], (line) => lines.push(line))).toBe(2)
    expect(lines[0]).toMatch(/not miss/)
  })

  it('refuses a --live that is not A or B, before it writes anything', () => {
    const lines: string[] = []
    expect(main(['--live', 'C'], (line) => lines.push(line))).toBe(2)
    expect(lines).toEqual(['--live takes A or B, not C'])
  })
})
