// pnpm db:wipe-progress: deletes study progress and bumps the reset number in one
// transaction. A dry run by default; --apply to change anything.

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { databaseKind, envFileValue } from '../../src/lib/db/guard'

import { argValue, connect, type Connection } from './connect'

export const WIPED_TABLES = [
  'review_events',
  'card_states',
  'gate_results',
  'practice_phases',
  'practices',
  'baselines',
] as const

export type Counts = Record<(typeof WIPED_TABLES)[number], number>

async function counts(query: Connection['query']): Promise<Counts> {
  const result = {} as Counts
  for (const table of WIPED_TABLES) {
    const [row] = await query(`select count(*)::int as n from ${table}`)
    result[table] = Number(row?.n ?? 0)
  }
  return result
}

async function epochOf(query: Connection['query']): Promise<number> {
  const [row] = await query('select data_epoch from profile where id = 1')
  return Number(row?.data_epoch ?? 0)
}

function lines(label: string, c: Counts): string[] {
  return WIPED_TABLES.map((table) => `${label}: ${table} ${String(c[table])} rows`)
}

export async function wipeProgress(db: Connection, options: { apply: boolean }): Promise<string[]> {
  const before = await counts(db.query)
  const epoch = await epochOf(db.query)
  const out = [
    ...lines('db:wipe-progress', before),
    `db:wipe-progress: reset number ${String(epoch)}`,
  ]
  if (!options.apply) {
    out.push(
      'db:wipe-progress: dry run, nothing deleted (--apply deletes these rows and bumps the reset number)',
    )
    return out
  }
  let next: number
  await db.query('begin')
  try {
    for (const table of WIPED_TABLES) await db.query(`delete from ${table}`)
    const [row] = await db.query(
      `insert into profile (id, data_epoch) values (1, 1)
       on conflict (id) do update set data_epoch = profile.data_epoch + 1
       returning data_epoch`,
    )
    next = Number(row?.data_epoch)
    await db.query('commit')
  } catch (error) {
    await db.query('rollback')
    throw error
  }
  out.push(
    ...lines('after', await counts(db.query)),
    `after: reset number ${String(next)} (was ${String(epoch)})`,
  )
  return out
}

function databaseUrl(args: readonly string[]): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envFile = argValue(args, '--env-file')
  if (envFile === undefined) return undefined
  return envFileValue(readFileSync(path.resolve(envFile), 'utf8'), 'DATABASE_URL')
}

if (process.argv[1] === import.meta.filename) {
  const args = process.argv.slice(2)
  const url = databaseUrl(args)
  if (!url) {
    console.error(
      'db:wipe-progress: DATABASE_URL is not set (the environment, or --env-file <file>)',
    )
    process.exit(2)
  }
  const kind = databaseKind(url)
  if (kind === 'unset' || kind === 'unreadable') {
    console.error('db:wipe-progress: DATABASE_URL is not a Postgres or PGlite URL')
    process.exit(2)
  }
  console.log(`db:wipe-progress: a ${kind} database`)
  const db = await connect(url)
  try {
    for (const line of await wipeProgress(db, { apply: args.includes('--apply') })) {
      console.log(line)
    }
  } finally {
    await db.close()
  }
}
