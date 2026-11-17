import { describe, expect, it } from 'vitest'

import { envHealth, readServerEnv } from './env'

const BASE = {
  DATABASE_URL: 'pglite://memory',
  APP_PASSCODE: '7391',
  ADMIN_PASSCODE: 'test-admin-passcode-not-real',
  SESSION_SECRET: 'test-session-secret-not-used-in-production-0123456789',
}

describe('an empty tutor key', () => {
  it('reads as absent, and health says there is no tutor key', () => {
    expect(readServerEnv({ ...BASE, ANTHROPIC_API_KEY: '' }).ANTHROPIC_API_KEY).toBeUndefined()
    expect(envHealth({ ...BASE, ANTHROPIC_API_KEY: '' }).tutorKey).toBe(false)
    expect(envHealth({ ...BASE, ANTHROPIC_API_KEY: 'test-anthropic-key-not-real' }).tutorKey).toBe(
      true,
    )
  })

  it('is what the e2e server runs with', async () => {
    const { TEST_ENV } = await import('../../e2e/test-env')
    expect(TEST_ENV.ANTHROPIC_API_KEY).toBe('')
    expect(TEST_ENV.ELEVENLABS_API_KEY).toBe('')
    expect(TEST_ENV.APP_TEST_SERVER).toBe('1')
  })
})
