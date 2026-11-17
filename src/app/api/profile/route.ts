import { NextResponse, type NextRequest } from 'next/server'

import { getDb } from '@/lib/db/client'
import { profileChangeSchema, readProfile, updateProfile } from '@/lib/study/profile'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const parsed = profileChangeSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  await updateProfile(await getDb(), parsed.data, new Date())
  return NextResponse.json({ ok: true })
}

export async function GET(): Promise<NextResponse> {
  const { welcomedAt } = await readProfile(await getDb())
  return NextResponse.json(
    { welcomed: welcomedAt !== null },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
