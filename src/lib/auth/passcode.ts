import 'server-only'

import { createHash, timingSafeEqual } from 'node:crypto'

export function passcodeMatches(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b) && given.length === expected.length
}

export function clientIp(headers: Headers): string {
  const candidates = [headers.get('x-forwarded-for')?.split(',')[0], headers.get('x-real-ip')]
  return candidates.map((value) => value?.trim()).find((value) => value) ?? 'unknown'
}

export function safeNext(next: string | null | undefined, fallback = '/'): string {
  if (!next?.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback
  return next
}
