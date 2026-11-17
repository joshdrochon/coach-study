import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { signSession } from '@/lib/auth/session'

import { proxy } from './proxy'

const SECRET = 'test-session-secret-not-used-in-production-0123456789'

beforeAll(() => {
  vi.stubEnv('SESSION_SECRET', SECRET)
})
afterAll(() => {
  vi.unstubAllEnvs()
})

function target(response: Response): string | null {
  const location = response.headers.get('location')
  if (location === null) return null
  const url = new URL(location)
  return `${url.pathname}${url.search}`
}

async function visit(path: string, cookie?: string) {
  const request = new NextRequest(`http://127.0.0.1:3000${path}`, {
    headers: cookie ? { cookie } : {},
  })
  return proxy(request)
}

describe('proxy (the passcode gate)', () => {
  it('lets the web fonts load before anyone signs in', async () => {
    const response = await visit('/fonts/switzer/Switzer-Regular.woff2')
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })

  it('starts a stranger at step 1 of the first run when they open the app', async () => {
    const response = await visit('/')
    expect(response.status).toBe(307)
    expect(target(response)).toBe('/add-to-home')
  })

  it('sends a deep link to the passcode and back', async () => {
    const response = await visit('/voice-test')
    expect(target(response)).toBe('/passcode?next=%2Fvoice-test')
  })

  it('keeps the voice lab (a test page nothing links to) behind their passcode, not the admin one', async () => {
    expect(target(await visit('/voice-lab'))).toBe('/passcode?next=%2Fvoice-lab')
    const admin = `cs_admin=${await signSession('admin', SECRET)}`
    expect(target(await visit('/voice-lab', admin))).toBe('/passcode?next=%2Fvoice-lab')
    const app = `cs_app=${await signSession('app', SECRET)}`
    expect((await visit('/voice-lab', app)).headers.get('x-middleware-next')).toBe('1')
  })

  it('leaves the first-run step 1, the passcode and the health check public', async () => {
    for (const path of ['/add-to-home', '/passcode', '/api/health']) {
      expect((await visit(path)).headers.get('x-middleware-next')).toBe('1')
    }
  })

  it('answers an API call without a session with 401 JSON', async () => {
    const response = await visit('/api/study/next?mode=start')
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'unauthorized' })
  })

  it('lets the reminders service worker and the hourly job’s route through, and nothing near them', async () => {
    for (const path of ['/sw.js', '/api/nudges/send']) {
      expect((await visit(path)).headers.get('x-middleware-next')).toBe('1')
    }

    for (const path of ['/api/nudges/subscription', '/api/nudges/send/x', '/api/nudges']) {
      expect((await visit(path)).status).toBe(401)
    }
    expect(target(await visit('/sw.js.map'))).toBe('/passcode?next=%2Fsw.js.map')
  })

  it('needs the admin session for admin pages, and the app session never opens them', async () => {
    const app = `cs_app=${await signSession('app', SECRET)}`
    expect((await visit('/', app)).headers.get('x-middleware-next')).toBe('1')
    const admin = await visit('/admin/system', app)
    expect(target(admin)).toBe('/admin/passcode?next=%2Fadmin%2Fsystem')
    const adminCookie = `cs_admin=${await signSession('admin', SECRET)}`
    expect((await visit('/admin/system', adminCookie)).headers.get('x-middleware-next')).toBe('1')
  })

  it('opens a sound file with their session or the admin session, and refuses a stranger like any file', async () => {
    const file = '/sounds/listen-on.0123abcd.mp3'

    const stranger = await visit(file)
    expect(stranger.status).toBe(307)
    expect(target(stranger)).toBe('/passcode?next=%2Fsounds%2Flisten-on.0123abcd.mp3')
    const app = `cs_app=${await signSession('app', SECRET)}`
    expect((await visit(file, app)).headers.get('x-middleware-next')).toBe('1')

    const admin = `cs_admin=${await signSession('admin', SECRET)}`
    expect((await visit(file, admin)).headers.get('x-middleware-next')).toBe('1')

    expect(target(await visit(file, 'cs_admin=forged'))).toBe(
      '/passcode?next=%2Fsounds%2Flisten-on.0123abcd.mp3',
    )
  })

  it('opens only sound files with the admin session, never their pages or their API', async () => {
    const admin = `cs_admin=${await signSession('admin', SECRET)}`
    expect(target(await visit('/study', admin))).toBe('/passcode?next=%2Fstudy')
    expect((await visit('/api/progress', admin)).status).toBe(401)

    expect(target(await visit('/sounds', admin))).toBe('/passcode?next=%2Fsounds')
    expect(target(await visit('/soundsx/a.mp3', admin))).toBe('/passcode?next=%2Fsoundsx%2Fa.mp3')
  })
})
