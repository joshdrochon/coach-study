import { NextResponse } from 'next/server'

import { learningSchema } from '@/lib/dashboard/client'
import { getDb } from '@/lib/db/client'
import { loadDeck } from '@/lib/study/deck'
import { learningView } from '@/lib/study/learning'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const view = await learningView(await getDb(), loadDeck(), new Date())
  return NextResponse.json(learningSchema.parse(view), {
    headers: { 'Cache-Control': 'no-store' },
  })
}
