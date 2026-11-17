import { describe, expect, it } from 'vitest'

import { connect } from '../../../scripts/db/connect'

import {
  FREE_PLAN_BYTES,
  formatMb,
  overWarnLine,
  planShare,
  readDatabaseSize,
  sizeSummary,
  sizeWarning,
  WARN_BYTES,
  WARN_FRACTION,
} from './size'

const MB = 1024 * 1024

describe('the free plan and the warning line', () => {
  it('is 0.5 GB, warned at 70%', () => {
    expect(FREE_PLAN_BYTES).toBe(512 * MB)
    expect(WARN_FRACTION).toBe(0.7)
    expect(WARN_BYTES).toBeCloseTo(358.4 * MB, 3)
  })

  it('warns from 70% on, and not a byte before', () => {
    const line = Math.ceil(WARN_BYTES)
    expect(overWarnLine(line - 1)).toBe(false)
    expect(overWarnLine(line)).toBe(true)
    expect(overWarnLine(FREE_PLAN_BYTES)).toBe(true)
    expect(overWarnLine(0)).toBe(false)
    expect(sizeWarning(line - 1)).toBeNull()
    expect(sizeWarning(line)).toBe(
      'The database is past 70% of the 512 MB free plan (359 MB, 71%).',
    )
  })

  it('reads sizes in megabytes rounded up, so a size never shows smaller than it is', () => {
    expect(formatMb(0)).toBe('0 MB')
    expect(formatMb(1)).toBe('1 MB')
    expect(formatMb(MB)).toBe('1 MB')
    expect(formatMb(MB + 1)).toBe('2 MB')
    expect(formatMb(FREE_PLAN_BYTES)).toBe('512 MB')
    expect(planShare(FREE_PLAN_BYTES / 2)).toBe('50%')
    expect(planShare(FREE_PLAN_BYTES / 2 + 1)).toBe('51%')
  })

  it('says it all on one line for the nightly log', () => {
    expect(sizeSummary({ bytes: 126 * MB, clips: { rows: 612, bytes: 84 * MB } })).toBe(
      'database 126 MB of 512 MB (25%), voice clips 612 rows, 84 MB',
    )
  })
})

describe('reading the size', () => {
  it('counts the voice clips and the whole database, read-only', async () => {
    const db = await connect('pglite://memory', { migrate: true })
    try {
      const empty = await readDatabaseSize(db.query)
      expect(empty.clips.rows).toBe(0)
      expect(empty.bytes).toBeGreaterThan(0)
      await db.query(
        `insert into tts_clips (id, voice_key, chars, audio)
         select 'clip-' || n, 'voice', 40, decode(repeat('ab', 70000), 'hex') from generate_series(1, 3) n`,
      )
      const full = await readDatabaseSize(db.query)
      expect(full.clips.rows).toBe(3)
      expect(full.clips.bytes).toBeGreaterThan(empty.clips.bytes)
      expect(full.bytes).toBeGreaterThanOrEqual(empty.bytes)
      expect(Number.isInteger(full.bytes)).toBe(true)
    } finally {
      await db.close()
    }
  })
})
