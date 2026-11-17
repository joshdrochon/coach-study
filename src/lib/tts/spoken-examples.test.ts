import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { SPOKEN_RULES } from './spoken'
import { SPOKEN_EXAMPLES } from './spoken-examples'

const SRC = path.resolve(import.meta.dirname, '..', '..')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return files(full)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : []
  })
}

describe('spoken-text examples', () => {
  it('has examples for every rule, and none for a rule that is gone', () => {
    expect(Object.keys(SPOKEN_EXAMPLES).sort()).toEqual(SPOKEN_RULES.map((r) => r.id).sort())
  })

  it('are imported by no app code', () => {
    const importers = files(SRC)
      .filter((file) => /from '[^']*spoken-(?:examples|check)'/.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(SRC, file))
    expect(importers).toEqual(['lib/tts/spoken-check.ts'])
  })
})
