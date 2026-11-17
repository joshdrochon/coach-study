import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'

import { checkLock, clearDevice, recordFailure } from '@/lib/auth/lockout'
import { clientIp, passcodeMatches } from '@/lib/auth/passcode'
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { readServerEnv } from '@/lib/env'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  kind: z.enum(['app', 'admin']),
  passcode: z.string().min(1).max(200),
})

export type SessionError =
  | { error: 'invalid' }
  | { error: 'wrong'; triesLeft: number }
  | { error: 'locked'; retryAfterSeconds: number }

const noStore = { 'Cache-Control': 'no-store' }

export async function POST(request: NextRequest): Promise<NextResponse> {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json<SessionError>({ error: 'invalid' }, { status: 400, headers: noStore })
  }
  const { kind, passcode } = parsed.data
  const env = readServerEnv()
  const db = await getDb()
  const ip = clientIp(request.headers)
  const now = new Date()

  const lock = await checkLock(db, kind, ip, now)
  if (lock.locked) {
    const retryAfterSeconds = Math.ceil((lock.until.getTime() - now.getTime()) / 1000)
    return NextResponse.json<SessionError>(
      { error: 'locked', retryAfterSeconds },
      { status: 429, headers: { ...noStore, 'Retry-After': String(retryAfterSeconds) } },
    )
  }

  const expected = kind === 'app' ? env.APP_PASSCODE : env.ADMIN_PASSCODE
  if (!passcodeMatches(passcode, expected)) {
    const { deviceTriesLeft } = await recordFailure(db, kind, ip, now)
    return NextResponse.json<SessionError>(
      { error: 'wrong', triesLeft: deviceTriesLeft },
      { status: 401, headers: noStore },
    )
  }

  await clearDevice(db, kind, ip)
  const response = new NextResponse(null, { status: 204, headers: noStore })
  response.cookies.set(SESSION_COOKIE[kind], await signSession(kind, env.SESSION_SECRET), {
    httpOnly: true,

    secure:
      request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS[kind],
  })
  return response
}
