import { NextResponse } from 'next/server'

import { systemView } from '@/lib/dashboard/system'
import { getDb } from '@/lib/db/client'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(await systemView(await getDb(), new Date()), {
    headers: { 'Cache-Control': 'no-store' },
  })
}
