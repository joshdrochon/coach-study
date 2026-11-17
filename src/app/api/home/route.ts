import { NextResponse, type NextRequest } from 'next/server'

import { getDb } from '@/lib/db/client'
import { TIME_ZONE } from '@/lib/scheduler/calendar'
import { homeViewSchema } from '@/lib/study/contract'
import { loadDeck } from '@/lib/study/deck'
import { canonicalTimeZone, homeView } from '@/lib/study/home'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const tz = request.nextUrl.searchParams.get('tz')
  const timeZone = (tz === null ? null : canonicalTimeZone(tz)) ?? TIME_ZONE
  const view = await homeView(await getDb(), loadDeck(), new Date(), timeZone)
  return NextResponse.json(homeViewSchema.parse(view), {
    headers: { 'Cache-Control': 'no-store' },
  })
}
