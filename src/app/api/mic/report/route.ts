import { randomUUID } from 'node:crypto'

import { NextResponse, type NextRequest } from 'next/server'

import { getDb } from '@/lib/db/client'
import { traces } from '@/lib/db/schema'
import { MIC_REPORTS_PER_MINUTE, micReportSchema } from '@/lib/speech/mic-report'
import { reportingServer } from '@/lib/tts/clips'
import { claimCallSlot } from '@/lib/tutor/run'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(request: NextRequest): Promise<NextResponse> {
  const parsed = micReportSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400, headers: NO_STORE })
  }
  const report = parsed.data
  const now = new Date()
  const db = await getDb()
  if (!(await claimCallSlot(db, now, 'mic-reports', MIC_REPORTS_PER_MINUTE))) {
    return NextResponse.json({ error: 'rate-limited' }, { status: 429, headers: NO_STORE })
  }
  await db.insert(traces).values({
    id: randomUUID(),
    kind: 'mic',
    startedAt: new Date(now.getTime() - report.atMs),
    totalMs: report.atMs,
    costUsd: 0,
    outcome: 'error',
    steps: report.firstResultMs === null ? [] : [{ name: 'first word', ms: report.firstResultMs }],
    result: {
      source: 'ipad',
      env: reportingServer(),
      reason: report.reason,
      endOn: report.endOn,
      restarts: report.restarts,
      app: report.app,
    },
    error: report.reason,
  })
  return new NextResponse(null, { status: 204, headers: NO_STORE })
}
