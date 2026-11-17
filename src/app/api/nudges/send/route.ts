import { NextResponse, type NextRequest } from 'next/server'

import { bearerMatches } from '@/lib/auth/bearer'
import { getDb } from '@/lib/db/client'
import { readNudgeSecret, readPushKeys } from '@/lib/env'
import { nudgeRunSchema } from '@/lib/nudges/contract'
import { webPushSender } from '@/lib/nudges/push'
import { runNudges } from '@/lib/nudges/run'
import { loadDeck } from '@/lib/study/deck'

export const dynamic = 'force-dynamic'

export const maxDuration = 30

const noStore = { 'Cache-Control': 'no-store' }

export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = readNudgeSecret()
  if (secret === null || !bearerMatches(request.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: noStore })
  }
  const keys = readPushKeys()
  if (keys === null) {
    return NextResponse.json({ error: 'push-not-configured' }, { status: 503, headers: noStore })
  }
  const result = await runNudges(await getDb(), loadDeck, new Date(), webPushSender(keys))
  return NextResponse.json(nudgeRunSchema.parse(result), { headers: noStore })
}
