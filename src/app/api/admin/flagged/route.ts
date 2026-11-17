import { NextResponse, type NextRequest } from 'next/server'

import { getDb } from '@/lib/db/client'
import { flaggedView, reviewDraftCase, reviewRequestSchema } from '@/lib/study/flag-cases'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(await flaggedView(await getDb()), {
    headers: { 'Cache-Control': 'no-store' },
  })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const parsed = reviewRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const outcome = await reviewDraftCase(await getDb(), parsed.data)
  return NextResponse.json(outcome.body, {
    status: outcome.status,
    headers: { 'Cache-Control': 'no-store' },
  })
}
