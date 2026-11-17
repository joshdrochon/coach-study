import { randomUUID } from 'node:crypto'

import { NextResponse, type NextRequest } from 'next/server'

import { loadBank } from '@/lib/content/bank'
import { getDb } from '@/lib/db/client'
import { askCard, cardRequestSchema, gradeCard } from '@/lib/tutor/card'
import { errorBody, STATUS, TutorError } from '@/lib/tutor/errors'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const parsed = cardRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const item = loadBank().byId.get(parsed.data.itemId)
  if (!item) return NextResponse.json({ error: 'unknown card' }, { status: 404 })

  const traceId = randomUUID()
  const correlationId = request.headers.get('x-correlation-id')?.trim().slice(0, 128)
  try {
    const grade = await gradeCard(
      await getDb(),
      item,
      parsed.data,
      traceId,
      (req, signal) => askCard(req, signal),
      correlationId,
    )
    return NextResponse.json(grade, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof TutorError) {
      return NextResponse.json(errorBody(error.kind), { status: STATUS[error.kind] })
    }
    throw error
  }
}
