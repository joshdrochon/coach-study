import { z } from 'zod'

import { cached } from '../cache/tab-cache'
import { getJson, postJson, type ApiResult, type Fetch } from '../dashboard/http'

import { AVATAR_MAX_BASE64 } from './avatar'
import { localCopy, PROGRESS_KEY, rememberProfile } from './localCopy'
import { profileChangeSchema, type ProfileChange } from '../study/profile-change'

import { TITLES } from './titles'

const ratio = z.number().min(0).max(1)
const count = z.number().int().nonnegative()

export const progressSchema = z.object({
  name: z.literal('Coach Alex'),

  title: z.enum(TITLES),
  avatarUrl: z.string().min(1),

  practiceSessions: z.object({ done: count, of: z.literal(3) }),
  practiceClasses: z.object({ done: count, of: z.literal(10) }),

  readiness: z.array(z.object({ category: z.string().min(1), ready: ratio })),
  isDayOne: z.boolean(),

  practices: z
    .array(
      z
        .object({
          label: z.string().min(1),

          passed: count,
          of: count,

          missed: z.array(z.string().min(1)),
        })
        .refine((p) => p.passed <= p.of),
    )
    .optional()
    .catch(undefined),

  rightOnCards: count.optional().catch(undefined),
})
export type ProgressData = z.infer<typeof progressSchema>
export type Practice = NonNullable<ProgressData['practices']>[number]

export function missedLine(missed: readonly string[]): string {
  if (missed.length === 0) return 'Every must-do passed.'
  if (missed.length <= 3) return `Missed: ${missed.join(', ')}`
  return `Missed: ${missed.slice(0, 2).join(', ')} and ${String(missed.length - 2)} more`
}

export function rightOnCardsLine(cards: number | undefined): string | null {
  if (cards === undefined || cards < 1) return null
  return `You were right on ${String(cards)} ${cards === 1 ? 'card' : 'cards'} you said looked wrong.`
}

const savedSchema = z.object({ ok: z.literal(true) })

function isValidChange(change: ProfileChange): boolean {
  if (!profileChangeSchema.safeParse(change).success) return false
  return (change.avatarJpegBase64?.length ?? 0) <= AVATAR_MAX_BASE64
}

export const progressCopy = localCopy(PROGRESS_KEY, progressSchema)

export async function fetchProgress(fetchImpl?: Fetch): Promise<ApiResult<ProgressData>> {
  const result = await getJson('/api/progress', progressSchema, fetchImpl)
  if (result.ok) {
    progressCopy.write(result.data)
    rememberProfile(result.data)
  }
  return result
}

export const progressData = cached('progress', () => fetchProgress())

const welcomedSchema = z.object({ welcomed: z.boolean() })

export async function fetchWelcomed(fetchImpl?: Fetch): Promise<boolean> {
  const result = await getJson('/api/profile', welcomedSchema, fetchImpl)
  return result.ok && result.data.welcomed
}

export function afterFirstRun(welcomed: boolean): '/' | '/welcome' {
  return welcomed ? '/' : '/welcome'
}

export const WELCOMED_WAIT_MS = 2_500

export function welcomedWithin(asked: Promise<boolean> | null, ms: number): Promise<boolean> {
  if (!asked) return Promise.resolve(false)
  return Promise.race([
    asked,
    new Promise<boolean>((resolve) => {
      setTimeout(() => {
        resolve(false)
      }, ms)
    }),
  ])
}

export async function afterPasscode(next: string, fetchImpl?: Fetch): Promise<string> {
  if (next !== '/first-run') return next
  const seen = await welcomedWithin(fetchWelcomed(fetchImpl), WELCOMED_WAIT_MS)
  return seen ? '/' : next
}

export async function saveProfile(
  change: ProfileChange,
  fetchImpl?: Fetch,
): Promise<ApiResult<true>> {
  if (!isValidChange(change)) return { ok: false, error: 'invalid' }
  const result = await postJson('/api/profile', change, savedSchema, fetchImpl)
  if (!result.ok) return result

  if (change.title !== undefined) {
    rememberProfile({ title: change.title })
    const last = progressCopy.read()
    if (last) {
      const classes = TITLES.indexOf(change.title) > 0 ? { done: 10, of: 10 as const } : null
      progressCopy.write({
        ...last,
        title: change.title,
        ...(classes ? { practiceClasses: classes } : {}),
      })
    }
  }
  return { ok: true, data: true }
}
