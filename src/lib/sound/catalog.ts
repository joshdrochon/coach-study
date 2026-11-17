import { z } from 'zod'

import manifestJson from '../../../design/sounds.json'

import { CUE_GUARD_MS, CUE_START_MS, CUE_STUCK_MS } from './timing'

export const SOUND_IDS = [
  'listen-on',
  'listen-off',
  'right',
  'results',
  'break',
  'done',
  'promoted',
] as const

export type SoundId = (typeof SOUND_IDS)[number]

// Every sound is synthesized in code (scripts/sound/synth.ts) and all of them belong to studying.
export type SynthId = SoundId
export const SYNTH_SOUND_IDS: readonly SynthId[] = SOUND_IDS
export const STUDY_SOUND_IDS: readonly SoundId[] = SOUND_IDS

const SHA256 = /^[0-9a-f]{64}$/

const FILE = /^[a-z-]+\.[0-9a-f]{8}\.mp3$/

const measuredSchema = z.object({
  lengthMs: z.number(),
  levelDb: z.number(),
  peakDb: z.number(),
  onsetMs: z.number(),
  clickDb: z.number(),

  lufs: z.number().nullable(),
  truePeakDb: z.number().nullable(),
})

const madeSchema = z.object({
  model: z.string(),
  format: z.string(),
  candidate: z.number().int().positive(),
  of: z.number().int().positive(),
  naturalMs: z.number(),
  gainDb: z.number(),
  on: z.string(),

  variant: z
    .string()
    .regex(/^[A-Z]$/)
    .optional(),
  recipe: z.string().min(1).optional(),
})

const soundSchema = z
  .object({
    id: z.enum(SOUND_IDS),
    moment: z.string().min(1),
    file: z.string().regex(FILE).nullable(),
    sha256: z.string().regex(SHA256).nullable(),
    enabled: z.boolean(),
    lengthMs: z.number().int().positive(),
    lengthRangeMs: z.tuple([z.number().int().positive(), z.number().int().positive()]),
    relativeDb: z.number().max(0),
    prompt: z.string().min(1),
    durationSeconds: z.number().min(0.5).max(30),
    promptInfluence: z.number().min(0).max(1),
    made: madeSchema.nullable(),
    measured: measuredSchema.nullable(),
    approved: z.object({ by: z.string().min(1), on: z.string().min(1) }).nullable(),
  })
  .refine((sound) => (sound.file === null) === (sound.sha256 === null), {
    message: 'file and sha256 are set together',
  })
  .refine((sound) => sound.file === null || sound.file.startsWith(`${sound.id}.`), {
    message: 'a file is named after its sound',
  })
  .refine(
    (sound) => sound.file === null || sound.file.includes(`.${sound.sha256?.slice(0, 8) ?? ''}.`),
    {
      message: 'a file name carries the first 8 of its sha-256',
    },
  )
  .refine(
    (sound) => sound.lengthRangeMs[0] <= sound.lengthMs && sound.lengthMs <= sound.lengthRangeMs[1],
    {
      message: 'the target length is inside its range',
    },
  )

const ALTERNATE_FILE = /^[a-z-]+\.[a-z]\.[0-9a-f]{8}\.mp3$/

const alternateSchema = z
  .object({
    variant: z.string().regex(/^[A-Z]$/),
    label: z.string().min(1),
    sounds: z.array(
      z
        .object({
          id: z.enum(SOUND_IDS),
          file: z.string().regex(ALTERNATE_FILE),
          sha256: z.string().regex(SHA256),
          made: madeSchema,
          measured: measuredSchema,
        })
        .refine(
          (sound) =>
            sound.file.startsWith(`${sound.id}.`) &&
            sound.file.endsWith(`.${sound.sha256.slice(0, 8)}.mp3`),
          { message: 'an alternate file is named after its sound and carries its sha-256' },
        ),
    ),
  })
  .refine(
    (set) =>
      set.sounds.length === SYNTH_SOUND_IDS.length &&
      SYNTH_SOUND_IDS.every((id) => set.sounds.some((s) => s.id === id)) &&
      set.sounds.every((s) => s.file.split('.')[1] === set.variant.toLowerCase()),
    {
      message: `an alternate set has exactly the code-made sounds ${SYNTH_SOUND_IDS.join(', ')}, named for it`,
    },
  )

export const manifestSchema = z.object({
  comment: z.string(),
  voice: z.object({ levelDb: z.number(), measured: z.boolean(), note: z.string() }),
  limits: z.object({
    guardMs: z.literal(CUE_GUARD_MS),
    startMs: z.literal(CUE_START_MS),
    stuckMs: z.literal(CUE_STUCK_MS),
    peakDb: z.number().max(0),
    onsetMs: z.number().positive(),
    clickDb: z.number().max(0),
    fadeMs: z.number().positive(),
    padMs: z.number().nonnegative(),
    toleranceDb: z.number().positive(),
  }),
  sounds: z
    .array(soundSchema)
    .refine(
      (sounds) =>
        sounds.length === SOUND_IDS.length &&
        SOUND_IDS.every((id) => sounds.some((s) => s.id === id)),
      { message: `exactly the sounds ${SOUND_IDS.join(', ')}` },
    ),
  alternates: z.array(alternateSchema).default([]),
})

export type SoundManifest = z.infer<typeof manifestSchema>
export type SoundEntry = SoundManifest['sounds'][number]
export type SoundLimits = SoundManifest['limits']
export type AlternateSet = SoundManifest['alternates'][number]
export type AlternateSound = AlternateSet['sounds'][number]

export const SOUND_MANIFEST: SoundManifest = manifestSchema.parse(manifestJson)

export { CUE_GUARD_MS, CUE_START_MS, CUE_STUCK_MS }

export function soundEntry(id: SoundId, manifest: SoundManifest = SOUND_MANIFEST): SoundEntry {
  const entry = manifest.sounds.find((sound) => sound.id === id)
  if (!entry) throw new Error(`no sound ${id} in design/sounds.json`)
  return entry
}

export function targetDb(entry: SoundEntry, manifest: SoundManifest = SOUND_MANIFEST): number {
  return manifest.voice.levelDb + entry.relativeDb
}

export function soundFile(entry: Pick<SoundEntry, 'file'>): string | null {
  return entry.file === null ? null : `/sounds/${entry.file}`
}

export function soundPath(id: SoundId, manifest: SoundManifest = SOUND_MANIFEST): string | null {
  const entry = soundEntry(id, manifest)
  return entry.enabled ? soundFile(entry) : null
}

export function soundLengthMs(id: SoundId, manifest: SoundManifest = SOUND_MANIFEST): number {
  const entry = soundEntry(id, manifest)
  return entry.measured?.lengthMs ?? entry.lengthMs
}
