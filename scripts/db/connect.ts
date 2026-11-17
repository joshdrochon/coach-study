import path from 'node:path'

import { Pool } from '@neondatabase/serverless'

import type { Query } from '../../src/lib/db/backup'

export type Connection = { query: Query; close: () => Promise<void> }

const MIGRATIONS = path.resolve(import.meta.dirname, '..', '..', 'drizzle')

export async function connect(
  url: string,
  options: { migrate?: boolean } = {},
): Promise<Connection> {
  if (url.startsWith('pglite:')) {
    const { PGlite } = await import('@electric-sql/pglite')
    const target = url.slice('pglite://'.length)
    const client = target === 'memory' || target === '' ? new PGlite() : new PGlite(target)
    if (options.migrate) {
      const { drizzle } = await import('drizzle-orm/pglite')
      const { migrate } = await import('drizzle-orm/pglite/migrator')
      await migrate(drizzle({ client }), { migrationsFolder: MIGRATIONS })
    }
    return {
      query: async (text, params) =>
        (await client.query<Record<string, unknown>>(text, params)).rows,
      close: () => client.close(),
    }
  }
  if (options.migrate) throw new Error('migrate a Postgres target with pnpm db:migrate first')
  const pool = new Pool({ connectionString: url })
  const client = await pool.connect()
  return {
    query: async (text, params) => (await client.query<Record<string, unknown>>(text, params)).rows,
    close: async () => {
      client.release()
      await pool.end()
    },
  }
}

export function argValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
