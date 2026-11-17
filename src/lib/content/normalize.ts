const PLAIN: Record<string, string> = {
  'ﬁ': 'fi',
  'ﬂ': 'fl',
  'ﬃ': 'ffi',
  'ﬀ': 'ff',
  'ﬄ': 'ffl',
  '’': "'",
  '‘': "'",
  '“': '"',
  '”': '"',
  '–': '-',
  '—': '-',
}
const MAPPED = /[ﬁﬂﬃﬀﬄ’‘“”–—]/g

export function normalizeSourceCase(text: string): string {
  return text
    .replace(MAPPED, (char) => PLAIN[char] ?? char)
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeSourceText(text: string): string {
  return normalizeSourceCase(text).toLowerCase()
}

export function findSourceText(haystack: string, needle: string): [number, number] | null {
  const target = normalizeSourceText(needle)
  if (target === '') return null
  let normalized = ''

  const origin: number[] = []
  let space = false
  for (let i = 0; i < haystack.length; i++) {
    const char = haystack.charAt(i)
    if (/\s/.test(char)) {
      space = normalized !== ''
      continue
    }
    if (space) {
      normalized += ' '
      origin.push(i)
      space = false
    }
    for (const out of (PLAIN[char] ?? char).toLowerCase()) {
      normalized += out
      origin.push(i)
    }
  }
  const at = normalized.indexOf(target)
  if (at < 0) return null
  const first = origin[at] ?? 0
  const last = origin[at + target.length - 1] ?? first
  return [first, last + 1]
}
