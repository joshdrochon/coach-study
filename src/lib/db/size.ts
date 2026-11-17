import type { Query } from './backup'

const MB = 1024 * 1024

export const FREE_PLAN_BYTES = 512 * MB

export const WARN_FRACTION = 0.7
export const WARN_BYTES = FREE_PLAN_BYTES * WARN_FRACTION

export type DatabaseSize = {
  bytes: number

  clips: { rows: number; bytes: number }
}

export const DATABASE_SIZE_SQL = `select
  pg_database_size(current_database())::text as bytes,
  (select count(*) from tts_clips)::text as clip_rows,
  pg_total_relation_size('tts_clips')::text as clip_bytes`

export async function readDatabaseSize(query: Query): Promise<DatabaseSize> {
  const [row] = await query(DATABASE_SIZE_SQL)
  return {
    bytes: Number(row?.bytes ?? 0),
    clips: { rows: Number(row?.clip_rows ?? 0), bytes: Number(row?.clip_bytes ?? 0) },
  }
}

export function overWarnLine(bytes: number): boolean {
  return bytes >= WARN_BYTES
}

export function formatMb(bytes: number): string {
  return `${String(Math.ceil(bytes / MB - 1e-9))} MB`
}

export function planShare(bytes: number): string {
  return `${String(Math.ceil((bytes / FREE_PLAN_BYTES) * 100 - 1e-9))}%`
}

export function sizeSummary(size: DatabaseSize): string {
  return `database ${formatMb(size.bytes)} of ${formatMb(FREE_PLAN_BYTES)} (${planShare(size.bytes)}), voice clips ${String(size.clips.rows)} rows, ${formatMb(size.clips.bytes)}`
}

export function sizeWarning(bytes: number): string | null {
  return overWarnLine(bytes)
    ? `The database is past 70% of the ${formatMb(FREE_PLAN_BYTES)} free plan (${formatMb(bytes)}, ${planShare(bytes)}).`
    : null
}
