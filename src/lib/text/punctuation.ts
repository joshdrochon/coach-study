const EM_DASH = /—/g
const SEMICOLON = /;/g

const QUOTED = /“[^”]*”/g

export function aiPunctuation(text: string): string[] {
  const own = text.replace(QUOTED, ' ')
  const marks: { at: number; mark: string }[] = []
  for (const match of own.matchAll(EM_DASH)) marks.push({ at: match.index, mark: '—' })
  for (const match of own.matchAll(SEMICOLON)) marks.push({ at: match.index, mark: ';' })
  return marks.sort((a, b) => a.at - b.at).map((entry) => entry.mark)
}

const QUOTED_PART = /(“[^”]*”)/
const DASH = /\s*—\s*|\s+–\s+/g
const SEMI = /\s*;\s*(\p{Ll})?/gu
const EDGE_START = /^\s*(?:—|–|;)\s*/
const EDGE_END_DASH = /\s*(?:—|–)\s*$/
const EDGE_END_SEMI = /\s*;\s*$/

function plainOwn(own: string): string {
  return own
    .replace(DASH, ', ')
    .replace(SEMI, (_match, next: string | undefined) => `. ${next?.toUpperCase() ?? ''}`)
    .replace(/,\s*([.,!?])/g, '$1')
    .replace(/\.\s+\./g, '.')
    .replace(/ {2,}/g, ' ')
}

export function plainPunctuation(text: string): string {
  const trimmed = text
    .replace(EDGE_START, '')
    .replace(EDGE_END_DASH, '')
    .replace(EDGE_END_SEMI, '.')
  return trimmed
    .split(QUOTED_PART)
    .map((part, i) => (i % 2 === 1 ? part : plainOwn(part)))
    .join('')
}
