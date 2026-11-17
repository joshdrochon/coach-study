import { readFileSync } from 'node:fs'
import path from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { describe, expect, it } from 'vitest'

import {
  appliedMigrations,
  exportDatabase,
  listTables,
  restoreDatabase,
  RestoreError,
  sha256,
  tableDigests,
  type ExportFile,
  type Query,
} from './backup'
import { fakeDevice } from '@/test/web-push'

import * as schema from './schema'

type Fresh = { client: PGlite; query: Query; db: ReturnType<typeof drizzle<typeof schema>> }

async function fresh(options: { migrated?: boolean } = {}): Promise<Fresh> {
  const client = new PGlite()
  const db = drizzle({ client, schema })
  if (options.migrated !== false) {
    await migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') })
  }
  const query: Query = async (text, params) =>
    (await client.query<Record<string, unknown>>(text, params)).rows
  return { client, query, db }
}

const AT = new Date('2026-08-17T16:00:00.123Z')

async function seed({ db }: Fresh): Promise<void> {
  await db.insert(schema.apiSpend).values({
    day: '2026-08-17',
    scope: 'app',
    purpose: 'card-grade',
    model: 'claude-haiku-4-5',
    inputTokens: 1500,
    outputTokens: 200,
    usd: 0.0023,
    traceId: 'trace-1',
  })
  await db.insert(schema.traces).values({
    id: 'trace-1',
    kind: 'card-grade',
    totalMs: 812,
    costUsd: 0.1,
    outcome: 'ok',
    steps: [{ name: 'grade', ms: 800, model: 'claude-haiku-4-5', usd: 1e-7 }],
    result: { verdict: 'right', quote: 'The learner said “a mat”, then\nshoulders' },
  })
  await db.insert(schema.authLockouts).values({ key: 'app:ip:127.0.0.1', failures: 2 })
  await db.insert(schema.counters).values({ key: 'rate:2026-08-17T16:05', value: 3 })
  await db.insert(schema.voiceTestRuns).values({
    mode: 'safari-tab',
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)',
    sentencesTotal: 40,
    sentencesHeard: 39,
    keyTermsTotal: 120,
    keyTermsMissed: 7,
    errorRate: 0.058333,
    readAloudWorked: true,
    stalls: 1,
    details: { sentences: [{ id: 'vt-01', heard: 'back step' }] },
  })
  await db.insert(schema.reviewEvents).values({
    id: '00000000-0000-4000-8000-000000000001',
    deviceId: 'ipad',
    itemId: 'term-range',
    mode: 'start',
    result: 'partial',
    rating: 2,
    proposedRating: 3,
    overridden: true,
    answerText: 'a mat… and “rollers”',
    answerMs: 6000,
    hintUsed: true,
    hintImposed: false,
    format: 'choices',
    gradedBy: 'tutor',
    traceId: null,
    reviewedAt: AT,
    changedAt: AT,
  })
  await db.insert(schema.cardStates).values({
    itemId: 'term-range',
    card: { key: '1:abc', fsrs: { due: AT.toISOString(), stability: 2.3065, reps: 1 } },
    due: AT,
    reps: 1,
    lapses: 0,
    eventCount: 1,
  })
  await db.insert(schema.practices).values({
    id: '00000000-0000-4000-8000-000000000002',
    deviceId: 'ipad',
    sceneKind: 'start',
    scene: { sceneId: 'warm-up-1', sequence: 1 },
    transcript: [{ atMs: 0, text: 'Hello everyone, here we go.' }],
    selfReview: null,
    grade: { passed: false },
    passed: false,
    gradedBy: 'tutor',
    startedAt: AT,
    doneAt: AT,
  })
  await db.insert(schema.gateResults).values([
    { practiceId: '00000000-0000-4000-8000-000000000002', gateId: 'A2', verdict: 'pass' },
    { practiceId: '00000000-0000-4000-8000-000000000002', gateId: 'C1', verdict: 'miss' },
  ])

  await db.insert(schema.practicePhases).values({
    practiceId: '00000000-0000-4000-8000-000000000002',
    status: 'done',
    coachingSha: 'a3f1',
    silenceMs: 5000,
    gates: ['B1', 'A1'],
    answer: { verdicts: [], wentWellIsAbout: null, toWorkOnIsAbout: null },
    traceId: 'trace-coaching',
    startedAt: AT,
    finishedAt: AT,
  })
  await db.insert(schema.disputes).values({ kind: 'card', itemId: 'term-range', note: '' })
  await db.insert(schema.itemFlags).values({ itemId: 'term-range', reason: 'dispute' })

  await db.insert(schema.evalCaseDrafts).values({
    disputeId: '00000000-0000-4000-8000-0000000000d1',
    flagId: '00000000-0000-4000-8000-0000000000f1',
    itemId: 'term-range',
    card: { id: 'term-range', prompt: 'Parts?', answer: 'Abs', citations: [] },
    words: 'a mat a strapAnd “rollers”  on the front whale…\n',
    wordsFrom: 'answer',
    entry: 'voice',
    note: 'It heard me wrong',
    firstResult: 'partial',
    opusModel: 'claude-opus-5-5',
    opusResult: 'right',
    opusReason: 'Every part was named.',
    answeredAt: AT,
    flaggedAt: AT,
  })
  await db.insert(schema.profile).values({ title: 'Practitioner', avatarJpegBase64: '/9j/4AAQ' })
  await db.insert(schema.reviewerFeedback).values({
    sessionDate: '2026-08-19',
    wentWell: 'Great energy',
    toWorkOn: 'Slow the count down',
  })
  await db.insert(schema.baselines).values({ kind: 'day-1', results: { right: 41, of: 60 } })
  await db.execute(
    sql`update api_spend set created_at = timestamptz '2026-08-17 16:00:00.123456+00'`,
  )
  await db.insert(schema.evalRuns).values({
    set: 'golden',
    grader: 'claude-haiku-4-5',
    strategy: 'evidence-first',
    rubric: 'v3',
    commit: 'abc123',
    cases: 50,
    agreement: 0.9631578947,
    falsePasses: 0,
    categories: { schema_valid: 1, verdict_correct: 0.96 },
    costUsd: 0.24,
    passed: true,
  })

  const device = fakeDevice('https://web.push.apple.com/backup-test-device')
  await db.insert(schema.pushSubscriptions).values({
    endpoint: device.subscription.endpoint,
    ...device.subscription.keys,
    createdAt: AT,
    updatedAt: AT,
  })
  await db.insert(schema.nudges).values({
    day: '2026-08-17',
    seq: 0,
    status: 'sent',
    reason: 'not-studied',
    title: 'Two days to practice day.',
    body: '40 cards for today. Start when you’re ready.',
    cardsLeft: 40,
    delivered: 1,
    createdAt: AT,
    sentAt: AT,
  })
}

const withoutTime = (file: ExportFile) => ({ ...file, exportedAt: '' })

describe('export and restore', () => {
  it('every table comes back identical, and the restored copy exports the same file', async () => {
    const source = await fresh()
    await seed(source)

    await source.query('create table notes (id serial primary key, body text)')
    await source.query(`insert into notes (body) values ('one'), ('two')`)
    const file = await exportDatabase(source.query, AT)

    const journal = JSON.parse(
      readFileSync(path.join(process.cwd(), 'drizzle', 'meta', '_journal.json'), 'utf8'),
    ) as { entries: { when: number }[] }
    expect(file.schema.migrations).toHaveLength(journal.entries.length)
    expect(file.schema.latestAt).toBe(journal.entries.at(-1)?.when)
    const tables = await listTables(source.query)
    expect(Object.keys(file.tables)).toEqual(tables)
    expect(tables).toContain('review_events')
    for (const table of tables) expect(file.tables[table]?.count).toBeGreaterThan(0)

    const target = await fresh()
    await target.query('create table notes (id serial primary key, body text)')

    const counts = await restoreDatabase(target.query, JSON.parse(JSON.stringify(file)))
    expect(counts.review_events).toBe(1)
    expect(counts.notes).toBe(2)
    expect(await tableDigests(target.query)).toEqual(await tableDigests(source.query))
    expect(withoutTime(await exportDatabase(target.query, AT))).toEqual(withoutTime(file))

    const [created] = await target.query(
      `select to_char(created_at, 'US') as us from api_spend limit 1`,
    )
    expect(created?.us).toBe('123456')

    await target.query(`insert into notes (body) values ('three')`)
    const [last] = await target.query('select max(id)::int as id from notes')
    expect(last?.id).toBe(3)
  })

  it('leaves the app voice’s clip cache out of the export, its restore and its check', async () => {
    const source = await fresh()
    await seed(source)
    await source.db.insert(schema.ttsClips).values({
      id: 'a'.repeat(64),
      voiceKey: 'voice-1',
      chars: 7,
      audio: new Uint8Array([0xff, 0xfb, 1, 2]),
    })
    expect(await listTables(source.query)).not.toContain('tts_clips')
    const file = await exportDatabase(source.query, AT)
    expect(Object.keys(file.tables)).not.toContain('tts_clips')
    expect(Object.keys(await tableDigests(source.query))).not.toContain('tts_clips')

    const target = await fresh()
    await restoreDatabase(target.query, JSON.parse(JSON.stringify(file)))
    expect(await target.db.select().from(schema.ttsClips)).toEqual([])

    const [clip] = await source.db.select().from(schema.ttsClips)
    expect(clip?.audio).toEqual(new Uint8Array([0xff, 0xfb, 1, 2]))
  })

  it('an empty database exports every table with no rows', async () => {
    const empty = await fresh()
    const file = await exportDatabase(empty.query, AT)
    expect(Object.values(file.tables).every((table) => table.count === 0)).toBe(true)
    const target = await fresh()
    expect(Object.values(await restoreDatabase(target.query, file))).toEqual(
      Object.values(file.tables).map(() => 0),
    )
  })

  it('refuses what it can’t restore exactly, and leaves the target untouched', async () => {
    const source = await fresh()
    await seed(source)
    const file = await exportDatabase(source.query, AT)

    await expect(restoreDatabase((await fresh()).query, { format: 'other' })).rejects.toThrow(
      RestoreError,
    )

    const unmigrated = await fresh({ migrated: false })
    expect(await appliedMigrations(unmigrated.query)).toEqual([])
    await expect(restoreDatabase(unmigrated.query, file)).rejects.toThrow(/schema differs/)

    const extra = await fresh()
    await extra.query('create table notes (id int)')
    await expect(restoreDatabase(extra.query, file)).rejects.toThrow(/tables/)

    await expect(restoreDatabase(source.query, file)).rejects.toThrow(/not empty/)

    const tampered = structuredClone(file)
    const row = tampered.tables.review_events?.rows[0]
    if (row) row.rating = 4
    const target = await fresh()
    await expect(restoreDatabase(target.query, tampered)).rejects.toThrow(/identical/)
    const digests = await tableDigests(target.query)
    expect(Object.values(digests).every((digest) => digest.count === 0)).toBe(true)
  })

  it('the table digests catch a lossy export even when its own hashes agree', async () => {
    const source = await fresh()
    await seed(source)
    const file = await exportDatabase(source.query, AT)

    const lossy = structuredClone(file)
    for (const table of Object.values(lossy.tables)) {
      table.rows = JSON.parse(
        JSON.stringify(table.rows).replace(/(\.\d{3})\d{3}\+/g, '$1+'),
      ) as typeof table.rows
      table.sha256 = sha256(table.rows)
    }
    const target = await fresh()
    await restoreDatabase(target.query, lossy)
    const [restored, original] = [
      await tableDigests(target.query),
      await tableDigests(source.query),
    ]
    expect(restored.api_spend?.count).toBe(original.api_spend?.count)
    expect(restored.api_spend?.md5).not.toBe(original.api_spend?.md5)
  })

  it('prints the same everywhere: servers with other time zones and date styles agree', async () => {
    const source = await fresh()
    await seed(source)
    await source.query(`set time zone 'America/Los_Angeles'`)
    await source.query(`set datestyle = 'SQL, DMY'`)
    await source.query('set extra_float_digits = 0')
    const file = await exportDatabase(source.query, AT)
    expect(JSON.stringify(file.tables.api_spend?.rows)).toContain(
      '2026-08-17T16:00:00.123456+00:00',
    )
    const target = await fresh()
    await target.query(`set time zone 'Asia/Tokyo'`)
    await restoreDatabase(target.query, file)
    expect(await tableDigests(target.query)).toEqual(await tableDigests(source.query))

    const [zone] = await source.query('select current_setting($1) as value', ['TimeZone'])
    expect(zone?.value).toBe('America/Los_Angeles')
  }, 60_000)

  it('reads one consistent snapshot', async () => {
    const source = await fresh()
    await seed(source)
    const statements: string[] = []
    const spy: Query = (text, params) => {
      statements.push(text.split('\n')[0] ?? '')
      return source.query(text, params)
    }
    await exportDatabase(spy, AT)
    expect(statements[0]).toBe('begin isolation level repeatable read read only')
    expect(statements.at(-1)).toBe('commit')
  })
})
