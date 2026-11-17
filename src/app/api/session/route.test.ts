import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { TEST_ADMIN_PASSCODE, TEST_APP_PASSCODE, TEST_ENV } from '../../../../e2e/test-env'

beforeAll(async () => {
  for (const [key, value] of Object.entries(TEST_ENV)) {
    if (key !== 'NODE_ENV') vi.stubEnv(key, value)
  }
  const { getDb } = await import('@/lib/db/client')
  await getDb()
  await import('./route')
}, 60_000)
afterAll(() => {
  vi.unstubAllEnvs()
})

let ipCounter = 0
async function post(body: unknown, extraHeaders: Record<string, string> = {}): Promise<Response> {
  const { POST } = await import('./route')
  ipCounter += 1
  return POST(
    new NextRequest('http://127.0.0.1:3000/api/session', {
      method: 'POST',
      body: JSON.stringify(body),

      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': `10.0.0.${ipCounter}`,
        ...extraHeaders,
      },
    }),
  )
}

describe('POST /api/session', () => {
  it('the app gate refuses the admin passcode', async () => {
    const response = await post({ kind: 'app', passcode: TEST_ADMIN_PASSCODE })
    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('the admin gate refuses the app passcode', async () => {
    const response = await post({ kind: 'admin', passcode: TEST_APP_PASSCODE })
    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('the app passcode opens only the app session', async () => {
    const response = await post({ kind: 'app', passcode: TEST_APP_PASSCODE })
    expect(response.status).toBe(204)
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toMatch(/^cs_app=/)
    expect(cookie).not.toContain('cs_admin=')
    expect(cookie.toLowerCase()).toContain('httponly')
  })

  it('the admin passcode opens only the admin session', async () => {
    const response = await post({ kind: 'admin', passcode: TEST_ADMIN_PASSCODE })
    expect(response.status).toBe(204)
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toMatch(/^cs_admin=/)
    expect(cookie).not.toContain('cs_app=')
  })

  it('marks the cookie Secure over HTTPS, and not on a plain-http test server', async () => {
    const overHttps = await post(
      { kind: 'app', passcode: TEST_APP_PASSCODE },
      { 'x-forwarded-proto': 'https' },
    )
    expect(overHttps.headers.get('set-cookie')).toMatch(/; Secure/i)
    const overHttp = await post({ kind: 'app', passcode: TEST_APP_PASSCODE })
    expect(overHttp.headers.get('set-cookie')).not.toMatch(/; Secure/i)
  })

  it('rejects a malformed body without touching the lockout', async () => {
    const response = await post({ kind: 'owner', passcode: TEST_APP_PASSCODE })
    expect(response.status).toBe(400)
  })
})
