import { spokenText } from './spoken'

export const TTS_MAX_CHARS = 800

export function ttsLine(text: string): string {
  return spokenText(text)
}

export function sendableLine(text: string): string {
  const line = ttsLine(text)
  return line.length > TTS_MAX_CHARS ? '' : line
}
