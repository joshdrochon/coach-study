import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC = path.join(import.meta.dirname, '..')
const POINTER = /^@media\s*\(\s*hover\s*:\s*hover\s*\)$/

function unguardedHover(css: string): number[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
  const stack: string[] = []
  const found: number[] = []
  let start = 0
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '{') {
      const prelude = text.slice(start, i).trim().replace(/\s+/g, ' ')
      if (/:hover\b/.test(prelude) && !stack.some((outer) => POINTER.test(outer))) {
        const offset = start + text.slice(start, i).search(/\S/)
        found.push(text.slice(0, offset).split('\n').length)
      }
      stack.push(prelude)
      start = i + 1
    } else if (ch === '}') {
      stack.pop()
      start = i + 1
    } else if (ch === ';') {
      start = i + 1
    }
  }
  return found
}

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return cssFiles(full)
    return entry.name.endsWith('.css') ? [full] : []
  })
}

describe('hover only with a pointer', () => {
  it('finds a :hover rule outside the pointer block', () => {
    expect(unguardedHover('.a:hover {\n  color: red;\n}\n')).toEqual([1])
    expect(unguardedHover('.a {\n}\n\n.b,\n.b:hover {\n}\n')).toEqual([4])
    expect(unguardedHover('@media (max-width: 743px) {\n  .a:hover {\n  }\n}\n')).toEqual([2])
    expect(unguardedHover('@media (any-hover: hover) {\n  .a:hover {\n  }\n}\n')).toEqual([2])
    expect(unguardedHover('/* .a:hover { } */\n.a {\n}\n')).toEqual([])
    expect(
      unguardedHover('@media (hover: hover) {\n  .a:hover:not(:disabled) {\n  }\n}\n'),
    ).toEqual([])
    expect(
      unguardedHover('@media (hover: hover) {\n  .a:hover {\n  }\n}\n.b:hover {\n}\n'),
    ).toEqual([5])
  })

  it('puts every :hover rule in src inside @media (hover: hover)', () => {
    const files = cssFiles(SRC)
    expect(files.length).toBeGreaterThan(0)
    const offenders = files.flatMap((file) =>
      unguardedHover(readFileSync(file, 'utf8')).map(
        (line) => `${path.relative(SRC, file)}:${line}`,
      ),
    )
    expect(offenders).toEqual([])

    const guarded = files.reduce(
      (count, file) => count + (readFileSync(file, 'utf8').match(/:hover\b/g) ?? []).length,
      0,
    )
    expect(guarded).toBeGreaterThan(0)
  })
})
