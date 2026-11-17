import { NextResponse, type NextRequest } from 'next/server'

import { loadVoiceTestSentences } from '@/lib/content/voice-test'
import { listVoiceTestRuns, overall } from '@/lib/dashboard/voice-test'
import { getDb } from '@/lib/db/client'
import { voiceTestRuns } from '@/lib/db/schema'
import { runSubmissionSchema, scoreRun, UnknownSentenceError } from '@/lib/speech/voice-test-run'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const parsed = runSubmissionSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  let scored
  try {
    scored = scoreRun(parsed.data, loadVoiceTestSentences())
  } catch (error) {
    if (error instanceof UnknownSentenceError) {
      return NextResponse.json({ error: 'invalid' }, { status: 400 })
    }
    throw error
  }
  const db = await getDb()
  const [row] = await db
    .insert(voiceTestRuns)
    .values({
      mode: parsed.data.mode,
      userAgent: (request.headers.get('user-agent') ?? 'unknown').slice(0, 400),
      sentencesTotal: scored.sentencesTotal,
      sentencesHeard: scored.sentencesHeard,
      keyTermsTotal: scored.keyTermsTotal,
      keyTermsMissed: scored.keyTermsMissed,
      errorRate: scored.errorRate,
      readAloudWorked: parsed.data.readAloudWorked,
      stalls: scored.stalls,
      details: {
        completed: parsed.data.completed,
        musicPlaying: parsed.data.musicPlaying,
        sentences: scored.details,
      },
    })
    .returning({ id: voiceTestRuns.id })
  const { decision } = overall(await listVoiceTestRuns(db))
  return NextResponse.json(
    {
      id: row?.id,
      errorRate: scored.errorRate,
      path: scored.path,
      missed: scored.keyTermsMissed,
      total: scored.keyTermsTotal,
      decision,
    },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  )
}
