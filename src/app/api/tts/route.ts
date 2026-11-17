import { after, NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'

import { getDb } from '@/lib/db/client'
import { lineClip, voiceKey } from '@/lib/tts/clips'
import { elevenLabsKey } from '@/lib/tts/elevenlabs'
import { TTS_STATUS, TtsError, ttsErrorBody, type TtsErrorKind } from '@/lib/tts/errors'

export const dynamic = 'force-dynamic'

export const maxDuration = 30

function keepMaking(rest: Promise<void>): void {
  try {
    after(rest)
  } catch {}
}

const requestSchema = z.object({ text: z.string() })

function refuse(kind: TtsErrorKind): NextResponse {
  return NextResponse.json(ttsErrorBody(kind), {
    status: TTS_STATUS[kind],
    headers: { 'Cache-Control': 'no-store' },
  })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!elevenLabsKey()) return refuse('no-key')
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return refuse('invalid')
  try {
    const clip = await lineClip(await getDb(), parsed.data.text, { keepMaking })
    return new NextResponse(clip.audio, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(clip.audio.byteLength),
        'Cache-Control': 'no-store',
        'X-Tts-Clip': clip.id,
        'X-Tts-Voice': voiceKey(),
        'X-Tts-Cache': clip.cached ? 'hit' : 'miss',
      },
    })
  } catch (error) {
    if (error instanceof TtsError) return refuse(error.kind)
    throw error
  }
}
