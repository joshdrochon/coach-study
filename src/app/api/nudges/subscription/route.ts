import { NextResponse, type NextRequest } from 'next/server'

import { getDb } from '@/lib/db/client'
import { readPushKeys } from '@/lib/env'
import { reminderChangeSchema, reminderKeySchema } from '@/lib/nudges/contract'
import {
  removeSubscription,
  saveSubscription,
  subscriptionSchema,
  unsubscribeSchema,
} from '@/lib/nudges/subscriptions'

export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store' }

export function GET(): NextResponse {
  const publicKey = readPushKeys()?.publicKey ?? null
  return NextResponse.json(reminderKeySchema.parse({ publicKey }), { headers: noStore })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (readPushKeys() === null) {
    return NextResponse.json({ error: 'push-not-configured' }, { status: 503, headers: noStore })
  }
  const parsed = subscriptionSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400, headers: noStore })
  }
  await saveSubscription(await getDb(), parsed.data, new Date())
  return NextResponse.json(reminderChangeSchema.parse({ ok: true }), { headers: noStore })
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const parsed = unsubscribeSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400, headers: noStore })
  }
  await removeSubscription(await getDb(), parsed.data.endpoint)
  return NextResponse.json(reminderChangeSchema.parse({ ok: true }), { headers: noStore })
}
