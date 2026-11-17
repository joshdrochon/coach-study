import { describe, expect, it } from 'vitest'

import { SOUND_IDS, SOUND_MANIFEST, SYNTH_SOUND_IDS, type SoundManifest } from '@/lib/sound/catalog'

import {
  approvalText,
  day,
  decibels,
  makingText,
  measuredText,
  millis,
  playsText,
  soundViews,
  targetText,
} from './sounds'

const MINUS = '−'

function madeManifest(): SoundManifest {
  return {
    ...SOUND_MANIFEST,
    sounds: SOUND_MANIFEST.sounds.map((sound) => {
      if (sound.id === 'listen-on') {
        return {
          ...sound,

          enabled: true,
          file: 'listen-on.0123abcd.mp3',
          sha256: `0123abcd${'0'.repeat(56)}`,
          made: {
            model: 'eleven_text_to_sound_v2',
            format: 'mp3_44100_128',
            candidate: 2,
            of: 2,
            naturalMs: 412.4,
            gainDb: -8.44,
            on: '2026-08-18',
          },
          measured: {
            lengthMs: 148.4,
            levelDb: -30.24,
            peakDb: -6.06,
            onsetMs: 1.6,
            clickDb: -12.31,
            lufs: -28.94,
            truePeakDb: -5.81,
          },
          approved: { by: 'the admin', on: '2026-08-19' },
        }
      }
      if (sound.id === 'right') return { ...sound, enabled: false }

      return {
        ...sound,
        enabled: true,
        file: null,
        sha256: null,
        made: null,
        measured: null,
        approved: null,
      }
    }),
    alternates: [],
  }
}

function synthManifest(): SoundManifest {
  const listenOn = SOUND_MANIFEST.sounds.find((s) => s.id === 'listen-on')
  if (!listenOn) throw new Error('no listen-on')
  const made = {
    model: 'synth.ts',
    format: 'mp3_44100_128',
    candidate: 1,
    of: 1,
    naturalMs: 147.5,
    gainDb: -20.59,
    on: '2026-08-20',
  }
  const measured = {
    lengthMs: 142.3,
    levelDb: -30,
    peakDb: -19.98,
    onsetMs: 0,
    clickDb: -19.93,
    lufs: null,
    truePeakDb: -20,
  }
  return {
    ...SOUND_MANIFEST,
    sounds: SOUND_MANIFEST.sounds.map((sound) =>
      sound.id === 'listen-on'
        ? {
            ...sound,
            enabled: true,
            file: 'listen-on.0123abcd.mp3',
            sha256: `0123abcd${'0'.repeat(56)}`,
            made: { ...made, variant: 'A', recipe: 'Variant A, soft marimba: G4 then C5' },
            measured,
          }
        : sound,
    ),
    alternates: [
      {
        variant: 'B',
        label: 'glass bell',
        sounds: SYNTH_SOUND_IDS.map((id) => ({
          id,
          file: `${id}.b.4567cdef.mp3`,
          sha256: `4567cdef${'0'.repeat(56)}`,
          made: { ...made, variant: 'B', recipe: `Variant B, glass bell: ${id}` },
          measured,
        })),
      },
    ],
  }
}

describe('/admin/sounds text', () => {
  it('writes levels with one decimal and a real minus sign', () => {
    expect(decibels(-30.24)).toBe(`${MINUS}30.2`)
    expect(decibels(-0.04)).toBe('0.0')
    expect(decibels(1.25)).toBe('1.3')
    expect(millis(148.4)).toBe('148 ms')
  })

  it('writes a calendar day the same in every time zone', () => {
    expect(day('2026-08-18')).toBe('Aug 18, 2026')
    expect(day('not a date')).toBe('not a date')
  })

  it('states the target length, its range and the level against the voice', () => {
    const listenOn = SOUND_MANIFEST.sounds.find((s) => s.id === 'listen-on')
    if (!listenOn) throw new Error('no listen-on')
    expect(targetText(listenOn)).toBe(
      `150 ms (100–180 ms) · level ${MINUS}30.0 dBFS, 10.0 dB under the voice`,
    )
  })

  it('shows every measured value, and says so when a sound is not made yet', () => {
    const manifest = madeManifest()
    const [listenOn, listenOff] = manifest.sounds
    if (!listenOn || !listenOff) throw new Error('missing sounds')
    expect(measuredText(listenOn)).toBe(
      `148 ms · level ${MINUS}30.2 dBFS · peak ${MINUS}6.1 dBFS · starts 2 ms in · last 10 ms ${MINUS}12.3 dB · ${MINUS}28.9 LUFS · true peak ${MINUS}5.8 dBTP`,
    )
    expect(measuredText(listenOff)).toBeNull()
    expect(makingText(listenOn)).toBe(
      `Candidate 2 of 2, kept by measurement · 412 ms as made · gain ${MINUS}8.4 dB · eleven_text_to_sound_v2 · Aug 18, 2026`,
    )
    expect(makingText(listenOff)).toBeNull()
  })

  it('leaves LUFS and true peak out when ffmpeg had none for a short sound', () => {
    const manifest = madeManifest()
    const listenOn = manifest.sounds[0]
    if (!listenOn?.measured) throw new Error('missing measured')
    const short = { ...listenOn, measured: { ...listenOn.measured, lufs: null, truePeakDb: null } }
    expect(measuredText(short)).not.toMatch(/LUFS|dBTP/)
  })

  it('says whether each sound plays in the app and who approved it', () => {
    const manifest = madeManifest()
    const byId = new Map(manifest.sounds.map((s) => [s.id, s]))
    const get = (id: string) => {
      const sound = byId.get(id as (typeof SOUND_IDS)[number])
      if (!sound) throw new Error(id)
      return sound
    }
    expect(playsText(get('listen-on'))).toBe('On')
    expect(playsText(get('listen-off'))).toBe('Never plays until it’s made')
    expect(playsText(get('right'))).toBe('Off: turned off in design/sounds.json, so it never plays')
    expect(approvalText(get('listen-on'))).toBe('Approved by the admin on Aug 19, 2026')
    expect(approvalText(get('listen-off'))).toBe('Not approved yet')
  })

  it('the live manifest: the mic’s own sounds are off, the five moment sounds on', () => {
    const plays = Object.fromEntries(soundViews().map((view) => [view.id, view.plays]))
    expect(plays['listen-on']).toBe('Off: turned off in design/sounds.json, so it never plays')
    expect(plays['listen-off']).toBe('Off: turned off in design/sounds.json, so it never plays')
    for (const id of ['right', 'results', 'break', 'done', 'promoted']) {
      expect(plays[id], id).toBe('On: variant A')
    }
  })

  it('lists all seven sounds in the manifest’s order, with a file only once one is made', () => {
    const views = soundViews(madeManifest())
    expect(views.map((v) => v.id)).toEqual([...SOUND_IDS])
    expect(views[0]?.src).toBe('/sounds/listen-on.0123abcd.mp3')
    expect(views[0]?.made).toBe(true)
    expect(views[1]?.src).toBeNull()
    expect(views.every((v) => v.source.length > 0)).toBe(true)
    expect(views[1]?.sourceLabel).toBe('Prompt')
    expect(views.every((v) => v.alternates.length === 0)).toBe(true)
  })

  it('shows a synthesized sound’s recipe, its variant, and the other variant to compare', () => {
    const views = soundViews(synthManifest())
    const listenOn = views[0]
    if (!listenOn) throw new Error('no listen-on')
    expect(listenOn.sourceLabel).toBe('Made from')
    expect(listenOn.source).toBe('Variant A, soft marimba: G4 then C5')
    expect(listenOn.plays).toBe('On: variant A')
    const listenOnEntry = synthManifest().sounds[0]
    if (!listenOnEntry) throw new Error('no listen-on')
    expect(makingText(listenOnEntry)).toBe(
      `Synthesized in code (scripts/sound/synth.ts), no outside service · gain ${MINUS}20.6 dB · Aug 20, 2026`,
    )
    for (const view of views) {
      expect(view.alternates).toHaveLength(1)
      expect(view.alternates[0]).toMatchObject({
        variant: 'B',
        label: 'glass bell',
        src: `/sounds/${view.id}.b.4567cdef.mp3`,
        source: `Variant B, glass bell: ${view.id}`,
      })
      expect(view.alternates[0]?.measured).toMatch(/^142 ms · level /)
    }
  })
})
