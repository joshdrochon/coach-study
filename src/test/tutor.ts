import type { StructuredRequest } from '@/lib/tutor/anthropic'

export function messageText(request: StructuredRequest | undefined): string {
  const content = request?.messages[0]?.content
  return typeof content === 'string' ? content : ''
}
