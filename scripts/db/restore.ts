// pnpm db:restore: loads a db:export file (--in) into a database (--into).

import { readFileSync } from 'node:fs'

import { restoreDatabase } from '../../src/lib/db/backup'

import { argValue, connect } from './connect'

const args = process.argv.slice(2)
const input = argValue(args, '--in')
const into = argValue(args, '--into')

if (!input) {
  console.error('usage: pnpm db:restore --in <file> [--into pglite://memory]')
  process.exit(2)
}
if (into !== undefined && !into.startsWith('pglite:')) {
  console.error('db:restore: --into takes a pglite:// target; set DATABASE_URL for Postgres')
  process.exit(2)
}
const url = into ?? process.env.DATABASE_URL
if (!url) {
  console.error('db:restore: DATABASE_URL is not set')
  process.exit(2)
}

const file: unknown = JSON.parse(readFileSync(input, 'utf8'))
const db = await connect(url, { migrate: url.startsWith('pglite:') })
try {
  const counts = await restoreDatabase(db.query, file)
  const tables = Object.entries(counts)
  for (const [name, count] of tables) console.log(`  ${name}: ${String(count)} rows`)
  const rows = tables.reduce((sum, [, count]) => sum + count, 0)
  console.log(
    `db:restore: ${String(tables.length)} tables, ${String(rows)} rows restored; every table identical (count and sha256)`,
  )
} catch (error) {
  console.error(`db:restore: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await db.close()
}
