import { NextResponse, type NextRequest } from 'next/server'

import { getDb } from '@/lib/db/client'
import { nextQuerySchema, nextResponseSchema } from '@/lib/study/contract'
import { loadDeck } from '@/lib/study/deck'
import { nextView } from '@/lib/study/next'
import { loadStudyState } from '@/lib/study/state'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams
  const query = nextQuerySchema.safeParse({
    mode: params.get('mode') ?? undefined,
    categories: params.get('categories') ?? undefined,
    exclude: params.get('exclude') ?? undefined,
  })
  if (!query.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400, headers: NO_STORE })
  }
  const now = new Date()
  const deck = loadDeck()
  const state = await loadStudyState(await getDb(), deck, now)
  const view = nextView(query.data, state, deck, now)
  if (view === null) {
    return NextResponse.json({ error: 'invalid' }, { status: 400, headers: NO_STORE })
  }

  return NextResponse.json(nextResponseSchema.parse(view), { headers: NO_STORE })
}
