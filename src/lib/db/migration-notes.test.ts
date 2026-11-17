import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const DRIZZLE = path.resolve(import.meta.dirname, '..', '..', '..', 'drizzle')

const journal = JSON.parse(readFileSync(path.join(DRIZZLE, 'meta', '_journal.json'), 'utf8')) as {
  entries: { tag: string }[]
}
const tags = journal.entries.map((entry) => entry.tag)

function notes(): Map<string, string> {
  const text = readFileSync(path.join(DRIZZLE, 'NOTES.md'), 'utf8')
  const sections = new Map<string, string>()
  for (const part of text.split(/^## /m).slice(1)) {
    const [heading = '', ...body] = part.split('\n')
    sections.set(heading.trim(), body.join(' ').replace(/\s+/g, ' ').trim())
  }
  return sections
}

describe('migration notes', () => {
  it('every .sql migration is in the journal', () => {
    const files = readdirSync(DRIZZLE)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => file.replace(/\.sql$/, ''))
    expect(files.toSorted()).toEqual(tags.toSorted())
  })

  it('every migration has a note of at least one full sentence, and no note is for nothing', () => {
    const sections = notes()
    expect([...sections.keys()]).toEqual(tags)
    for (const tag of tags) {
      const body = sections.get(tag) ?? ''
      expect(body, tag).toMatch(/^[A-Z`].{20,}\.$/)
    }
  })
})
