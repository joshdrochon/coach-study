import { describe, expect, it } from 'vitest'

import { SESSION_TTL_SECONDS, signSession, verifySession } from './session'

const SECRET = 'test-session-secret-not-used-in-production-0123456789'
const NOW = 1_790_000_000

describe('session cookies', () => {
  it('verifies a token it signed, for the same kind', async () => {
    const token = await signSession('app', SECRET, NOW)
    expect(await verifySession(token, 'app', SECRET, NOW + 60)).toBe(true)
  })

  it('rejects the other kind: an app session never opens admin pages', async () => {
    const token = await signSession('app', SECRET, NOW)
    expect(await verifySession(token, 'admin', SECRET, NOW)).toBe(false)
  })

  it('rejects a token signed with another secret', async () => {
    const token = await signSession('admin', 'another-secret-that-is-also-long-enough-0000', NOW)
    expect(await verifySession(token, 'admin', SECRET, NOW)).toBe(false)
  })

  it('rejects a tampered payload', async () => {
    const token = await signSession('app', SECRET, NOW)
    const [, signature] = token.split('.')
    const forged = `${btoa(JSON.stringify({ v: 1, k: 'admin', iat: NOW, exp: NOW + 999 }))}.${signature ?? ''}`
    expect(await verifySession(forged, 'admin', SECRET, NOW)).toBe(false)
  })

  it('expires after its time to live', async () => {
    const token = await signSession('admin', SECRET, NOW)
    expect(await verifySession(token, 'admin', SECRET, NOW + SESSION_TTL_SECONDS.admin - 1)).toBe(
      true,
    )
    expect(await verifySession(token, 'admin', SECRET, NOW + SESSION_TTL_SECONDS.admin)).toBe(false)
  })

  it('rejects missing and malformed tokens', async () => {
    expect(await verifySession(undefined, 'app', SECRET, NOW)).toBe(false)
    expect(await verifySession('garbage', 'app', SECRET, NOW)).toBe(false)
    expect(await verifySession('a.b.c', 'app', SECRET, NOW)).toBe(false)
    expect(await verifySession('!!!.###', 'app', SECRET, NOW)).toBe(false)
  })
})
