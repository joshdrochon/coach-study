// pnpm db:migrate: applies the SQL migrations in drizzle/ to DATABASE_URL.

import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { Pool } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'
import { migrate } from 'drizzle-orm/neon-serverless/migrator'

import { productionUseProblem } from '../../src/lib/db/guard'

const folder = path.resolve(import.meta.dirname, '..', '..', 'drizzle')
const url = process.env.DATABASE_URL
const production = productionUseProblem(url, process.env, process.argv.slice(2), 'db:migrate')

if (!existsSync(folder) || !readdirSync(folder).some((file) => file.endsWith('.sql'))) {
  console.log('db:migrate: no migrations to apply')
} else if (!url || url.startsWith('pglite:')) {
  console.error('db:migrate: DATABASE_URL must point at Postgres (refusing to run)')
  process.exitCode = 1
} else if (production) {
  console.error(`db:migrate refused: ${production}`)
  process.exitCode = 1
} else {
  const pool = new Pool({ connectionString: url })
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: folder })
    console.log('db:migrate: migrations applied')
  } finally {
    await pool.end()
  }
}
