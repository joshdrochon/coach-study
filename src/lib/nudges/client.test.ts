import { describe, expect, it } from 'vitest'

import type { ApiResult } from '../dashboard/http'
import { fakeDevice, throwawayPushKeys } from '@/test/web-push'

import {
  base64UrlToBytes,
  checkReminders,
  remindersApi,
  SUBSCRIPTION_URL,
  turnOff,
  turnOn,
  type PushEnv,
  type PushSubscriptionLike,
  type RemindersApi,
} from './client'

const keys = throwawayPushKeys()

function subscription(key = keys.publicKey) {
  const device = fakeDevice()
  let unsubscribed = 0
  const sub: PushSubscriptionLike = {
    endpoint: device.subscription.endpoint,
    toJSON: () => device.subscription,
    unsubscribe: () => {
      unsubscribed += 1
      return Promise.resolve(true)
    },
    options: { applicationServerKey: base64UrlToBytes(key).buffer },
  }
  return { sub, json: device.subscription, unsubscribed: () => unsubscribed }
}

function browser(overrides: Partial<PushEnv> = {}, existing: PushSubscriptionLike | null = null) {
  const calls: string[] = []
  let current = existing
  const env: PushEnv = {
    standalone: true,
    supported: true,
    permission: () => 'default',
    requestPermission: () => {
      calls.push('requestPermission')
      return Promise.resolve('granted')
    },
    current: () => Promise.resolve(current),
    subscribe: (key) => {
      calls.push(`subscribe:${String(key.length)}`)
      current = subscription().sub
      return Promise.resolve(current)
    },
    ...overrides,
  }
  return { env, calls }
}

function server(answer: ApiResult<{ ok: true }> = { ok: true, data: { ok: true } }) {
  const saved: unknown[] = []
  const removed: string[] = []
  const api: RemindersApi = {
    save: (body) => {
      saved.push(body)
      return Promise.resolve(answer)
    },
    remove: (endpoint) => {
      removed.push(endpoint)
      return Promise.resolve(answer)
    },
  }
  return { api, saved, removed }
}

const settled = (state: string) => ({ state, error: null })

describe('what their device can do', () => {
  it('says a Safari tab needs the Home Screen app, and never asks for permission there', async () => {
    const { env, calls } = browser({ standalone: false })
    const fake = server()
    expect(await checkReminders(env, keys.publicKey, fake.api)).toEqual(settled('tab'))
    expect(calls).toEqual([])
    expect(fake.saved).toEqual([])
  })

  it('says when there is no web push at all', async () => {
    const { env } = browser({ supported: false })
    expect(await checkReminders(env, keys.publicKey, server().api)).toEqual(settled('unsupported'))
  })

  it('says when the learner turned notifications off', async () => {
    const { env } = browser({ permission: () => 'denied' })
    expect(await checkReminders(env, keys.publicKey, server().api)).toEqual(settled('denied'))
  })

  it('is off until the learner turns reminders on', async () => {
    expect(await checkReminders(browser().env, keys.publicKey, server().api)).toEqual(
      settled('off'),
    )
    const granted = browser({ permission: () => 'granted' })
    expect(await checkReminders(granted.env, keys.publicKey, server().api)).toEqual(settled('off'))

    const orphan = browser({}, subscription().sub)
    expect(await checkReminders(orphan.env, keys.publicKey, server().api)).toEqual(settled('off'))
  })

  it('is on only once the server has confirmed it holds this device (saved again)', async () => {
    const { sub, json } = subscription()
    const { env } = browser({ permission: () => 'granted' }, sub)
    const fake = server()
    expect(await checkReminders(env, keys.publicKey, fake.api)).toEqual(settled('on'))
    expect(fake.saved).toEqual([json])
  })

  it('is off, with the reason, when the server doesn’t confirm it', async () => {
    const { env } = browser({ permission: () => 'granted' }, subscription().sub)
    for (const error of ['network', 'server', 'unauthorized'] as const) {
      expect(await checkReminders(env, keys.publicKey, server({ ok: false, error }).api)).toEqual({
        state: 'off',
        error,
      })
    }
  })

  it('forgets a subscription made with an old key on both sides, so the learner turns reminders on again', async () => {
    const old = subscription(throwawayPushKeys().publicKey)
    const { env } = browser({ permission: () => 'granted' }, old.sub)
    const fake = server()
    expect(await checkReminders(env, keys.publicKey, fake.api)).toEqual(settled('off'))
    expect(fake.removed).toEqual([old.sub.endpoint])
    expect(old.unsubscribed()).toBe(1)
    expect(fake.saved).toEqual([])
  })

  it('treats a browser that won’t say its subscription as off', async () => {
    const { env } = browser({
      permission: () => 'granted',
      current: () => Promise.reject(new Error('no service worker')),
    })
    expect(await checkReminders(env, keys.publicKey, server().api)).toEqual(settled('off'))
  })

  it('sends nothing more once their tap has taken over, and its answer is ignored', async () => {
    const { env } = browser({ permission: () => 'granted' }, subscription().sub)
    const fake = server()
    expect(await checkReminders(env, keys.publicKey, fake.api, () => false)).toBeNull()
    expect(fake.saved).toEqual([])

    let current = true
    const slow: RemindersApi = {
      save: () => {
        current = false
        return Promise.resolve({ ok: true, data: { ok: true } })
      },
      remove: () => Promise.resolve({ ok: true, data: { ok: true } }),
    }
    expect(await checkReminders(env, keys.publicKey, slow, () => current)).toBeNull()
  })
})

describe('Turn on reminders', () => {
  it('asks first, then subscribes with the server’s key and saves the subscription', async () => {
    const { env, calls } = browser()
    const fake = server()
    expect(await turnOn(env, keys.publicKey, fake.api)).toEqual({ state: 'on', error: null })

    expect(calls).toEqual(['requestPermission', 'subscribe:65'])
    expect(fake.saved).toHaveLength(1)
  })

  it('stops when the learner says no, or closes the question', async () => {
    const denied = browser({ requestPermission: () => Promise.resolve('denied') })
    expect(await turnOn(denied.env, keys.publicKey, server().api)).toEqual({
      state: 'denied',
      error: null,
    })
    const dismissed = browser({ requestPermission: () => Promise.resolve('default') })
    expect(await turnOn(dismissed.env, keys.publicKey, server().api)).toEqual({
      state: 'off',
      error: 'not-allowed',
    })
    expect(denied.calls).toEqual([])
  })

  it('stays off when the browser can’t ask or subscribe', async () => {
    const noAsk = browser({ requestPermission: () => Promise.reject(new Error('no')) })
    expect(await turnOn(noAsk.env, keys.publicKey, server().api)).toEqual({
      state: 'off',
      error: 'failed',
    })
    const noSubscribe = browser({ subscribe: () => Promise.reject(new Error('AbortError')) })
    expect(await turnOn(noSubscribe.env, keys.publicKey, server().api)).toEqual({
      state: 'off',
      error: 'failed',
    })
  })

  it('undoes the subscription when the server didn’t save it', async () => {
    const made = subscription()
    const { env } = browser({ subscribe: () => Promise.resolve(made.sub) })
    expect(await turnOn(env, keys.publicKey, server({ ok: false, error: 'network' }).api)).toEqual({
      state: 'off',
      error: 'network',
    })
    expect(made.unsubscribed()).toBe(1)
  })
})

describe('Turn off reminders', () => {
  it('has the server forget the device, then unsubscribes it', async () => {
    const made = subscription()
    const { env } = browser({ permission: () => 'granted' }, made.sub)
    const fake = server()
    expect(await turnOff(env, fake.api)).toEqual({ state: 'off', error: null })
    expect(fake.removed).toEqual([made.sub.endpoint])
    expect(made.unsubscribed()).toBe(1)
  })

  it('stays on, and says so, when the server couldn’t forget it', async () => {
    const made = subscription()
    const { env } = browser({ permission: () => 'granted' }, made.sub)
    expect(await turnOff(env, server({ ok: false, error: 'server' }).api)).toEqual({
      state: 'on',
      error: 'server',
    })
    expect(made.unsubscribed()).toBe(0)
  })

  it('is already off without a subscription', async () => {
    const fake = server()
    expect(await turnOff(browser().env, fake.api)).toEqual({ state: 'off', error: null })
    expect(fake.removed).toEqual([])
  })

  it('still ends in the right state when the browser can’t unsubscribe', async () => {
    const stuck = (key = keys.publicKey): PushSubscriptionLike => ({
      ...subscription(key).sub,
      unsubscribe: () => Promise.reject(new Error('InvalidStateError')),
    })
    const granted = { permission: (): NotificationPermission => 'granted' }

    expect(await turnOff(browser(granted, stuck()).env, server().api)).toEqual({
      state: 'off',
      error: null,
    })

    const old = stuck(throwawayPushKeys().publicKey)
    expect(await checkReminders(browser(granted, old).env, keys.publicKey, server().api)).toEqual(
      settled('off'),
    )

    const { env } = browser({ subscribe: () => Promise.resolve(stuck()) })
    expect(await turnOn(env, keys.publicKey, server({ ok: false, error: 'server' }).api)).toEqual({
      state: 'off',
      error: 'server',
    })
  })
})

describe('the calls to the server', () => {
  it('saves with POST and forgets with DELETE, checked against the contract', async () => {
    const requests: { url: string; method: string | undefined; body: unknown }[] = []
    const api = remindersApi((url, init) => {
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null
      requests.push({ url, method: init?.method, body })
      return Promise.resolve(Response.json({ ok: true }))
    })
    const { json } = subscription()
    expect(await api.save(json)).toEqual({ ok: true, data: { ok: true } })
    expect(await api.remove(json.endpoint)).toEqual({ ok: true, data: { ok: true } })
    expect(requests).toEqual([
      { url: SUBSCRIPTION_URL, method: 'POST', body: json },
      { url: SUBSCRIPTION_URL, method: 'DELETE', body: { endpoint: json.endpoint } },
    ])
    const signedOut = remindersApi(() => Promise.resolve(new Response(null, { status: 401 })))
    expect(await signedOut.save(json)).toEqual({ ok: false, error: 'unauthorized' })
  })

  it('turns the server’s public key into the bytes PushManager takes', () => {
    const bytes = base64UrlToBytes(keys.publicKey)
    expect(bytes).toHaveLength(65)
    expect(bytes[0]).toBe(4)
    expect(Buffer.from(bytes).toString('base64url')).toBe(keys.publicKey)
  })
})
