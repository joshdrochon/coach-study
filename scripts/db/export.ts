// pnpm db:export: writes every table to a JSON file (--out) as a backup.

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

import { exportDatabase } from '../../src/lib/db/backup'

import { argValue, connect } from './connect'

const args = process.argv.slice(2)
const out = argValue(args, '--out')
const url = process.env.DATABASE_URL

if (!out) {
  console.error('usage: pnpm db:export --out <file>')
  process.exit(2)
}
if (!url) {
  console.error('db:export: DATABASE_URL is not set')
  process.exit(2)
}

function migrationName(at: number | null, count: number): string {
  if (at === null) return 'no migrations'
  const journal = z
    .object({ entries: z.array(z.object({ when: z.number(), tag: z.string() })) })
    .safeParse(
      JSON.parse(
        readFileSync(
          path.resolve(import.meta.dirname, '..', '..', 'drizzle', 'meta', '_journal.json'),
          'utf8',
        ),
      ),
    )
  const tag = journal.success ? journal.data.entries.find((entry) => entry.when === at)?.tag : null
  return tag ?? `migration ${String(count)} (not in this checkout's journal)`
}

const db = await connect(url)
try {
  const file = await exportDatabase(db.query, new Date())
  const text = JSON.stringify(file)
  writeFileSync(out, text, { mode: 0o600 })
  const tables = Object.entries(file.tables)
  const rows = tables.reduce((sum, [, table]) => sum + table.count, 0)
  for (const [name, table] of tables) console.log(`  ${name}: ${String(table.count)} rows`)
  const digest = createHash('sha256').update(text).digest('hex').slice(0, 16)
  const schema = migrationName(file.schema.latestAt, file.schema.migrations.length)
  console.log(
    `db:export: ${String(tables.length)} tables, ${String(rows)} rows, schema at ${schema}; file sha256 ${digest}…`,
  )
} finally {
  await db.close()
}
