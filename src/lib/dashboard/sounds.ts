import {
  SOUND_MANIFEST,
  soundFile,
  targetDb,
  type AlternateSound,
  type SoundEntry,
  type SoundManifest,
} from '@/lib/sound/catalog'

const MINUS = '−'

export function decibels(value: number): string {
  const tenths = Math.round(value * 10)
  const text = (Math.abs(tenths) / 10).toFixed(1)
  return tenths < 0 ? `${MINUS}${text}` : text
}

export function millis(value: number): string {
  return `${String(Math.round(value))} ms`
}

export function day(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match) return iso
  const [, year, month, date] = match
  const at = new Date(Date.UTC(Number(year), Number(month) - 1, Number(date), 12))
  return at.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export type SoundView = {
  id: SoundEntry['id']
  moment: string

  src: string | null
  made: boolean

  sourceLabel: string
  source: string
  target: string
  measured: string | null
  making: string | null
  plays: string
  approval: string

  alternates: AlternateView[]
}

export type AlternateView = {
  variant: string
  label: string
  src: string
  source: string
  measured: string
}

export function targetText(entry: SoundEntry, manifest: SoundManifest = SOUND_MANIFEST): string {
  const [low, high] = entry.lengthRangeMs
  const under = decibels(Math.abs(entry.relativeDb))
  return `${millis(entry.lengthMs)} (${String(low)}–${String(high)} ms) · level ${decibels(targetDb(entry, manifest))} dBFS, ${under} dB under the voice`
}

export function measuredText(entry: Pick<SoundEntry, 'measured'>): string | null {
  const m = entry.measured
  if (!m) return null
  const parts = [
    millis(m.lengthMs),
    `level ${decibels(m.levelDb)} dBFS`,
    `peak ${decibels(m.peakDb)} dBFS`,
    `starts ${millis(m.onsetMs)} in`,
    `last 10 ms ${decibels(m.clickDb)} dB`,
  ]
  if (m.lufs !== null) parts.push(`${decibels(m.lufs)} LUFS`)
  if (m.truePeakDb !== null) parts.push(`true peak ${decibels(m.truePeakDb)} dBTP`)
  return parts.join(' · ')
}

export function makingText(entry: Pick<SoundEntry, 'made'>): string | null {
  const made = entry.made
  if (!made) return null
  if (made.recipe !== undefined) {
    return `Synthesized in code (scripts/sound/synth.ts), no outside service · gain ${decibels(made.gainDb)} dB · ${day(made.on)}`
  }
  return `Candidate ${String(made.candidate)} of ${String(made.of)}, kept by measurement · ${millis(made.naturalMs)} as made · gain ${decibels(made.gainDb)} dB · ${made.model} · ${day(made.on)}`
}

export function approvalText(entry: SoundEntry): string {
  return entry.approved
    ? `Approved by ${entry.approved.by} on ${day(entry.approved.on)}`
    : 'Not approved yet'
}

export function playsText(entry: SoundEntry): string {
  if (!entry.enabled) return 'Off: turned off in design/sounds.json, so it never plays'
  if (entry.file === null) return 'Never plays until it’s made'
  return entry.made?.variant === undefined ? 'On' : `On: variant ${entry.made.variant}`
}

function alternateView(sound: AlternateSound, variant: string, label: string): AlternateView {
  return {
    variant,
    label,
    src: `/sounds/${sound.file}`,
    source: sound.made.recipe ?? `Variant ${variant}, ${label}`,
    measured: measuredText(sound) ?? '',
  }
}

export function soundViews(manifest: SoundManifest = SOUND_MANIFEST): SoundView[] {
  return manifest.sounds.map((entry) => ({
    id: entry.id,
    moment: entry.moment,
    src: soundFile(entry),
    made: entry.file !== null,
    sourceLabel: entry.made?.recipe === undefined ? 'Prompt' : 'Made from',
    source: entry.made?.recipe ?? entry.prompt,
    target: targetText(entry, manifest),
    measured: measuredText(entry),
    making: makingText(entry),
    plays: playsText(entry),
    approval: approvalText(entry),
    alternates: manifest.alternates.flatMap((set) =>
      set.sounds
        .filter((sound) => sound.id === entry.id)
        .map((sound) => alternateView(sound, set.variant, set.label)),
    ),
  }))
}
