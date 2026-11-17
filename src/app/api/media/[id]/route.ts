import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { NextResponse, type NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params
  if (!/^p\d{3}-[a-z0-9-]+$/.test(id)) return new NextResponse(null, { status: 404 })
  try {
    const bytes = await readFile(path.join(process.cwd(), 'content', 'photos', `${id}.jpg`))
    return new NextResponse(new Uint8Array(bytes), {
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' },
    })
  } catch {
    return new NextResponse(null, { status: 404 })
  }
}
