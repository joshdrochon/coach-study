import { describe, expect, it } from 'vitest'

import { FLOOR_DB, measure, problems, type Measured } from './measure'

const RATE = 44_100
const ENTRY = { lengthRangeMs: [150, 250] as [number, number], relativeDb: -8 }
const LIMITS = { peakDb: -3, onsetMs: 10, clickDb: -6, toleranceDb: 1.5 }
const VOICE_DB = -20
const TARGET_DB = VOICE_DB + ENTRY.relativeDb

type Shape = {
  ms?: number
  leadMs?: number
  fadeMs?: number
  padMs?: number

  decayMs?: number
}

function pluck({ ms = 200, leadMs = 0, fadeMs = 15, padMs = 10, decayMs = 80 }: Shape = {}) {
  const at = (t: number) => Math.round((t / 1000) * RATE)
  const lead = at(leadMs)
  const body = at(ms)
  const fade = at(fadeMs)
  const samples = new Float32Array(lead + body + at(padMs))
  for (let i = 0; i < body; i++) {
    const t = i / RATE
    const second = i >= body / 2
    const since = second ? t - ms / 2000 : t
    const frequency = second ? 1318.5 : 880
    const envelope = decayMs > 0 ? Math.exp(-since / (decayMs / 1000)) : 1
    const fadeGain = i >= body - fade ? (body - i) / fade : 1

    samples[lead + i] = 0.5 * envelope * fadeGain * Math.cos(2 * Math.PI * frequency * since)
  }
  return samples
}

function atLevel(samples: Float32Array, db: number): Float32Array {
  const gain = 10 ** ((db - measure(samples, RATE).levelDb) / 20)
  return samples.map((x) => x * gain)
}

const rules = (m: Measured, onsetOffsetMs = 0) =>
  problems(m, ENTRY, LIMITS, VOICE_DB, onsetOffsetMs).map((p) => p.rule)

describe('measure', () => {
  it('reads a clean sound: its onset, length, level, peak and fade', () => {
    const m = measure(atLevel(pluck(), TARGET_DB), RATE)
    expect(m.onsetMs).toBe(0)

    expect(m.lengthMs).toBeGreaterThan(195)
    expect(m.lengthMs).toBeLessThanOrEqual(200)
    expect(m.levelDb).toBeCloseTo(TARGET_DB, 1)
    expect(m.peakDb).toBeLessThan(-15)
    expect(m.clickDb).toBeLessThan(-6)

    expect(m.durationMs).toBe(210)
  })

  it('reads silence as no sound at all, with finite numbers', () => {
    const m = measure(new Float32Array(4410), RATE)
    expect(m).toEqual({
      durationMs: 100,
      onsetMs: 100,
      lengthMs: 0,
      levelDb: FLOOR_DB,
      peakDb: FLOOR_DB,
      clickDb: 0,
    })
  })

  it('times the length from the sound, not the buffer: decoder padding changes nothing', () => {
    const clean = measure(atLevel(pluck(), TARGET_DB), RATE)
    const padded = new Float32Array(2205 + pluck().length + 2205)
    padded.set(atLevel(pluck(), TARGET_DB), 2205)
    const m = measure(padded, RATE)
    expect(m.onsetMs).toBe(50)
    expect(m.lengthMs).toBe(clean.lengthMs)
    expect(m.levelDb).toBeCloseTo(clean.levelDb, 5)
    expect(m.clickDb).toBeCloseTo(clean.clickDb, 5)
  })
})

describe('problems', () => {
  it('a clean sound has none', () => {
    expect(rules(measure(atLevel(pluck(), TARGET_DB), RATE))).toEqual([])
  })

  it('a steady tone with only the 15 ms fade-out still ends clean', () => {
    const steady = measure(atLevel(pluck({ decayMs: 0 }), TARGET_DB), RATE)
    expect(steady.clickDb).toBeLessThan(LIMITS.clickDb)
    expect(rules(steady)).toEqual([])
  })

  it('length outside its range is rejected', () => {
    expect(rules(measure(atLevel(pluck({ ms: 400, decayMs: 0 }), TARGET_DB), RATE))).toEqual([
      'LENGTH',
    ])
    expect(rules(measure(atLevel(pluck({ ms: 100 }), TARGET_DB), RATE))).toEqual(['LENGTH'])
    const range = problems(
      measure(atLevel(pluck({ ms: 400, decayMs: 0 }), TARGET_DB), RATE),
      ENTRY,
      LIMITS,
      VOICE_DB,
    )
    expect(range[0]?.message).toMatch(/outside 150-250 ms/)
  })

  it('level off target is rejected', () => {
    expect(rules(measure(atLevel(pluck(), TARGET_DB + 8), RATE))).toEqual(['LEVEL'])
    expect(rules(measure(atLevel(pluck(), TARGET_DB - 2.5), RATE))).toEqual(['LEVEL'])

    expect(rules(measure(atLevel(pluck(), TARGET_DB + 1.2), RATE))).toEqual([])
  })

  it('peak over the limit is rejected', () => {
    const spiked = atLevel(pluck(), TARGET_DB)
    spiked[3000] = 0.95
    const m = measure(spiked, RATE)
    expect(m.peakDb).toBeGreaterThan(-3)
    expect(rules(m)).toContain('PEAK')

    const atLimit = atLevel(pluck(), TARGET_DB)
    atLimit[3000] = 10 ** (-3 / 20)
    expect(rules(measure(atLimit, RATE))).not.toContain('PEAK')
  })

  it('unclean edges are rejected', () => {
    expect(rules(measure(atLevel(pluck({ leadMs: 150 }), TARGET_DB), RATE))).toEqual(['ONSET'])

    const cut = measure(atLevel(pluck({ decayMs: 0, fadeMs: 0, padMs: 0 }), TARGET_DB), RATE)
    expect(cut.clickDb).toBeGreaterThan(-1)
    expect(rules(cut)).toEqual(['CLICK'])
  })

  it('takes the decoder’s own lead off the onset', () => {
    const late = measure(atLevel(pluck({ leadMs: 30 }), TARGET_DB), RATE)
    expect(rules(late)).toEqual(['ONSET'])
    expect(rules(late, 30)).toEqual([])
    expect(rules(late, 15)).toEqual(['ONSET'])
  })
})
