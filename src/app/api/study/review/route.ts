import { NextResponse, type NextRequest } from 'next/server'

import { getDb } from '@/lib/db/client'
import { reviewEventSchema } from '@/lib/study/contract'
import { refuseStaleEpoch } from '@/lib/study/epoch-server'
import { loadDeck } from '@/lib/study/deck'
import { applyWaitingCorrections } from '@/lib/study/flag'
import { recordReview } from '@/lib/study/state'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(request: NextRequest): Promise<NextResponse> {
  const db = await getDb()
  const stale = await refuseStaleEpoch(db, request.headers)
  if (stale) return stale
  const event = reviewEventSchema.safeParse(await request.json().catch(() => null))
  if (!event.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400, headers: NO_STORE })
  }
  const outcome = await recordReview(db, loadDeck(), event.data, new Date())
  if (outcome === 'stored') {
    await applyWaitingCorrections(db, event.data).catch((error: unknown) => {
      console.error(
        'card re-grade correction failed',
        error instanceof Error ? error.name : 'error',
      )
    })
  }
  switch (outcome) {
    case 'unknown-item':
      return NextResponse.json({ error: 'unknown-item' }, { status: 404, headers: NO_STORE })
    case 'duplicate':
      return NextResponse.json({ error: 'duplicate' }, { status: 409, headers: NO_STORE })
    case 'stored':
      return NextResponse.json({ ok: true }, { headers: NO_STORE })
  }
}
