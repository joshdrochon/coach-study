import { NextResponse } from 'next/server'

import { envHealth, OPTIONAL_SETTINGS } from '@/lib/env'

export const dynamic = 'force-dynamic'

export function GET(): NextResponse {
  const config = envHealth()
  const optional = new Set<string>(OPTIONAL_SETTINGS)
  const ok = Object.entries(config).every(([key, value]) => optional.has(key) || value)
  return NextResponse.json(
    { ok, config },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  )
}
