import 'server-only'

import { TtsError } from './errors'

export type VoiceSettings = {
  readonly stability: number
  readonly similarity_boost: number
}

export type Voice = {
  readonly voiceId: string
  readonly modelId: string
  readonly outputFormat: string
  readonly voiceSettings: VoiceSettings
}

// The ElevenLabs voice comes from the environment; without one the placeholder makes the voice
// calls fail and the app falls back to the device's own voice.
function voiceIdFrom(value: string | undefined): string {
  const id = value?.trim() ?? ''
  return id === '' ? 'YOUR_VOICE_ID' : id
}

export const VOICE: Voice = {
  voiceId: voiceIdFrom(process.env.ELEVENLABS_VOICE_ID),
  modelId: 'eleven_v4',
  outputFormat: 'mp3_44100_128',
  voiceSettings: {
    stability: 0.5,
    similarity_boost: 0.85,
  },
}

export const TTS_TIMEOUT_MS = 5000

export const TTS_KEEP_MAKING_MS = 15_000

export const MAX_CLIP_BYTES = 3_000_000

type EnvSource = Record<string, string | undefined>

export function elevenLabsKey(source: EnvSource = process.env): string | null {
  const key = source.ELEVENLABS_API_KEY?.trim()
  return key && key !== '[SENSITIVE]' ? key : null
}

export type Fetch = (url: string, init: RequestInit) => Promise<Response>

export async function synthesize(
  text: string,
  key: string,
  signal: AbortSignal,
  fetchImpl: Fetch = fetch,
  voice: Voice = VOICE,
): Promise<Uint8Array<ArrayBuffer>> {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice.voiceId}?output_format=${voice.outputFormat}`
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text,
        model_id: voice.modelId,
        voice_settings: voice.voiceSettings,
      }),
      signal,
      redirect: 'error',
    })
  } catch {
    throw signal.aborted
      ? new TtsError('timeout', 'the voice took too long')
      : new TtsError('upstream', 'the voice could not be reached')
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new TtsError('upstream', `the voice answered ${String(response.status)}`)
  }
  let bytes: Uint8Array<ArrayBuffer>
  try {
    bytes = new Uint8Array(await response.arrayBuffer())
  } catch {
    throw signal.aborted
      ? new TtsError('timeout', 'the voice took too long')
      : new TtsError('upstream', 'the voice stopped mid-line')
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_CLIP_BYTES) {
    throw new TtsError('upstream', 'the voice sent no usable audio')
  }
  return bytes
}
