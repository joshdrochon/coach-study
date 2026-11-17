import { NextResponse, type NextRequest } from 'next/server'

import { getDb } from '@/lib/db/client'
import { syncResponseSchema } from '@/lib/study/contract'
import { loadDeck } from '@/lib/study/deck'
import { syncView } from '@/lib/study/sync'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const have = request.nextUrl.searchParams.get('deck')
  const view = await syncView(await getDb(), loadDeck(), have)

  return NextResponse.json(syncResponseSchema.parse(view), {
    headers: { 'Cache-Control': 'no-store' },
  })
}
