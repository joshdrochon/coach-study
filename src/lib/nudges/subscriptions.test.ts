import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { fakeDevice } from '@/test/web-push'

import { openTestDb, type Db } from '../db/client'
import { pushSubscriptions } from '../db/schema'

import {
  isPushServiceEndpoint,
  listSubscriptions,
  removeSubscription,
  removeSubscriptions,
  saveSubscription,
  subscriptionSchema,
} from './subscriptions'

const T0 = new Date('2026-08-17T16:00:00Z')

describe('which subscriptions are accepted', () => {
  it('takes a browser’s PushSubscription from a known push service', () => {
    const { subscription } = fakeDevice()
    expect(subscriptionSchema.safeParse(subscription).success).toBe(true)
    expect(subscriptionSchema.safeParse({ ...subscription, expirationTime: null }).success).toBe(
      true,
    )
    for (const endpoint of [
      'https://web.push.apple.com/QGuQyavXutnMH6pV',
      'https://fcm.googleapis.com/fcm/send/abc:def',
      'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
      'https://wns2-by3p.notify.windows.com/w/?token=BQYAAAB',
    ]) {
      expect(isPushServiceEndpoint(endpoint), endpoint).toBe(true)
    }
  })

  it('refuses anything that would make the server post somewhere else', () => {
    for (const endpoint of [
      'http://web.push.apple.com/abc',
      'https://web.push.apple.com.example.com/abc',
      'https://example.com/web.push.apple.com',
      'https://user:pass@web.push.apple.com/abc',
      'https://web.push.apple.com:8443/abc',
      'https://169.254.169.254/latest/meta-data',
      'https://localhost/push',
      'not a url',
    ]) {
      expect(isPushServiceEndpoint(endpoint), endpoint).toBe(false)
    }
  })

  it('refuses keys of the wrong size or shape', () => {
    const { subscription } = fakeDevice()
    const withKeys = (keys: Partial<typeof subscription.keys>) =>
      subscriptionSchema.safeParse({ ...subscription, keys: { ...subscription.keys, ...keys } })
        .success
    expect(withKeys({ p256dh: subscription.keys.p256dh.slice(0, 40) })).toBe(false)

    expect(withKeys({ p256dh: Buffer.alloc(65, 7).toString('base64url') })).toBe(false)
    expect(withKeys({ auth: Buffer.alloc(8).toString('base64url') })).toBe(false)
    expect(withKeys({ auth: 'not base64!' })).toBe(false)
    expect(subscriptionSchema.safeParse({ endpoint: subscription.endpoint }).success).toBe(false)
  })
})

describe('their devices with reminders on', () => {
  let db: Db
  beforeAll(async () => {
    db = await openTestDb()
  })
  beforeEach(async () => {
    await db.delete(pushSubscriptions)
  })

  it('saves a device once and refreshes its keys when the browser renews them', async () => {
    const device = fakeDevice()
    await saveSubscription(db, device.subscription, T0)
    const renewed = { ...fakeDevice().subscription, endpoint: device.subscription.endpoint }
    await saveSubscription(db, renewed, new Date(T0.getTime() + 1000))
    expect(await listSubscriptions(db)).toEqual([
      {
        endpoint: device.subscription.endpoint,
        p256dh: renewed.keys.p256dh,
        auth: renewed.keys.auth,
      },
    ])
  })

  it('lists the most recently refreshed device first', async () => {
    const older = fakeDevice()
    const newer = fakeDevice()
    await saveSubscription(db, older.subscription, T0)
    await saveSubscription(db, newer.subscription, new Date(T0.getTime() + 1000))
    expect((await listSubscriptions(db)).map((s) => s.endpoint)).toEqual([
      newer.subscription.endpoint,
      older.subscription.endpoint,
    ])
  })

  it('turns reminders off for one device, and deletes devices that are gone', async () => {
    const [a, b, c] = [fakeDevice(), fakeDevice(), fakeDevice()]
    for (const device of [a, b, c]) await saveSubscription(db, device.subscription, T0)
    expect(await removeSubscription(db, a.subscription.endpoint)).toBe(true)
    expect(await removeSubscription(db, a.subscription.endpoint)).toBe(false)
    expect(await removeSubscriptions(db, [])).toBe(0)
    expect(
      await removeSubscriptions(db, [b.subscription.endpoint, 'https://web.push.apple.com/none']),
    ).toBe(1)
    expect((await listSubscriptions(db)).map((s) => s.endpoint)).toEqual([c.subscription.endpoint])
  })
})
