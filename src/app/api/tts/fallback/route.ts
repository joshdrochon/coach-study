import { NextResponse, type NextRequest } from 'next/server'

import { getDb } from '@/lib/db/client'
import { keepFallback } from '@/lib/tts/clips'
import { elevenLabsKey } from '@/lib/tts/elevenlabs'
import { fallbackReportSchema } from '@/lib/tts/fallback'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!elevenLabsKey()) return new NextResponse(null, { status: 204, headers: NO_STORE })
  const parsed = fallbackReportSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400, headers: NO_STORE })
  }
  if (!(await keepFallback(await getDb(), parsed.data, new Date()))) {
    return NextResponse.json({ error: 'rate-limited' }, { status: 429, headers: NO_STORE })
  }
  return new NextResponse(null, { status: 204, headers: NO_STORE })
}
