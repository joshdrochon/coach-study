import { NextResponse, type NextRequest } from 'next/server'

import { getDb } from '@/lib/db/client'
import { practiceRequestSchema } from '@/lib/practice/contract'
import { askPracticeTutor, gradePractice } from '@/lib/practice/grade'
import { findScene, METHOD } from '@/lib/practice/method'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const parsed = practiceRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const scene = findScene(METHOD, parsed.data.sceneId)
  if (!scene) return NextResponse.json({ error: 'unknown scene' }, { status: 404 })
  // One mark per move: the screen records when the learner moved on to each one.
  if (parsed.data.marks.length !== scene.moves.length) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 })
  }
  const report = await gradePractice({
    db: await getDb(),
    method: METHOD,
    scene,
    request: parsed.data,
    ask: (req, signal) => askPracticeTutor(req, signal),
  })
  return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } })
}
