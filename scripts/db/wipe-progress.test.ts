import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { connect, type Connection } from './connect'
import { WIPED_TABLES, wipeProgress } from './wipe-progress'

const KEPT = [
  'profile',
  'tts_clips',
  'api_spend',
  'traces',
  'item_flags',
  'disputes',

  'eval_case_drafts',
  'push_subscriptions',
  'voice_test_runs',
  'counters',
  'eval_runs',
  'auth_lockouts',
  'nudges',
  'reviewer_feedback',
] as const

const PRACTICE = '00000000-0000-4000-8000-000000000001'

async function seed(db: Connection): Promise<void> {
  const statements = [
    `insert into profile (id, title, avatar_jpeg_base64, practice_sessions_done, practice_classes_done, welcomed_at)
     values (1, 'Practitioner', 'AAAA', 1, 10, now())`,
    `insert into review_events (id, device_id, item_id, mode, result, rating, proposed_rating, answer_ms, graded_by, reviewed_at)
     values ('00000000-0000-4000-8000-0000000000a1', 'ipad', 'card-a', 'start', 'right', 3, 3, 5000, 'self', now()),
            ('00000000-0000-4000-8000-0000000000a2', 'ipad', 'card-b', 'start', 'wrong', 1, 1, 5000, 'self', now())`,
    `insert into card_states (item_id, card, due, reps, lapses, event_count) values ('card-a', '{}', now(), 1, 0, 1)`,
    `insert into practices (id, device_id, scene_kind, scene, transcript, started_at, done_at)
     values ('${PRACTICE}', 'ipad', 'warm-up', '{}', '{}', now(), now())`,
    `insert into gate_results (practice_id, gate_id, verdict) values ('${PRACTICE}', 'g1', 'pass')`,
    `insert into practice_phases (practice_id, status, coaching_sha, silence_ms, gates) values ('${PRACTICE}', 'done', 'x', 8000, '[]')`,
    `insert into baselines (kind, results) values ('day-1', '{}')`,
    `insert into tts_clips (id, voice_key, chars, audio) values ('clip', 'key', 5, '\\x00')`,
    `insert into api_spend (day, scope, purpose, model, input_tokens, output_tokens, usd) values (current_date, 'app', 'grade', 'm', 1, 1, 0.01)`,
    `insert into traces (id, kind, outcome, steps) values ('t1', 'card-grade', 'ok', '[]')`,
    `insert into item_flags (item_id, reason) values ('card-c', 'this-looks-wrong')`,
    `insert into disputes (kind, item_id, note) values ('card', 'card-c', 'note')`,
    `insert into eval_case_drafts (dispute_id, item_id, card, words, words_from, entry, first_result, opus_model, opus_result, opus_reason, answered_at, flagged_at)
     values ('00000000-0000-4000-8000-0000000000d1', 'card-c', '{}', 'their words', 'answer', 'voice', 'partial', 'm', 'right', 'r', now(), now())`,
    `insert into push_subscriptions (endpoint, p256dh, auth) values ('https://push.invalid/1', 'k', 'a')`,
    `insert into voice_test_runs (mode, user_agent, sentences_total, sentences_heard, key_terms_total, key_terms_missed, error_rate, read_aloud_worked, stalls, details)
     values ('safari-tab', 'ua', 1, 1, 1, 0, 0, true, 0, '{}')`,
    `insert into counters (key, value) values ('c', 1)`,
    `insert into eval_runs (set, grader, strategy, rubric, commit, cases, agreement, false_passes, categories, cost_usd, passed)
     values ('golden', 'g', 's', 'r', 'abc', 1, 1, 0, '{}', 0, true)`,
    `insert into auth_lockouts (key) values ('ip')`,
    `insert into nudges (day, seq, status, reason, title, body, cards_left) values (current_date, 0, 'sent', 'not-studied', 't', 'b', 1)`,
    `insert into reviewer_feedback (session_date, went_well, to_work_on) values (current_date, 'c', 'o')`,
  ]
  for (const statement of statements) await db.query(statement)
}

async function countOf(db: Connection, table: string): Promise<number> {
  const [row] = await db.query(`select count(*)::int as n from ${table}`)
  return Number(row?.n)
}

let db: Connection

beforeEach(async () => {
  db = await connect('pglite://memory', { migrate: true })
  await seed(db)
}, 60_000)

afterEach(async () => {
  await db.close()
})

describe('db:wipe-progress', () => {
  it('a dry run prints counts and the reset number, and changes nothing', async () => {
    const out = await wipeProgress(db, { apply: false })
    expect(out).toContain('db:wipe-progress: review_events 2 rows')
    expect(out).toContain('db:wipe-progress: practices 1 rows')
    expect(out).toContain('db:wipe-progress: reset number 0')
    expect(out.at(-1)).toMatch(/dry run, nothing deleted/)
    for (const table of WIPED_TABLES) expect(await countOf(db, table)).toBeGreaterThan(0)
    const [profile] = await db.query('select data_epoch from profile where id = 1')
    expect(profile?.data_epoch).toBe(0)
  })

  it('--apply deletes their progress and practices, bumps the reset number, keeps everything else', async () => {
    const out = await wipeProgress(db, { apply: true })
    for (const table of WIPED_TABLES) expect(await countOf(db, table)).toBe(0)
    for (const table of KEPT) expect(await countOf(db, table)).toBe(1)
    const [profile] = await db.query(
      'select data_epoch, title, avatar_jpeg_base64, practice_sessions_done, practice_classes_done, welcomed_at from profile where id = 1',
    )
    expect(profile).toMatchObject({
      data_epoch: 1,
      title: 'Practitioner',
      avatar_jpeg_base64: 'AAAA',
      practice_sessions_done: 1,
      practice_classes_done: 10,
    })
    expect(profile?.welcomed_at).not.toBeNull()
    expect(out).toContain('after: reset number 1 (was 0)')

    expect(out.join('\n')).not.toMatch(/card-a|AAAA|ipad/)

    await wipeProgress(db, { apply: true })
    const [again] = await db.query('select data_epoch from profile where id = 1')
    expect(again?.data_epoch).toBe(2)
  })

  it('--apply with no profile row yet makes one at reset number 1', async () => {
    await db.query('delete from profile')
    await wipeProgress(db, { apply: true })
    const [profile] = await db.query('select data_epoch, title from profile where id = 1')
    expect(profile).toEqual({ data_epoch: 1, title: 'Starter' })
  })

  it('is one transaction: a failure part way deletes nothing and bumps nothing', async () => {
    const failing: Connection = {
      query: async (text, params) => {
        if (text.startsWith('insert into profile')) throw new Error('lost connection')
        return db.query(text, params)
      },
      close: () => db.close(),
    }
    await expect(wipeProgress(failing, { apply: true })).rejects.toThrow('lost connection')
    for (const table of WIPED_TABLES) expect(await countOf(db, table)).toBeGreaterThan(0)
    const [profile] = await db.query('select data_epoch from profile where id = 1')
    expect(profile?.data_epoch).toBe(0)
  })
})

describe('the command', () => {
  const script = path.join(import.meta.dirname, 'wipe-progress.ts')
  const run = (args: string[], env: Record<string, string | undefined>) =>
    execFileSync(process.execPath, ['--import', 'tsx', script, ...args], {
      env: { ...process.env, DATABASE_URL: undefined, ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

  it('refuses without DATABASE_URL', () => {
    let failure: { status?: number; stderr?: string } = {}
    try {
      run([], {})
    } catch (error) {
      failure = error as typeof failure
    }
    expect(failure.status).toBe(2)
    expect(failure.stderr).toMatch(/DATABASE_URL is not set/)
  })

  it('runs against a PGlite directory: dry run, then --apply; never prints the URL', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'coach-study-wipe-'))
    const url = `pglite://${path.join(dir, 'db')}`
    try {
      execFileSync(
        process.execPath,
        [
          '--import',
          'tsx',
          '-e',
          `import('${path.join(import.meta.dirname, 'connect.ts')}').then(async ({ connect }) => { const c = await connect(${JSON.stringify(url)}, { migrate: true }); await c.query("insert into review_events (id, device_id, item_id, mode, result, rating, proposed_rating, answer_ms, graded_by, reviewed_at) values ('00000000-0000-4000-8000-0000000000b1', 'ipad', 'card-a', 'start', 'right', 3, 3, 5000, 'self', now())"); await c.close() })`,
        ],
        { encoding: 'utf8' },
      )
      const dry = run([], { DATABASE_URL: url })
      expect(dry).toMatch(/a pglite database/)
      expect(dry).toMatch(/review_events 1 rows/)
      expect(dry).toMatch(/dry run, nothing deleted/)
      const applied = run(['--apply'], { DATABASE_URL: url })
      expect(applied).toMatch(/after: review_events 0 rows/)
      expect(applied).toMatch(/after: reset number 1 \(was 0\)/)
      expect(`${dry}${applied}`).not.toContain(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)
})
