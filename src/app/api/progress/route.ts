import { NextResponse } from 'next/server'

import { getDb } from '@/lib/db/client'
import { progressSchema } from '@/lib/progress/client'
import { loadDeck } from '@/lib/study/deck'
import { progressView } from '@/lib/study/progress'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const view = await progressView(await getDb(), loadDeck(), new Date())
  return NextResponse.json(progressSchema.parse(view), {
    headers: { 'Cache-Control': 'no-store' },
  })
}
