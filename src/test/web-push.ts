import { createDecipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto'

import webpush from 'web-push'

import type { PushKeys } from '@/lib/env'

export function throwawayPushKeys(): PushKeys {
  const keys = webpush.generateVAPIDKeys()
  return {
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    subject: 'mailto:reminders@coach-study.invalid',
  }
}

export type FakeDevice = {
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } }

  decrypt(body: Uint8Array): string
}

let devices = 0

export function fakeDevice(
  endpoint = `https://web.push.apple.com/test-device-${String((devices += 1))}`,
): FakeDevice {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  const devicePublic = ecdh.getPublicKey()
  const auth = randomBytes(16)
  return {
    subscription: {
      endpoint,
      keys: { p256dh: devicePublic.toString('base64url'), auth: auth.toString('base64url') },
    },
    decrypt(body) {
      const data = Buffer.from(body)

      const salt = data.subarray(0, 16)
      const idLength = data.readUInt8(20)
      const serverPublic = data.subarray(21, 21 + idLength)
      const encrypted = data.subarray(21 + idLength)
      const shared = ecdh.computeSecret(serverPublic)
      const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), devicePublic, serverPublic])
      const ikm = Buffer.from(hkdfSync('sha256', shared, auth, keyInfo, 32))
      const key = Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: aes128gcm\0', 16))
      const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: nonce\0', 12))
      const decipher = createDecipheriv('aes-128-gcm', key, nonce)
      decipher.setAuthTag(encrypted.subarray(encrypted.length - 16))
      const padded = Buffer.concat([
        decipher.update(encrypted.subarray(0, encrypted.length - 16)),
        decipher.final(),
      ])

      const end = padded.lastIndexOf(2)
      return padded.subarray(0, end).toString('utf8')
    },
  }
}

export type CapturedPush = {
  endpoint: string
  method: string
  headers: Record<string, string>
  body: Uint8Array
  redirect: RequestRedirect | undefined
}

export function fakePushService(status: (endpoint: string) => number = () => 201) {
  const received: CapturedPush[] = []
  const fetchImpl = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const endpoint =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const headers = new Headers(init?.headers)
    const body = init?.body
    received.push({
      endpoint,
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(headers.entries()),
      body: body instanceof Uint8Array ? body : new Uint8Array(),
      redirect: init?.redirect,
    })
    return Promise.resolve(new Response(null, { status: status(endpoint) }))
  }
  return { received, fetch: fetchImpl }
}
