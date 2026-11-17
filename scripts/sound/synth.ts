// pnpm sound:synth: renders the UI sound effects in code and records each file's
// hash and measured level in design/sounds.json.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import {
  manifestSchema,
  SYNTH_SOUND_IDS as SYNTH_IDS,
  type SoundId,
  type SoundManifest,
  type SynthId,
} from '../../src/lib/sound/catalog'

import { decodeMp3, encodeMp3, loudness } from './codec'
import { measure, problems, type Measured, type Problem } from './measure'

export const RATE = 44_100
export const SYNTH_MODEL = 'synth.ts'
export const SYNTH_FORMAT = 'mp3_44100_128'

const PEAK_MARGIN_DB = 0.5

const TOP_HZ = 6_000

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const MANIFEST_FILE = path.join(ROOT, 'design', 'sounds.json')
const SOUNDS_DIR = path.join(ROOT, 'public', 'sounds')

export type VariantName = 'A' | 'B'

type Partial = {
  ratio: number

  amp: number

  decay: number

  detuneHz?: number
}

export type Instrument = {
  label: string
  attackMs: number
  partials: Partial[]

  roomScale: number
}

export const INSTRUMENTS: Record<VariantName, Instrument> = {
  A: {
    label: 'soft marimba',
    attackMs: 4,
    partials: [
      { ratio: 1, amp: 1, decay: 1 },
      { ratio: 2, amp: 0.06, decay: 0.5 },
      { ratio: 3.93, amp: 0.16, decay: 0.22 },
      { ratio: 9.94, amp: 0.04, decay: 0.08 },
    ],
    roomScale: 1,
  },

  B: {
    label: 'glass bell',
    attackMs: 2,
    partials: [
      { ratio: 1, amp: 1, decay: 1.25 },
      { ratio: 1, amp: 0.3, decay: 1.25, detuneHz: 1.1 },
      { ratio: 2, amp: 0.22, decay: 0.7 },
      { ratio: 2.76, amp: 0.12, decay: 0.45 },
      { ratio: 5.4, amp: 0.05, decay: 0.2 },
    ],
    roomScale: 1.4,
  },
}

export type Note = {
  midi: number
  atMs: number

  velocity: number

  decayMs: number
}

export type Score = {
  id: SoundId

  notes: string
  play: Note[]

  endMs: number
  fadeMs: number

  room: number
}

const C4 = 60
const G4 = 67
const C5 = 72
const D5 = 74
const E5 = 76
const G5 = 79
const C6 = 84
const E6 = 88

export const SCORES: Record<SynthId, Score> = {
  'listen-on': {
    id: 'listen-on',
    notes: 'G4 then C5: a rising fourth, 60 ms apart',
    play: [
      { midi: G4, atMs: 0, velocity: 0.8, decayMs: 45 },
      { midi: C5, atMs: 60, velocity: 1, decayMs: 55 },
    ],
    endMs: 150,
    fadeMs: 45,
    room: 0,
  },
  'listen-off': {
    id: 'listen-off',
    notes: 'C5 then G4: the same fourth, falling',
    play: [
      { midi: C5, atMs: 0, velocity: 1, decayMs: 45 },
      { midi: G4, atMs: 55, velocity: 0.8, decayMs: 50 },
    ],
    endMs: 132,
    fadeMs: 40,
    room: 0,
  },
  right: {
    id: 'right',
    notes: 'C6 then E6: a rising major third, 80 ms apart',
    play: [
      { midi: C6, atMs: 0, velocity: 0.75, decayMs: 70 },
      { midi: E6, atMs: 80, velocity: 1, decayMs: 110 },
    ],
    endMs: 300,
    fadeMs: 90,
    room: 0.08,
  },
  results: {
    id: 'results',
    notes: 'E5, G5, C6: a rising three-note phrase, 90 ms apart',
    play: [
      { midi: E5, atMs: 0, velocity: 0.8, decayMs: 80 },
      { midi: G5, atMs: 90, velocity: 0.85, decayMs: 80 },
      { midi: C6, atMs: 180, velocity: 1, decayMs: 130 },
    ],
    endMs: 400,
    fadeMs: 110,
    room: 0.1,
  },
  break: {
    id: 'break',
    notes: 'E5 down to C5 over a soft C4: a calm falling third',
    play: [
      { midi: E5, atMs: 0, velocity: 0.8, decayMs: 160 },
      { midi: C5, atMs: 170, velocity: 1, decayMs: 230 },
      { midi: C4, atMs: 170, velocity: 0.45, decayMs: 260 },
    ],
    endMs: 520,
    fadeMs: 160,
    room: 0.14,
  },
  done: {
    id: 'done',
    notes: 'G4 and D5, then a C major chord (C5 E5 G5 C6) rolled in 25 ms steps: it resolves home',
    play: [
      { midi: G4, atMs: 0, velocity: 0.55, decayMs: 120 },
      { midi: D5, atMs: 0, velocity: 0.55, decayMs: 120 },
      { midi: C5, atMs: 200, velocity: 0.8, decayMs: 420 },
      { midi: E5, atMs: 225, velocity: 0.75, decayMs: 420 },
      { midi: G5, atMs: 250, velocity: 0.75, decayMs: 420 },
      { midi: C6, atMs: 275, velocity: 0.85, decayMs: 460 },
    ],
    endMs: 1200,
    fadeMs: 320,
    room: 0.18,
  },
  promoted: {
    id: 'promoted',
    notes:
      'C5 E5 G5 C6 rising in 80 ms steps, then a C major chord topped with E6, rolled in 20 ms steps',
    play: [
      { midi: C5, atMs: 0, velocity: 0.65, decayMs: 140 },
      { midi: E5, atMs: 80, velocity: 0.7, decayMs: 140 },
      { midi: G5, atMs: 160, velocity: 0.75, decayMs: 140 },
      { midi: C6, atMs: 240, velocity: 0.8, decayMs: 160 },
      { midi: C5, atMs: 400, velocity: 0.7, decayMs: 560 },
      { midi: E5, atMs: 420, velocity: 0.7, decayMs: 560 },
      { midi: G5, atMs: 440, velocity: 0.7, decayMs: 560 },
      { midi: C6, atMs: 460, velocity: 0.8, decayMs: 600 },
      { midi: E6, atMs: 480, velocity: 0.75, decayMs: 600 },
    ],
    endMs: 1600,
    fadeMs: 420,
    room: 0.22,
  },
}

export function hz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}

export function recipe(variant: VariantName, id: SynthId): string {
  const score = SCORES[id]
  const room = score.room > 0 ? ', a small room' : ', dry'
  return `Variant ${variant}, ${INSTRUMENTS[variant].label}: ${score.notes}${room}; fades out by ${String(score.endMs)} ms`
}

function reverb(dry: Float32Array, mix: number): Float32Array {
  if (mix <= 0) return dry
  const out = new Float32Array(dry.length)
  const rt60 = 0.9
  const combs = [29.7, 37.1, 41.1, 43.7].map((ms) => {
    const delay = Math.round((ms / 1000) * RATE)
    return {
      buffer: new Float32Array(delay),
      at: 0,
      gain: 10 ** ((-3 * (ms / 1000)) / rt60),
      low: 0,
    }
  })
  const damp = 0.35
  const wet = new Float32Array(dry.length)
  for (let i = 0; i < dry.length; i++) {
    const x = dry[i] ?? 0
    let sum = 0
    for (const comb of combs) {
      const y = comb.buffer[comb.at] ?? 0
      comb.low = y * (1 - damp) + comb.low * damp
      comb.buffer[comb.at] = x + comb.low * comb.gain
      comb.at = (comb.at + 1) % comb.buffer.length
      sum += y
    }
    wet[i] = sum / combs.length
  }
  for (const ms of [5, 1.7]) {
    const delay = Math.round((ms / 1000) * RATE)
    const buffer = new Float32Array(delay)
    let at = 0
    const g = 0.7
    for (let i = 0; i < wet.length; i++) {
      const x = wet[i] ?? 0
      const held = buffer[at] ?? 0
      const y = -g * x + held
      buffer[at] = x + g * y
      at = (at + 1) % delay
      wet[i] = y
    }
  }
  for (let i = 0; i < dry.length; i++) out[i] = (dry[i] ?? 0) + mix * (wet[i] ?? 0)
  return out
}

export function render(variant: VariantName, id: SynthId): Float32Array {
  const score = SCORES[id]
  const instrument = INSTRUMENTS[variant]
  const length = Math.round((score.endMs / 1000) * RATE)
  const dry = new Float32Array(length)
  const attack = Math.max(1, Math.round((instrument.attackMs / 1000) * RATE))
  for (const note of score.play) {
    const start = Math.round((note.atMs / 1000) * RATE)
    const f0 = hz(note.midi)
    for (const partial of instrument.partials) {
      const f = f0 * partial.ratio + (partial.detuneHz ?? 0)
      if (f > TOP_HZ) continue
      const tau = ((note.decayMs * partial.decay) / 1000) * RATE
      const step = (2 * Math.PI * f) / RATE
      for (let n = 0; start + n < length; n++) {
        const rise = n < attack ? 0.5 - 0.5 * Math.cos((Math.PI * n) / attack) : 1
        const level = note.velocity * partial.amp * rise * Math.exp(-n / tau)
        if (level < 1e-6 && n > attack) break
        const at = start + n
        dry[at] = (dry[at] ?? 0) + level * Math.sin(step * n)
      }
    }
  }
  const wet = reverb(dry, score.room * instrument.roomScale)
  const fade = Math.round((score.fadeMs / 1000) * RATE)
  const from = length - fade
  for (let i = Math.max(0, from); i < length; i++) {
    const t = (i - from) / fade
    wet[i] = (wet[i] ?? 0) * (0.5 + 0.5 * Math.cos(Math.PI * t))
  }
  return wet
}

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places

export type Leveled = { samples: Float32Array; gainDb: number; naturalMs: number }

export function level(
  variant: VariantName,
  id: SynthId,
  manifest: SoundManifest,
): Leveled | { problem: string } {
  const entry = manifest.sounds.find((s) => s.id === id)
  if (!entry) return { problem: `no ${id} in design/sounds.json` }
  const raw = render(variant, id)
  const before = measure(raw, RATE)
  const target = manifest.voice.levelDb + entry.relativeDb
  const gainDb = round(target - before.levelDb)
  const gain = 10 ** (gainDb / 20)
  const pad = Math.round((manifest.limits.padMs / 1000) * RATE)
  const samples = new Float32Array(raw.length + pad)
  for (let i = 0; i < raw.length; i++) samples[i] = (raw[i] ?? 0) * gain
  const peak = measure(samples, RATE).peakDb
  if (peak > manifest.limits.peakDb - PEAK_MARGIN_DB)
    return { problem: `peak ${String(peak)} dBFS at the target level` }
  return { samples, gainDb, naturalMs: before.lengthMs }
}

export function pcmProblems(
  samples: Float32Array,
  id: SoundId,
  manifest: SoundManifest,
): { measured: Measured; problems: Problem[] } {
  const entry = manifest.sounds.find((s) => s.id === id)
  if (!entry) throw new Error(`no ${id} in design/sounds.json`)
  const measured = measure(samples, RATE)
  return {
    measured,
    problems: problems(measured, entry, manifest.limits, manifest.voice.levelDb),
  }
}

export type Synthesized = {
  id: SoundId
  variant: VariantName
  mp3: Uint8Array
  sha256: string
  file: string
  made: NonNullable<SoundManifest['sounds'][number]['made']>
  measured: NonNullable<SoundManifest['sounds'][number]['measured']>
}

export function fileName(id: SoundId, sha256: string, live: boolean, variant: VariantName): string {
  return live
    ? `${id}.${sha256.slice(0, 8)}.mp3`
    : `${id}.${variant.toLowerCase()}.${sha256.slice(0, 8)}.mp3`
}

export function synthesize(
  variant: VariantName,
  id: SynthId,
  manifest: SoundManifest,
  live: boolean,
  today: string,
): Synthesized {
  const leveled = level(variant, id, manifest)
  if ('problem' in leveled) throw new Error(`${variant}/${id}: ${leveled.problem}`)

  const entry = manifest.sounds.find((s) => s.id === id)
  const target = manifest.voice.levelDb + (entry?.relativeDb ?? 0)
  let mp3 = encodeMp3(leveled.samples)
  let checked = pcmProblems(decodeMp3(mp3), id, manifest)
  const offDb = round(target - checked.measured.levelDb)
  if (Math.abs(offDb) > 0.1) {
    const gain = 10 ** (offDb / 20)
    mp3 = encodeMp3(leveled.samples.map((x) => x * gain))
    checked = pcmProblems(decodeMp3(mp3), id, manifest)
    leveled.gainDb = round(leveled.gainDb + offDb)
  }
  if (checked.problems.length > 0) {
    throw new Error(
      `${variant}/${id}: ${checked.problems.map((p) => `${p.rule} ${p.message}`).join('; ')}`,
    )
  }
  const sha256 = createHash('sha256').update(mp3).digest('hex')
  const m = checked.measured
  return {
    id,
    variant,
    mp3,
    sha256,
    file: fileName(id, sha256, live, variant),
    made: {
      model: SYNTH_MODEL,
      format: SYNTH_FORMAT,
      candidate: 1,
      of: 1,
      naturalMs: leveled.naturalMs,
      gainDb: leveled.gainDb,
      on: today,
      variant,
      recipe: recipe(variant, id),
    },
    measured: {
      lengthMs: m.lengthMs,
      levelDb: m.levelDb,
      peakDb: m.peakDb,
      onsetMs: m.onsetMs,
      clickDb: m.clickDb,
      ...loudness(mp3),
    },
  }
}

export function nextManifest(
  manifest: SoundManifest,
  made: readonly Synthesized[],
  live: VariantName,
): SoundManifest {
  const next = structuredClone(manifest)
  for (const sound of made.filter((s) => s.variant === live)) {
    const entry = next.sounds.find((s) => s.id === sound.id)
    if (!entry) continue
    Object.assign(entry, {
      file: sound.file,
      sha256: sound.sha256,
      made: sound.made,
      measured: sound.measured,
      approved: null,
    })
  }
  const others = (['A', 'B'] as const).filter((v) => v !== live)
  next.alternates = others.map((variant) => ({
    variant,
    label: INSTRUMENTS[variant].label,
    sounds: made
      .filter((s) => s.variant === variant)
      .map((s) => ({
        id: s.id,
        file: s.file,
        sha256: s.sha256,
        made: s.made,
        measured: s.measured,
      })),
  }))
  return manifestSchema.parse(next)
}

export function mergeOnly(manifest: SoundManifest, made: readonly Synthesized[]): SoundManifest {
  const next = structuredClone(manifest)
  for (const sound of made) {
    const entry = next.sounds.find((s) => s.id === sound.id)
    if (!entry) continue
    Object.assign(entry, {
      file: sound.file,
      sha256: sound.sha256,
      made: sound.made,
      measured: sound.measured,
      approved: null,
    })
  }
  return manifestSchema.parse(next)
}

export function onlyIds(argv: readonly string[]): SynthId[] | { problem: string } | null {
  const at = argv.indexOf('--only')
  if (at === -1) return null
  const ids = (argv[at + 1] ?? '').split(',').filter((id) => id !== '')
  const unknown = ids.filter((id) => !(SYNTH_IDS as readonly string[]).includes(id))
  if (ids.length === 0 || unknown.length > 0) {
    return {
      problem: `--only takes code-made sound ids (${SYNTH_IDS.join(', ')}), not ${unknown.join(', ') || 'nothing'}`,
    }
  }
  return ids as SynthId[]
}

function writeOnly(
  manifest: SoundManifest,
  ids: readonly SynthId[],
  live: VariantName,
  today: string,
  print: (line: string) => void,
): number {
  const made: Synthesized[] = []
  try {
    for (const id of ids) {
      const sound = synthesize(live, id, manifest, true, today)
      made.push(sound)
      const m = sound.measured
      print(
        `${live} ${id}: ${String(m.lengthMs)} ms, ${String(m.levelDb)} dBFS, peak ${String(m.peakDb)} dBFS, last 10 ms ${String(m.clickDb)} dB -> ${sound.file}`,
      )
    }
  } catch (error) {
    print(`failed, nothing written: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
  const next = mergeOnly(manifest, made)
  mkdirSync(SOUNDS_DIR, { recursive: true })
  const keep = new Set(made.map((s) => s.file))
  for (const old of readdirSync(SOUNDS_DIR)) {
    const ownedByRemade = made.some((s) => old.startsWith(`${s.id}.`))
    if (ownedByRemade && !keep.has(old)) rmSync(path.join(SOUNDS_DIR, old))
  }
  for (const sound of made) writeFileSync(path.join(SOUNDS_DIR, sound.file), sound.mp3)
  writeFileSync(MANIFEST_FILE, `${JSON.stringify(next, null, 2)}\n`)
  print(`remade ${made.map((s) => s.id).join(', ')} (variant ${live}); every other sound unchanged`)
  return 0
}

export function main(argv: readonly string[], print: (line: string) => void): number {
  const at = argv.indexOf('--live')
  const asked = at === -1 ? 'A' : argv[at + 1]
  if (asked !== 'A' && asked !== 'B') {
    print(`--live takes A or B, not ${String(asked)}`)
    return 2
  }
  const live: VariantName = asked
  const only = onlyIds(argv)
  if (only !== null && 'problem' in only) {
    print(only.problem)
    return 2
  }
  const manifest = manifestSchema.parse(JSON.parse(readFileSync(MANIFEST_FILE, 'utf8')))
  const today = new Date().toISOString().slice(0, 10)
  if (only !== null) return writeOnly(manifest, only, live, today, print)
  const made: Synthesized[] = []
  try {
    for (const variant of ['A', 'B'] as const) {
      for (const id of SYNTH_IDS) {
        const sound = synthesize(variant, id, manifest, variant === live, today)
        made.push(sound)
        const m = sound.measured
        print(
          `${variant} ${id}: ${String(m.lengthMs)} ms, ${String(m.levelDb)} dBFS, peak ${String(m.peakDb)} dBFS, true peak ${String(m.truePeakDb)}, last 10 ms ${String(m.clickDb)} dB -> ${sound.file}`,
        )
      }
    }
  } catch (error) {
    print(`failed, nothing written: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
  const next = nextManifest(manifest, made, live)
  mkdirSync(SOUNDS_DIR, { recursive: true })
  const keep = new Set(made.map((s) => s.file))
  if (existsSync(SOUNDS_DIR)) {
    for (const old of readdirSync(SOUNDS_DIR)) {
      if (!old.startsWith('.') && !keep.has(old)) rmSync(path.join(SOUNDS_DIR, old))
    }
  }
  for (const sound of made) writeFileSync(path.join(SOUNDS_DIR, sound.file), sound.mp3)
  writeFileSync(MANIFEST_FILE, `${JSON.stringify(next, null, 2)}\n`)
  print(`live set: ${live} (${INSTRUMENTS[live].label}); ${String(made.length)} files written`)
  return 0
}

if (
  process.argv[1]?.endsWith(`${path.sep}synth.ts`) &&
  process.argv[1].includes(`${path.sep}sound${path.sep}`)
) {
  process.exitCode = main(process.argv.slice(2), (line) => {
    console.log(line)
  })
}
