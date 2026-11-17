import { after, NextResponse, type NextRequest } from 'next/server'

import { getDb } from '@/lib/db/client'
import { flagRequestSchema } from '@/lib/study/contract'
import { refuseStaleEpoch } from '@/lib/study/epoch-server'
import { fileCardFlag } from '@/lib/study/flag'
import { askCardRegrade } from '@/lib/tutor/card'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const db = await getDb()
  const stale = await refuseStaleEpoch(db, request.headers)
  if (stale) return stale
  const parsed = flagRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const { itemId, note, flagId, answer } = parsed.data
  const outcome = await fileCardFlag(
    { itemId, note, ...(flagId ? { flagId } : {}), ...(answer ? { answer } : {}) },
    {
      db,
      ask: (req, signal) => askCardRegrade(req, signal),
      defer: (task) => {
        try {
          after(task)
        } catch {
          void task().catch((error: unknown) => {
            console.error('card re-grade failed', error instanceof Error ? error.name : 'error')
          })
        }
      },
    },
  )
  return NextResponse.json(outcome.body, { status: outcome.status })
}
