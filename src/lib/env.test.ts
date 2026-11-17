import { describe, expect, it } from 'vitest'

import { throwawayPushKeys } from '@/test/web-push'

import { envHealth, OPTIONAL_SETTINGS, readNudgeSecret, readPushKeys, readServerEnv } from './env'

const valid = {
  DATABASE_URL: 'pglite://memory',
  APP_PASSCODE: '7391',
  ADMIN_PASSCODE: 'test-admin-passcode-not-real',
  SESSION_SECRET: 'x'.repeat(40),
}

describe('readServerEnv', () => {
  it('accepts a complete environment', () => {
    expect(readServerEnv(valid).APP_PASSCODE).toBe('7391')
  })

  it('rejects a passcode that is not exactly 4 digits', () => {
    expect(() => readServerEnv({ ...valid, APP_PASSCODE: '12345' })).toThrow(/4 digits/)
    expect(() => readServerEnv({ ...valid, APP_PASSCODE: '[SENSITIVE]' })).toThrow(/4 digits/)
  })

  it('rejects a short admin passcode', () => {
    expect(() => readServerEnv({ ...valid, ADMIN_PASSCODE: 'short' })).toThrow(/16/)
  })
})

describe('envHealth', () => {
  it('reports each setting as present without exposing values', () => {
    const health = envHealth(valid)
    expect(health).toEqual({
      database: true,
      passcode: true,
      adminPasscode: true,
      sessionSecret: true,
      tutorKey: false,
      pushKeys: false,
      nudgeSecret: false,
    })
    expect(JSON.stringify(health)).not.toContain('7391')
  })

  it('treats the Vercel placeholder as not configured', () => {
    expect(envHealth({ ...valid, APP_PASSCODE: '[SENSITIVE]' }).passcode).toBe(false)
  })

  it('reports the reminder settings as true or false, never their values', () => {
    const keys = throwawayPushKeys()
    const secret = 'n'.repeat(40)
    const health = envHealth({
      ...valid,
      VAPID_PUBLIC_KEY: keys.publicKey,
      VAPID_PRIVATE_KEY: keys.privateKey,
      VAPID_SUBJECT: keys.subject,
      NUDGE_SECRET: secret,
    })
    expect(health).toMatchObject({ pushKeys: true, nudgeSecret: true })
    expect(JSON.stringify(health)).not.toContain(keys.privateKey)
    expect(JSON.stringify(health)).not.toContain(secret)
  })

  it('keeps the app healthy without the tutor key or the reminder settings', () => {
    expect([...OPTIONAL_SETTINGS].sort()).toEqual(['nudgeSecret', 'pushKeys', 'tutorKey'])
  })
})

describe('reminder settings (optional)', () => {
  const keys = throwawayPushKeys()
  const push = {
    VAPID_PUBLIC_KEY: keys.publicKey,
    VAPID_PRIVATE_KEY: keys.privateKey,
    VAPID_SUBJECT: keys.subject,
  }

  it('reads the three VAPID settings together', () => {
    expect(readPushKeys(push)).toEqual(keys)
    expect(readPushKeys({ ...push, VAPID_SUBJECT: 'https://coach-study.example' })?.subject).toBe(
      'https://coach-study.example',
    )
  })

  it('ignores whitespace around a pasted value', () => {
    expect(
      readPushKeys({
        VAPID_PUBLIC_KEY: `${keys.publicKey}\n`,
        VAPID_PRIVATE_KEY: ` ${keys.privateKey} `,
        VAPID_SUBJECT: `${keys.subject}\n`,
      }),
    ).toEqual(keys)
    expect(readNudgeSecret({ NUDGE_SECRET: `${'s'.repeat(40)}\n` })).toBe('s'.repeat(40))
  })

  it('treats a missing, short, placeholder or swapped value as reminders off', () => {
    expect(readPushKeys({})).toBeNull()
    expect(readPushKeys({ ...push, VAPID_PRIVATE_KEY: undefined })).toBeNull()
    expect(readPushKeys({ ...push, VAPID_PUBLIC_KEY: '[SENSITIVE]' })).toBeNull()
    expect(readPushKeys({ ...push, VAPID_SUBJECT: 'coach@example.com' })).toBeNull()
    expect(readPushKeys({ ...push, VAPID_SUBJECT: 'http://example.com' })).toBeNull()

    expect(
      readPushKeys({
        ...push,
        VAPID_PUBLIC_KEY: keys.privateKey,
        VAPID_PRIVATE_KEY: keys.publicKey,
      }),
    ).toBeNull()
    expect(readNudgeSecret({})).toBeNull()
    expect(readNudgeSecret({ NUDGE_SECRET: 'short' })).toBeNull()
    expect(readNudgeSecret({ NUDGE_SECRET: '[SENSITIVE]' })).toBeNull()
  })
})
