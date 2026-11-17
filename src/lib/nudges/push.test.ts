import { describe, expect, it } from 'vitest'

import { fakeDevice, fakePushService, throwawayPushKeys } from '@/test/web-push'

import { nudgeMessage, type NudgeMessage } from './copy'
import { webPushSender } from './push'

const keys = throwawayPushKeys()
const message: NudgeMessage = nudgeMessage({
  daysToPracticeDay: 2,
  daysToFirstClass: 19,
  cardsLeft: 49,
  reason: 'not-studied',
})

function stored(device = fakeDevice()) {
  const { endpoint, keys: deviceKeys } = device.subscription
  return { endpoint, p256dh: deviceKeys.p256dh, auth: deviceKeys.auth }
}

describe('web push to their device', () => {
  it('sends a web push the device can decrypt: VAPID-signed, aes128gcm, straight to its push service', async () => {
    const device = fakeDevice()
    const service = fakePushService()
    const send = webPushSender(keys, service.fetch)
    expect(await send(stored(device), message, 3600)).toEqual({ ok: true })

    expect(service.received).toHaveLength(1)
    const [push] = service.received
    if (!push) throw new Error('no push sent')
    expect(push.endpoint).toBe(device.subscription.endpoint)
    expect(push.method).toBe('POST')
    expect(push.redirect).toBe('error')
    expect(push.headers['content-encoding']).toBe('aes128gcm')
    expect(push.headers.ttl).toBe('3600')
    expect(push.headers.urgency).toBe('normal')
    expect(push.headers.topic).toBe('reminder')

    expect(push.headers.authorization).toMatch(
      new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${keys.publicKey}$`),
    )
    const token = push.headers.authorization?.split(/[ ,=]/)[2] ?? ''
    const claims: unknown = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    )
    expect(claims).toMatchObject({ aud: 'https://web.push.apple.com', sub: keys.subject })

    expect(JSON.parse(device.decrypt(push.body))).toEqual(message)
  })

  it('reports a device the push service says is gone (404, 410), so it can be deleted', async () => {
    for (const status of [404, 410]) {
      const send = webPushSender(keys, fakePushService(() => status).fetch)
      expect(await send(stored(), message, 60)).toEqual({ ok: false, gone: true, status })
    }
  })

  it('keeps a device after a failure that may pass (rate limit, server error, no answer)', async () => {
    for (const status of [400, 403, 429, 500, 503]) {
      const send = webPushSender(keys, fakePushService(() => status).fetch)
      expect(await send(stored(), message, 60)).toEqual({ ok: false, gone: false, status })
    }
    const offline = webPushSender(keys, () => Promise.reject(new TypeError('fetch failed')))
    expect(await offline(stored(), message, 60)).toEqual({ ok: false, gone: false, status: null })
  })

  it('never posts anywhere but a push service', async () => {
    const service = fakePushService()
    const send = webPushSender(keys, service.fetch)
    const elsewhere = stored(fakeDevice('https://example.com/collect'))
    expect(await send(elsewhere, message, 60)).toEqual({ ok: false, gone: true, status: null })
    const internal = stored(fakeDevice('http://169.254.169.254/latest'))
    expect(await send(internal, message, 60)).toEqual({ ok: false, gone: true, status: null })
    expect(service.received).toHaveLength(0)
  })

  it('keeps the device when a reminder can’t be encrypted for it', async () => {
    const service = fakePushService()
    const send = webPushSender(keys, service.fetch)
    const broken = { ...stored(), p256dh: 'not-a-key' }
    expect(await send(broken, message, 60)).toEqual({ ok: false, gone: false, status: null })
    expect(service.received).toHaveLength(0)
  })
})
