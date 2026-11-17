import { cached } from '../cache/tab-cache'
import {
  deleteJson,
  getJson,
  postJson,
  type ApiError,
  type ApiResult,
  type Fetch,
} from '../dashboard/http'

import { reminderChangeSchema, reminderKeySchema } from './contract'

export type ReminderState = 'checking' | 'tab' | 'unsupported' | 'denied' | 'off' | 'on'

export type PushSubscriptionLike = {
  endpoint: string
  toJSON(): unknown
  unsubscribe(): Promise<boolean>
  options?: { applicationServerKey?: ArrayBuffer | null } | null
}

export type PushEnv = {
  standalone: boolean

  supported: boolean
  permission(): NotificationPermission
  requestPermission(): Promise<NotificationPermission>

  current(): Promise<PushSubscriptionLike | null>

  subscribe(applicationServerKey: Uint8Array<ArrayBuffer>): Promise<PushSubscriptionLike>
}

export type RemindersApi = {
  save(subscription: unknown): Promise<ApiResult<{ ok: true }>>
  remove(endpoint: string): Promise<ApiResult<{ ok: true }>>
}

export const SUBSCRIPTION_URL = '/api/nudges/subscription'

export function remindersApi(fetchImpl: Fetch = fetch): RemindersApi {
  return {
    save: (subscription) =>
      postJson(SUBSCRIPTION_URL, subscription, reminderChangeSchema, fetchImpl),
    remove: (endpoint) =>
      deleteJson(SUBSCRIPTION_URL, { endpoint }, reminderChangeSchema, fetchImpl),
  }
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function madeWithKey(subscription: PushSubscriptionLike, publicKey: string): boolean {
  const used = subscription.options?.applicationServerKey
  if (!used) return true
  const expected = base64UrlToBytes(publicKey)
  const actual = new Uint8Array(used)
  return actual.length === expected.length && actual.every((byte, i) => byte === expected[i])
}

export type ReminderError = ApiError | 'not-allowed' | 'failed'

export type ReminderChange = { state: ReminderState; error: ReminderError | null }

export async function checkReminders(
  env: PushEnv,
  publicKey: string,
  api: RemindersApi,
  stillCurrent: () => boolean = () => true,
): Promise<ReminderChange | null> {
  const settled = (state: ReminderState): ReminderChange => ({ state, error: null })
  if (!env.standalone) return settled('tab')
  if (!env.supported) return settled('unsupported')
  const permission = env.permission()
  if (permission === 'denied') return settled('denied')
  if (permission !== 'granted') return settled('off')
  const subscription = await env.current().catch(() => null)
  if (!stillCurrent()) return null
  if (!subscription) return settled('off')
  if (!madeWithKey(subscription, publicKey)) {
    await api.remove(subscription.endpoint)
    await subscription.unsubscribe().catch(() => false)
    return stillCurrent() ? settled('off') : null
  }
  const saved = await api.save(subscription.toJSON())
  if (!stillCurrent()) return null
  return saved.ok ? settled('on') : { state: 'off', error: saved.error }
}

export async function turnOn(
  env: PushEnv,
  publicKey: string,
  api: RemindersApi,
): Promise<ReminderChange> {
  let permission: NotificationPermission
  try {
    permission = await env.requestPermission()
  } catch {
    return { state: 'off', error: 'failed' }
  }
  if (permission === 'denied') return { state: 'denied', error: null }
  if (permission !== 'granted') return { state: 'off', error: 'not-allowed' }
  let subscription: PushSubscriptionLike
  try {
    subscription = await env.subscribe(base64UrlToBytes(publicKey))
  } catch {
    return { state: 'off', error: 'failed' }
  }
  const saved = await api.save(subscription.toJSON())
  if (!saved.ok) {
    await subscription.unsubscribe().catch(() => false)
    return { state: 'off', error: saved.error }
  }
  return { state: 'on', error: null }
}

export async function turnOff(env: PushEnv, api: RemindersApi): Promise<ReminderChange> {
  const subscription = await env.current().catch(() => null)
  if (!subscription) return { state: 'off', error: null }
  const removed = await api.remove(subscription.endpoint)
  if (!removed.ok) return { state: 'on', error: removed.error }
  await subscription.unsubscribe().catch(() => false)
  return { state: 'off', error: null }
}

export async function fetchReminderKey(fetchImpl?: Fetch): Promise<ApiResult<string | null>> {
  const result = await getJson('/api/nudges/subscription', reminderKeySchema, fetchImpl)
  return result.ok ? { ok: true, data: result.data.publicKey } : result
}

export const reminderKeyData = cached('reminders', () => fetchReminderKey())
