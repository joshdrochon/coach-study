import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { SPOKEN_VERSION } from '../../src/lib/tts/spoken'
import { VOICE } from '../../src/lib/tts/elevenlabs'
import { clipId, voiceKey } from '../../src/lib/tts/clips'

import { connect } from './connect'
import { judge, liveClips, prune, summarize, type ClipRow } from './prune-clips'

const LINES = ['Hold for 3:00.', 'Pack a lunch + a drink.', 'Palms together.']
const live = liveClips(LINES)
const KEY = voiceKey()
const row = (id: string, key = KEY, bytes = 1000): ClipRow => ({ id, voiceKey: key, bytes })

describe('live combination', () => {
  it('is the code’s own voice key and spoken version', () => {
    expect(live.voiceKey).toBe(KEY)
    expect(SPOKEN_VERSION).toBeGreaterThanOrEqual(2)
    expect(live.current.size).toBe(LINES.length)
    expect(live.current.has(clipId('Palms together.'))).toBe(true)
  })
})

describe('judge', () => {
  it('keeps a clip made with the live voice key and spoken version', () => {
    for (const line of ['Palms together.', 'Hold for 3 minutes.']) {
      const v = judge(row(clipId(line)), liveClips([line]))
      expect(v).toEqual({ keep: true, why: 'live' })
    }
  })

  it('deletes a clip made with another voice setting, model, voice or format', () => {
    const others = [
      { ...VOICE, voiceSettings: { ...VOICE.voiceSettings, stability: 0.3 } },
      { ...VOICE, voiceSettings: { ...VOICE.voiceSettings, similarity_boost: 0.5 } },
      { ...VOICE, modelId: 'eleven_multilingual_v2' },
      { ...VOICE, voiceId: 'OTHER_VOICE_ID' },
      { ...VOICE, outputFormat: 'mp3_44100_64' },
    ]
    for (const voice of others) {
      expect(voiceKey(voice)).not.toBe(KEY)
      const v = judge(row(clipId('Palms together.', voice), voiceKey(voice)), live)
      expect(v.keep).toBe(false)
    }
  })

  it('deletes a clip of a line made under an earlier spoken version, same voice key', () => {
    const old = row(clipId('Palms together.', undefined, SPOKEN_VERSION - 1))
    expect(judge(old, live)).toEqual({
      keep: false,
      reason: `old spoken version ${String(SPOKEN_VERSION - 1)}`,
    })
  })

  it('deletes a clip made before any spoken version was in the id', () => {
    const legacy = createHash('sha256').update(`${KEY}\nPalms together.`).digest('hex')
    expect(judge(row(legacy), live)).toEqual({
      keep: false,
      reason: 'old id format (no spoken version)',
    })
  })

  it('keeps a row with the live voice key it cannot place', () => {
    expect(judge(row(clipId('A line the grader wrote at run time.')), live)).toEqual({
      keep: true,
      why: 'unplaced',
    })
  })

  it('never deletes a live-version id, even when the voice key differs only by being stale', () => {
    expect(judge(row(clipId('Palms together.'), 'deadbeefdeadbeef'), live).keep).toBe(false)
  })
})

describe('summarize', () => {
  it('counts rows, bytes, stale and reasons without any text', () => {
    const rows = [
      row(clipId('Palms together.'), KEY, 2_000_000),
      row(clipId('Palms together.', undefined, 1), KEY, 1_000_000),
      row(clipId('x', undefined, 1), 'aaaaaaaaaaaaaaaa', 500_000),
      row(clipId('y'), KEY, 100),
    ]
    const s = summarize(rows, live)
    expect(s).toMatchObject({ rows: 4, stale: 2, staleBytes: 1_500_000, keptUnplaced: 1 })
    expect(s.bytes).toBe(3_500_100)
    expect([...s.reasons.keys()].sort()).toEqual([
      'old spoken version 1',
      'voice key aaaaaaaa (other voice, model, settings or format)',
    ])
  })
})

describe('prune against a database', () => {
  async function seeded() {
    const db = await connect('pglite://memory', { migrate: true })
    const keep = clipId('Palms together.')
    const rows: [string, string][] = [
      [keep, KEY],
      [clipId('Palms together.', undefined, 1), KEY],
      [clipId('Palms together.', { ...VOICE, modelId: 'old' }), 'bbbbbbbbbbbbbbbb'],
      [clipId('unplaced'), KEY],
    ]
    for (const [id, key] of rows) {
      await db.query('insert into tts_clips (id, voice_key, chars, audio) values ($1, $2, 5, $3)', [
        id,
        key,
        Buffer.from('audio-bytes'),
      ])
    }
    return { db, keep }
  }

  it('a dry run deletes nothing and says so', async () => {
    const { db } = await seeded()
    const out = await prune(db, { apply: false, live })
    expect(out.join('\n')).toMatch(/total 4 rows/)
    expect(out.join('\n')).toMatch(/stale 2 rows/)
    expect(await db.query('select 1 from tts_clips')).toHaveLength(4)
    await db.close()
  })

  it('--apply deletes exactly the stale rows and leaves the live and unplaced ones', async () => {
    const { db, keep } = await seeded()
    const out = await prune(db, { apply: true, live })
    const left = (await db.query('select id from tts_clips')).map((r) => r.id)
    expect(left).toHaveLength(2)
    expect(left).toContain(keep)
    expect(out.join('\n')).toMatch(/after: stale 0 rows/)
    await db.close()
  })
})
