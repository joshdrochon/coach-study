import 'server-only'

import webpush from 'web-push'

import type { PushKeys } from '../env'

import type { NudgeMessage } from './copy'
import { isPushServiceEndpoint, type StoredSubscription } from './subscriptions'

export type Delivery = { ok: true } | { ok: false; gone: boolean; status: number | null }

export type PushSender = (
  target: StoredSubscription,
  message: NudgeMessage,
  ttlSeconds: number,
) => Promise<Delivery>

export type PushFetch = (input: string, init: RequestInit) => Promise<Response>

const SEND_TIMEOUT_MS = 10_000

const TOPIC = 'reminder'

const GONE = new Set([404, 410])

export function webPushSender(keys: PushKeys, fetchImpl: PushFetch = fetch): PushSender {
  return async (target, message, ttlSeconds) => {
    if (!isPushServiceEndpoint(target.endpoint)) return { ok: false, gone: true, status: null }
    let details: ReturnType<typeof webpush.generateRequestDetails>
    try {
      details = webpush.generateRequestDetails(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(message),
        {
          vapidDetails: {
            subject: keys.subject,
            publicKey: keys.publicKey,
            privateKey: keys.privateKey,
          },
          TTL: ttlSeconds,
          urgency: 'normal',
          topic: TOPIC,
        },
      )
    } catch (error) {
      console.error('nudges: reminder not encrypted', error instanceof Error ? error.message : '')
      return { ok: false, gone: false, status: null }
    }

    const raw: Record<string, unknown> = details.headers
    const headers: Record<string, string> = {}
    for (const [name, value] of Object.entries(raw)) {
      if (name.toLowerCase() === 'content-length') continue
      if (typeof value === 'string' || typeof value === 'number') headers[name] = String(value)
    }
    try {
      const response = await fetchImpl(details.endpoint, {
        method: details.method,
        headers,
        body: details.body === null ? null : new Uint8Array(details.body),
        redirect: 'error',
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      })
      if (response.ok) return { ok: true }
      return { ok: false, gone: GONE.has(response.status), status: response.status }
    } catch {
      return { ok: false, gone: false, status: null }
    }
  }
}
