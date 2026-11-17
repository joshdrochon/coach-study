// Loudness meter for the sound files: active RMS over short frames, ignoring near-silence.

import type { SoundEntry, SoundLimits } from '../../src/lib/sound/catalog'

export const ONSET_DB = -50
export const END_DB = -60

export const FLOOR_DB = -120
const FRAME_MS = 10

const ACTIVE_RANGE_DB = 30

export type Measured = {
  durationMs: number

  onsetMs: number

  lengthMs: number

  levelDb: number

  peakDb: number

  clickDb: number
}

export function amplitudeDb(amplitude: number): number {
  return amplitude > 0 ? Math.max(FLOOR_DB, 20 * Math.log10(amplitude)) : FLOOR_DB
}

function powerDb(power: number): number {
  return power > 0 ? Math.max(FLOOR_DB, 10 * Math.log10(power)) : FLOOR_DB
}

function round(value: number, places: number): number {
  const scale = 10 ** places
  return Math.round(value * scale) / scale
}

function meanPower(samples: Float32Array, from: number, to: number): number {
  let sum = 0
  for (let i = from; i < to; i++) {
    const x = samples[i] ?? 0
    sum += x * x
  }
  return to > from ? sum / (to - from) : 0
}

export function measure(samples: Float32Array, sampleRate: number): Measured {
  const ms = (count: number) => (count / sampleRate) * 1000
  const onsetLevel = 10 ** (ONSET_DB / 20)
  const endLevel = 10 ** (END_DB / 20)
  let onset = -1
  let end = -1
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const magnitude = Math.abs(samples[i] ?? 0)
    if (magnitude > peak) peak = magnitude
    if (onset < 0 && magnitude > onsetLevel) onset = i
    if (magnitude > endLevel) end = i
  }
  const durationMs = round(ms(samples.length), 1)
  if (onset < 0 || end < onset) {
    return {
      durationMs,
      onsetMs: durationMs,
      lengthMs: 0,
      levelDb: FLOOR_DB,
      peakDb: round(amplitudeDb(peak), 2),
      clickDb: 0,
    }
  }
  const stop = end + 1
  const frame = Math.max(1, Math.round((sampleRate * FRAME_MS) / 1000))
  const frames: { power: number; count: number }[] = []
  for (let from = onset; from < stop; from += frame) {
    const to = Math.min(stop, from + frame)
    frames.push({ power: meanPower(samples, from, to), count: to - from })
  }
  const loudest = Math.max(...frames.map((f) => f.power))
  const floor = loudest * 10 ** (-ACTIVE_RANGE_DB / 10)
  let energy = 0
  let count = 0
  for (const f of frames) {
    if (f.power < floor) continue
    energy += f.power * f.count
    count += f.count
  }
  const levelDb = powerDb(count > 0 ? energy / count : 0)
  const tail = meanPower(samples, Math.max(onset, stop - frame), stop)
  return {
    durationMs,
    onsetMs: round(ms(onset), 2),
    lengthMs: round(ms(stop - onset), 1),
    levelDb: round(levelDb, 2),
    peakDb: round(amplitudeDb(peak), 2),
    clickDb: round(powerDb(tail) - levelDb, 2),
  }
}

export type SoundRule = 'LENGTH' | 'LEVEL' | 'PEAK' | 'ONSET' | 'CLICK'

export type Problem = { rule: SoundRule; message: string }

export function problems(
  m: Measured,
  entry: Pick<SoundEntry, 'lengthRangeMs' | 'relativeDb'>,
  limits: Pick<SoundLimits, 'peakDb' | 'onsetMs' | 'clickDb' | 'toleranceDb'>,
  voiceLevelDb: number,
  onsetOffsetMs = 0,
): Problem[] {
  const found: Problem[] = []
  const [shortest, longest] = entry.lengthRangeMs
  if (m.lengthMs < shortest || m.lengthMs > longest) {
    found.push({
      rule: 'LENGTH',
      message: `lasts ${String(m.lengthMs)} ms, outside ${String(shortest)}-${String(longest)} ms`,
    })
  }
  const target = voiceLevelDb + entry.relativeDb
  if (Math.abs(m.levelDb - target) > limits.toleranceDb) {
    found.push({
      rule: 'LEVEL',
      message: `level ${String(m.levelDb)} dBFS, target ${String(target)} ± ${String(limits.toleranceDb)} dB`,
    })
  }
  if (m.peakDb > limits.peakDb) {
    found.push({
      rule: 'PEAK',
      message: `peak ${String(m.peakDb)} dBFS, over ${String(limits.peakDb)} dBFS`,
    })
  }
  const lead = round(m.onsetMs - onsetOffsetMs, 2)
  if (lead > limits.onsetMs) {
    found.push({
      rule: 'ONSET',
      message: `starts after ${String(lead)} ms of silence, over ${String(limits.onsetMs)} ms`,
    })
  }
  if (m.clickDb > limits.clickDb) {
    found.push({
      rule: 'CLICK',
      message: `its last 10 ms are ${String(m.clickDb)} dB against its level (a cut, not a fade), over ${String(limits.clickDb)} dB`,
    })
  }
  return found
}
