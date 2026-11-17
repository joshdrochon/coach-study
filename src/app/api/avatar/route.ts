import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { eq } from 'drizzle-orm'
import { NextResponse, type NextRequest } from 'next/server'

import { getDb } from '@/lib/db/client'
import { profile } from '@/lib/db/schema'
import { avatarMd5Schema, avatarMd5Sql, avatarVersion } from '@/lib/study/profile'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const db = await getDb()
  const [row] = await db
    .select({ avatar: profile.avatarJpegBase64, md5: avatarMd5Sql })
    .from(profile)
    .where(eq(profile.id, 1))
  const avatar = row?.avatar ?? null
  const version = avatarVersion(avatarMd5Schema.parse(row?.md5 ?? null))
  const current = request.nextUrl.searchParams.get('v') === version
  const headers = {
    'Content-Type': 'image/jpeg',
    'Cache-Control': current ? 'private, max-age=31536000, immutable' : 'private, max-age=300',
  }
  if (avatar) return new NextResponse(new Uint8Array(Buffer.from(avatar, 'base64')), { headers })
  const fallback = await readFile(
    path.join(process.cwd(), 'design', 'assets', 'default-avatar.jpg'),
  )
  return new NextResponse(new Uint8Array(fallback), { headers })
}
