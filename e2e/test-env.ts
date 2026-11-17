import { generateKeyPairSync, randomBytes } from 'node:crypto'

export const TEST_APP_PASSCODE = '7391'
export const TEST_ADMIN_PASSCODE = 'test-admin-passcode-not-real'

function throwawayVapidKeys(): { publicKey: string; privateKey: string } {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = privateKey.export({ format: 'jwk' })
  if (!jwk.x || !jwk.y || !jwk.d) throw new Error('could not make throwaway VAPID keys')
  const point = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x, 'base64url'),
    Buffer.from(jwk.y, 'base64url'),
  ])
  return { publicKey: point.toString('base64url'), privateKey: jwk.d }
}

const vapid = throwawayVapidKeys()

export const TEST_ENV: Record<string, string> = {
  APP_PASSCODE: TEST_APP_PASSCODE,
  ADMIN_PASSCODE: TEST_ADMIN_PASSCODE,
  SESSION_SECRET: 'test-session-secret-not-used-in-production-0123456789',
  DATABASE_URL: 'pglite://memory',
  NODE_ENV: 'production',
  VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
  VAPID_SUBJECT: 'mailto:reminders@coach-study.invalid',
  NUDGE_SECRET: randomBytes(32).toString('base64url'),

  ELEVENLABS_API_KEY: '',

  ANTHROPIC_API_KEY: '',

  APP_TEST_SERVER: '1',
}
