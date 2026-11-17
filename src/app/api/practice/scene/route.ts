import { NextResponse, type NextRequest } from 'next/server'

import { getDb } from '@/lib/db/client'
import { sceneViewSchema } from '@/lib/practice/contract'
import { nextScene, sceneView } from '@/lib/practice/grade'
import { findScene, METHOD } from '@/lib/practice/method'

export const dynamic = 'force-dynamic'

// The scene to practice: the one asked for by id, or the one practiced least.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const id = request.nextUrl.searchParams.get('id')
  const scene = id ? findScene(METHOD, id) : await nextScene(await getDb(), METHOD)
  if (!scene) return NextResponse.json({ error: 'unknown scene' }, { status: 404 })
  return NextResponse.json(sceneViewSchema.parse(sceneView(METHOD, scene)), {
    headers: { 'Cache-Control': 'no-store' },
  })
}
