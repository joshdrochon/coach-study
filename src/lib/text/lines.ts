export const MAX_DEPTH = 2

export type TextLine = { depth: number; text: string }

export function depthMark(depth: number): string {
  return '\t'.repeat(Math.max(0, Math.min(MAX_DEPTH, depth)))
}

export function flatText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function textLines(text: string): TextLine[] {
  const lines = text
    .split('\n')
    .map((raw) => ({
      depth: Math.min(MAX_DEPTH, /^\t*/.exec(raw)?.[0].length ?? 0),
      text: flatText(raw),
    }))
    .filter((line) => line.text !== '')
  const shallowest = Math.min(...lines.map((line) => line.depth))
  return lines.map((line) => ({
    depth: line.depth - (Number.isFinite(shallowest) ? shallowest : 0),
    text: line.text,
  }))
}

export type CitationLine = { text: string; label: boolean; indent: number }

export function citationLines(text: string): CitationLine[] {
  const lines = textLines(text)
  return lines.map((line, index) => {
    const next = lines[index + 1]
    const label = line.depth === 0 && next !== undefined && next.depth > 0
    return { text: line.text, label, indent: label ? 0 : Math.max(0, line.depth - 1) }
  })
}

export function hasLayout(text: string): boolean {
  return textLines(text).length > 1
}
