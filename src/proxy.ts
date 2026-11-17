// Auth gate for every route: public paths pass, admin paths need the admin session,
// everything else the learner session. API routes answer 401 instead of redirecting.

import { NextResponse, type NextRequest } from 'next/server'

import { SESSION_COOKIE, verifySession, type SessionKind } from '@/lib/auth/session'

const PUBLIC_PATHS = new Set([
  '/add-to-home',
  '/passcode',
  '/admin/passcode',
  '/api/session',
  '/api/health',

  '/manifest.webmanifest',
  '/icon1.png',
  '/icon2.svg',
  '/apple-icon.png',
  '/app-icon-192.png',
  '/app-icon-512.png',

  '/sw.js',

  '/api/nudges/send',
])

function sessionsFor(pathname: string): SessionKind[] | null {
  if (PUBLIC_PATHS.has(pathname)) return null
  // Web fonts load on the passcode screens too.
  if (pathname.startsWith('/fonts/')) return null
  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) return ['admin']
  if (pathname.startsWith('/sounds/')) return ['app', 'admin']
  return ['app']
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl
  const kinds = sessionsFor(pathname)
  if (kinds === null) return NextResponse.next()

  const secret = process.env.SESSION_SECRET
  if (secret) {
    for (const each of kinds) {
      const token = request.cookies.get(SESSION_COOKIE[each])?.value
      if (await verifySession(token, each, secret)) return NextResponse.next()
    }
  }
  const kind = kinds[0] ?? 'app'

  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  if (kind === 'app' && pathname === '/') {
    return NextResponse.redirect(new URL('/add-to-home', request.url))
  }
  const login = new URL(kind === 'admin' ? '/admin/passcode' : '/passcode', request.url)
  login.searchParams.set('next', `${pathname}${search}`)
  return NextResponse.redirect(login)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
