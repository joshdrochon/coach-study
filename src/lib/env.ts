import 'server-only'

// Reads and checks server settings once. Optional features report what is missing
// instead of failing the app.

import { z } from 'zod'

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_PASSCODE: z.string().regex(/^\d{4}$/, 'APP_PASSCODE must be exactly 4 digits'),
  ADMIN_PASSCODE: z.string().min(16, 'ADMIN_PASSCODE must be at least 16 characters'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),

  ANTHROPIC_API_KEY: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(1).optional(),
  ),
})

export type ServerEnv = z.infer<typeof serverEnvSchema>

type EnvSource = Record<string, string | undefined>

export function readServerEnv(source: EnvSource = process.env): ServerEnv {
  return serverEnvSchema.parse(source)
}

const pushEnvSchema = z.object({
  VAPID_PUBLIC_KEY: z
    .string()
    .trim()
    .regex(/^B[A-Za-z0-9_-]{86}$/, 'VAPID_PUBLIC_KEY must be a base64url P-256 public key'),

  VAPID_PRIVATE_KEY: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{43}$/, 'VAPID_PRIVATE_KEY must be a base64url P-256 private key'),

  VAPID_SUBJECT: z
    .string()
    .trim()
    .regex(/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/, 'VAPID_SUBJECT must be mailto: or https:'),
})

const nudgeSecretSchema = z.string().trim().min(32, 'NUDGE_SECRET must be at least 32 characters')

export type PushKeys = { publicKey: string; privateKey: string; subject: string }

export function readPushKeys(source: EnvSource = process.env): PushKeys | null {
  const parsed = pushEnvSchema.safeParse(source)
  if (!parsed.success) return null
  return {
    publicKey: parsed.data.VAPID_PUBLIC_KEY,
    privateKey: parsed.data.VAPID_PRIVATE_KEY,
    subject: parsed.data.VAPID_SUBJECT,
  }
}

export function readNudgeSecret(source: EnvSource = process.env): string | null {
  const parsed = nudgeSecretSchema.safeParse(source.NUDGE_SECRET)
  return parsed.success ? parsed.data : null
}

export type EnvHealth = {
  database: boolean
  passcode: boolean
  adminPasscode: boolean
  sessionSecret: boolean
  tutorKey: boolean
  pushKeys: boolean
  nudgeSecret: boolean
}

export const OPTIONAL_SETTINGS: readonly (keyof EnvHealth)[] = [
  'tutorKey',
  'pushKeys',
  'nudgeSecret',
]

export function envHealth(source: EnvSource = process.env): EnvHealth {
  const field = (key: keyof typeof serverEnvSchema.shape): boolean =>
    source[key] !== undefined &&
    source[key] !== '' &&
    serverEnvSchema.shape[key].safeParse(source[key]).success
  return {
    database: field('DATABASE_URL'),
    passcode: field('APP_PASSCODE'),
    adminPasscode: field('ADMIN_PASSCODE'),
    sessionSecret: field('SESSION_SECRET'),
    tutorKey: field('ANTHROPIC_API_KEY'),
    pushKeys: readPushKeys(source) !== null,
    nudgeSecret: readNudgeSecret(source) !== null,
  }
}
