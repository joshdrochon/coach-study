// Web push subscriptions. Only known push services are accepted as endpoints.

import { desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import type { Db } from '../db/client'
import { pushSubscriptions } from '../db/schema'

const PUSH_HOSTS = new Set([
  'web.push.apple.com',
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
])
const PUSH_HOST_SUFFIXES = ['.push.apple.com', '.notify.windows.com']

export function isPushServiceEndpoint(endpoint: string): boolean {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') {
    return false
  }
  const host = url.hostname
  return PUSH_HOSTS.has(host) || PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
}

function base64UrlKey(bytes: number, check: (decoded: Buffer) => boolean = () => true) {
  return z
    .string()
    .max(200)
    .regex(/^[A-Za-z0-9_-]+={0,2}$/)
    .refine(
      (value) => {
        const decoded = Buffer.from(value, 'base64url')
        return decoded.length === bytes && check(decoded)
      },
      `must be ${String(bytes)} bytes, base64url`,
    )
}

export const subscriptionSchema = z.object({
  endpoint: z.string().max(2048).refine(isPushServiceEndpoint, 'not a push service endpoint'),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: base64UrlKey(65, (decoded) => decoded[0] === 4),

    auth: base64UrlKey(16),
  }),
})
export type SubscriptionInput = z.infer<typeof subscriptionSchema>

export const unsubscribeSchema = z.object({ endpoint: z.string().min(1).max(2048) })

export type StoredSubscription = { endpoint: string; p256dh: string; auth: string }

export async function saveSubscription(
  db: Db,
  subscription: SubscriptionInput,
  now: Date,
): Promise<void> {
  const row = {
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
  }
  await db
    .insert(pushSubscriptions)
    .values({ ...row, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { p256dh: row.p256dh, auth: row.auth, updatedAt: now },
    })
}

export async function removeSubscription(db: Db, endpoint: string): Promise<boolean> {
  const removed = await db
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, endpoint))
    .returning({ endpoint: pushSubscriptions.endpoint })
  return removed.length > 0
}

export async function removeSubscriptions(db: Db, endpoints: readonly string[]): Promise<number> {
  if (endpoints.length === 0) return 0
  const removed = await db
    .delete(pushSubscriptions)
    .where(inArray(pushSubscriptions.endpoint, [...endpoints]))
    .returning({ endpoint: pushSubscriptions.endpoint })
  return removed.length
}

export async function listSubscriptions(db: Db): Promise<StoredSubscription[]> {
  return db
    .select({
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .orderBy(desc(pushSubscriptions.updatedAt), pushSubscriptions.endpoint)
}
