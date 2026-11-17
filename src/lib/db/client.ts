import 'server-only'

// One database handle: Postgres (Neon) in production, or PGlite in-process for local
// work and tests, migrated when it opens.

import path from 'node:path'

import { neon } from '@neondatabase/serverless'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http'

import { devDatabaseProblem, testDatabaseProblem } from './guard'
import * as schema from './schema'

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>

let cached: Promise<Db> | undefined

export function getDb(url: string | undefined = process.env.DATABASE_URL): Promise<Db> {
  if (!url) throw new Error('DATABASE_URL is not set')

  const problem =
    process.env.NODE_ENV === 'development'
      ? devDatabaseProblem(url, process.env)
      : process.env.NODE_ENV === 'test'
        ? testDatabaseProblem(url)
        : null
  if (problem) throw new Error(problem)
  cached ??= url.startsWith('pglite:') ? openPglite(url) : Promise.resolve(openNeon(url))
  return cached
}

function openNeon(url: string): Db {
  return drizzleNeon({ client: neon(url), schema })
}

async function openPglite(url: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite')
  const { drizzle } = await import('drizzle-orm/pglite')
  const { migrate } = await import('drizzle-orm/pglite/migrator')
  const target = url.slice('pglite://'.length)
  const client = target === 'memory' || target === '' ? new PGlite() : new PGlite(target)
  const db = drizzle({ client, schema })
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') })
  return db
}

export async function openTestDb(): Promise<Db> {
  return openPglite('pglite://memory')
}
