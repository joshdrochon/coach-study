import { NextResponse, type NextRequest } from 'next/server'

import { getDb } from '@/lib/db/client'
import { CLIP_ID, findClip } from '@/lib/tts/clips'
import { elevenLabsKey } from '@/lib/tts/elevenlabs'
import { TTS_STATUS, ttsErrorBody, type TtsErrorKind } from '@/lib/tts/errors'

export const dynamic = 'force-dynamic'

function refuse(kind: TtsErrorKind): NextResponse {
  return NextResponse.json(ttsErrorBody(kind), {
    status: TTS_STATUS[kind],
    headers: { 'Cache-Control': 'no-store' },
  })
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ clip: string }> },
): Promise<NextResponse> {
  if (!elevenLabsKey()) return refuse('no-key')
  const { clip } = await params
  if (!CLIP_ID.test(clip)) return refuse('not-found')
  const audio = await findClip(await getDb(), clip)
  if (!audio) return refuse('not-found')
  return new NextResponse(audio, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(audio.byteLength),
      'Cache-Control': 'private, max-age=31536000, immutable',
      ETag: `"${clip}"`,
    },
  })
}
