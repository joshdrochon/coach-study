import { createHash } from 'node:crypto'

import { z } from 'zod'

export type Query = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>

export const EXPORT_FORMAT = 'coach-study-export'
export const EXPORT_VERSION = 1

const rowSchema = z.record(z.string(), z.unknown())

export const tableExportSchema = z.object({
  count: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  rows: z.array(rowSchema),
})
export type TableExport = z.infer<typeof tableExportSchema>

export const exportFileSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  exportedAt: z.iso.datetime({ offset: true }),

  schema: z.object({ migrations: z.array(z.string()), latestAt: z.number().nullable() }),
  tables: z.record(z.string(), tableExportSchema),
})
export type ExportFile = z.infer<typeof exportFileSchema>

function ident(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

export const CACHE_TABLES: readonly string[] = ['tts_clips']

export async function listTables(query: Query): Promise<string[]> {
  const rows = await query(
    `select table_name::text as name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'`,
  )
  return rows
    .map((row) => String(row.name))
    .filter((name) => !CACHE_TABLES.includes(name))
    .toSorted()
}

async function migrationRows(query: Query): Promise<Record<string, unknown>[]> {
  const [exists] = await query(
    `select to_regclass('drizzle.__drizzle_migrations') is not null as present`,
  )
  if (exists?.present !== true) return []
  return query(
    'select hash, created_at::text as at from drizzle.__drizzle_migrations order by created_at, id',
  )
}

export async function appliedMigrations(query: Query): Promise<string[]> {
  return (await migrationRows(query)).map((row) => String(row.hash))
}

export async function latestMigrationAt(query: Query): Promise<number | null> {
  const last = (await migrationRows(query)).at(-1)
  return last === undefined ? null : Number(last.at)
}

export function sha256(rows: readonly unknown[]): string {
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex')
}

const SESSION = [
  "set local time zone 'UTC'",
  "set local datestyle = 'ISO, YMD'",
  "set local intervalstyle = 'postgres'",
  'set local extra_float_digits = 1',
]

async function inTransaction<T>(query: Query, begin: string, work: () => Promise<T>): Promise<T> {
  await query(begin)
  try {
    for (const setting of SESSION) await query(setting)
    const result = await work()
    await query('commit')
    return result
  } catch (error) {
    await query('rollback')
    throw error
  }
}

export async function tableRows(query: Query, table: string): Promise<Record<string, unknown>[]> {
  const [row] = await query(
    `select coalesce(json_agg(t order by t::text), '[]'::json) as rows from public.${ident(table)} t`,
  )
  const rows: unknown = typeof row?.rows === 'string' ? JSON.parse(row.rows) : row?.rows
  return z.array(rowSchema).parse(rows)
}

export function exportDatabase(query: Query, now: Date): Promise<ExportFile> {
  return inTransaction(query, 'begin isolation level repeatable read read only', async () => {
    const migrations = await appliedMigrations(query)
    const tables: Record<string, TableExport> = {}
    for (const table of await listTables(query)) {
      const rows = await tableRows(query, table)
      tables[table] = { count: rows.length, sha256: sha256(rows), rows }
    }
    return {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: now.toISOString(),
      schema: { migrations, latestAt: await latestMigrationAt(query) },
      tables,
    }
  })
}

export type TableDigest = { count: number; md5: string }

export function tableDigests(query: Query): Promise<Record<string, TableDigest>> {
  return inTransaction(query, 'begin isolation level repeatable read read only', async () => {
    const digests: Record<string, TableDigest> = {}
    for (const table of await listTables(query)) {
      const [row] = await query(
        `select count(*)::int as count,
                md5(coalesce(string_agg(t::text, E'\\n' order by t::text), '')) as md5
         from public.${ident(table)} t`,
      )
      digests[table] = {
        count: Number(row?.count ?? 0),
        md5: typeof row?.md5 === 'string' ? row.md5 : '',
      }
    }
    return digests
  })
}

export class RestoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RestoreError'
  }
}

const CHUNK = 200

export async function restoreDatabase(
  query: Query,
  input: unknown,
): Promise<Record<string, number>> {
  const parsed = exportFileSchema.safeParse(input)
  if (!parsed.success) throw new RestoreError('not a Coach Study export (format or version)')
  const file = parsed.data
  const migrations = await appliedMigrations(query)
  if (JSON.stringify(migrations) !== JSON.stringify(file.schema.migrations)) {
    throw new RestoreError(
      `schema differs: the target has ${String(migrations.length)} migrations applied, the export ${String(file.schema.migrations.length)} (migrate the target to the export's version first)`,
    )
  }
  const tables = await listTables(query)
  const inFile = Object.keys(file.tables).toSorted()
  if (JSON.stringify(tables) !== JSON.stringify(inFile)) {
    throw new RestoreError('the target’s tables are not the export’s tables')
  }
  for (const table of tables) {
    const [row] = await query(`select exists (select 1 from public.${ident(table)}) as used`)
    if (row?.used === true) throw new RestoreError(`the target is not empty (${table} has rows)`)
  }

  return inTransaction(query, 'begin', async () => {
    const counts: Record<string, number> = {}
    for (const table of tables) {
      const rows = file.tables[table]?.rows ?? []
      for (let start = 0; start < rows.length; start += CHUNK) {
        await query(
          `insert into public.${ident(table)}
           select * from json_populate_recordset(null::public.${ident(table)}, $1::json)`,
          [JSON.stringify(rows.slice(start, start + CHUNK))],
        )
      }
    }
    await moveSequences(query)
    for (const table of tables) {
      const expected = file.tables[table]
      const rows = await tableRows(query, table)
      if (rows.length !== expected?.count || sha256(rows) !== expected.sha256) {
        throw new RestoreError(`${table} did not come back identical`)
      }
      counts[table] = rows.length
    }
    return counts
  })
}

async function moveSequences(query: Query): Promise<void> {
  const serials = await query(
    `select table_name::text as table_name, column_name::text as column_name,
            pg_get_serial_sequence(format('public.%I', table_name), column_name) as sequence
     from information_schema.columns
     where table_schema = 'public'
       and pg_get_serial_sequence(format('public.%I', table_name), column_name) is not null`,
  )
  for (const serial of serials) {
    const table = ident(String(serial.table_name))
    const column = ident(String(serial.column_name))
    await query(
      `select setval($1, coalesce((select max(${column}) from public.${table}), 1),
                     (select max(${column}) from public.${table}) is not null)`,
      [String(serial.sequence)],
    )
  }
}
