import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { passageFileSchema, passageSchema } from './schema'

const text = 'Hands on the front rail.'

describe('source passages: a manual page or a video timestamp', () => {
  it('takes a manual passage with its page and a video passage with its timestamp', () => {
    expect(passageSchema.safeParse({ id: 'm012-a', kind: 'manual', page: 12, text }).success).toBe(
      true,
    )
    expect(
      passageSchema.safeParse({ id: 'v1-01-a', kind: 'video', timestamp: '1:05', text }).success,
    ).toBe(true)
  })

  it('refuses a passage that carries both a page and a timestamp', () => {
    expect(
      passageSchema.safeParse({ id: 'm012-a', kind: 'manual', page: 12, timestamp: '1:05', text })
        .success,
    ).toBe(false)
    expect(
      passageSchema.safeParse({ id: 'v1-01-a', kind: 'video', timestamp: '1:05', page: 12, text })
        .success,
    ).toBe(false)
  })

  it('refuses a passage with neither, or with another kind of source', () => {
    expect(passageSchema.safeParse({ id: 'm012-a', kind: 'manual', text }).success).toBe(false)
    expect(passageSchema.safeParse({ id: 'v1-01-a', kind: 'video', text }).success).toBe(false)
    expect(passageSchema.safeParse({ id: 'm012-a', kind: 'web', page: 12, text }).success).toBe(
      false,
    )
  })

  it('every committed passage file still parses', () => {
    const dir = path.join(process.cwd(), 'content', 'passages')
    const files = readdirSync(dir).filter((name) => name.endsWith('.json'))
    expect(files.length).toBeGreaterThan(0)
    for (const name of files) {
      const parsed = passageFileSchema.safeParse(JSON.parse(readFileSync(path.join(dir, name), 'utf8')))
      expect(parsed.success, name).toBe(true)
    }
  })
})
