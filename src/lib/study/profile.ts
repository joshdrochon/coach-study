import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import type { Db } from '../db/client'
import { profile } from '../db/schema'
import { TITLES, type CoachTitle } from '../progress/titles'

import {
  PRACTICE_CLASSES,
  PRACTICE_SESSIONS,
  profileChangeSchema,
  type ProfileChange,
} from './profile-change'

export const DEFAULT_TITLE: CoachTitle = 'Starter'

export const DEFAULT_AVATAR_VERSION = 'default'

export const avatarMd5Sql = sql`md5(${profile.avatarJpegBase64})`
export const avatarMd5Schema = z
  .string()
  .regex(/^[0-9a-f]{32}$/)
  .nullable()

export function avatarVersion(md5: string | null): string {
  return md5 === null ? DEFAULT_AVATAR_VERSION : md5.slice(0, 12)
}

export function avatarUrl(version: string): string {
  return `/api/avatar?v=${version}`
}

const profileRowSchema = z.object({
  title: z.enum(TITLES).catch(DEFAULT_TITLE),
  practiceSessionsDone: z.number().int().nonnegative(),
  practiceClassesDone: z.number().int().nonnegative(),
  welcomedAt: z.date().nullable(),
  avatarMd5: avatarMd5Schema,
})

export type ProfileView = {
  title: CoachTitle
  practiceSessionsDone: number
  practiceClassesDone: number
  welcomedAt: Date | null
  avatarUrl: string
}

export async function readProfile(db: Db): Promise<ProfileView> {
  const [row] = await db
    .select({
      title: profile.title,
      practiceSessionsDone: profile.practiceSessionsDone,
      practiceClassesDone: profile.practiceClassesDone,
      welcomedAt: profile.welcomedAt,
      avatarMd5: avatarMd5Sql,
    })
    .from(profile)
    .where(eq(profile.id, 1))
  const parsed = profileRowSchema.parse(
    row ?? {
      title: DEFAULT_TITLE,
      practiceSessionsDone: 0,
      practiceClassesDone: 0,
      welcomedAt: null,
      avatarMd5: null,
    },
  )
  return {
    title: parsed.title,
    practiceSessionsDone: parsed.practiceSessionsDone,
    practiceClassesDone: parsed.practiceClassesDone,
    welcomedAt: parsed.welcomedAt,
    avatarUrl: avatarUrl(avatarVersion(parsed.avatarMd5)),
  }
}

export { PRACTICE_CLASSES, PRACTICE_SESSIONS, profileChangeSchema, type ProfileChange }

export function practiceClassesFor(change: ProfileChange): { practiceClassesDone?: number } {
  if (change.practiceClassesDone !== undefined || change.title === undefined) return {}
  return TITLES.indexOf(change.title) > 0 ? { practiceClassesDone: PRACTICE_CLASSES } : {}
}

export async function updateProfile(db: Db, change: ProfileChange, now: Date): Promise<void> {
  const { welcomed, ...given } = change

  const fields = { ...given, ...practiceClassesFor(change) }
  await db
    .insert(profile)
    .values({ id: 1, ...fields, updatedAt: now, ...(welcomed ? { welcomedAt: now } : {}) })
    .onConflictDoUpdate({
      target: profile.id,
      set: {
        ...fields,
        updatedAt: now,

        ...(welcomed
          ? { welcomedAt: sql`coalesce(${profile.welcomedAt}, excluded.welcomed_at)` }
          : {}),
      },
    })
}
