import 'server-only'

import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

import type { Db } from '../db/client'
import { profile } from '../db/schema'

import { acceptsWrite, EPOCH_HEADER, RESET_ERROR, RESET_STATUS } from './epoch'

export async function readEpoch(db: Db): Promise<number> {
  const [row] = await db.select({ epoch: profile.dataEpoch }).from(profile).where(eq(profile.id, 1))
  return row?.epoch ?? 0
}

export async function refuseStaleEpoch(db: Db, headers: Headers): Promise<NextResponse | null> {
  const epoch = await readEpoch(db)
  if (acceptsWrite(epoch, headers.get(EPOCH_HEADER))) return null
  return NextResponse.json(
    { error: RESET_ERROR, epoch },
    { status: RESET_STATUS, headers: { 'Cache-Control': 'no-store' } },
  )
}
