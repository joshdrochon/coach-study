// pnpm db:prune-clips: finds stored voice clips no current line can use. A dry run by
// default; --apply deletes them.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { databaseKind, envFileValue } from '../../src/lib/db/guard'
import { SPOKEN_VERSION } from '../../src/lib/tts/spoken'
import { clipId, voiceKey } from '../../src/lib/tts/clips'
import { ttsLine } from '../../src/lib/tts/line'
import { loadBank } from '../../src/lib/content/bank'

import { argValue, connect, type Connection } from './connect'

export type ClipRow = { id: string; voiceKey: string; bytes: number }

export type Live = {
  voiceKey: string

  current: ReadonlySet<string>

  earlier: ReadonlyMap<string, number>
}

export type Verdict = { keep: true; why: 'live' | 'unplaced' } | { keep: false; reason: string }

export function judge(row: ClipRow, live: Live): Verdict {
  if (row.voiceKey !== live.voiceKey) {
    return {
      keep: false,
      reason: `voice key ${row.voiceKey.slice(0, 8)} (other voice, model, settings or format)`,
    }
  }
  if (live.current.has(row.id)) return { keep: true, why: 'live' }
  const version = live.earlier.get(row.id)
  if (version !== undefined) {
    const reason =
      version === 0 ? 'old id format (no spoken version)' : `old spoken version ${String(version)}`
    return { keep: false, reason }
  }
  return { keep: true, why: 'unplaced' }
}

function legacyId(line: string): string {
  return createHash('sha256').update(`${voiceKey()}\n${line}`).digest('hex')
}

function bankLines(): string[] {
  return loadBank().items.flatMap((item) => [item.prompt, item.answer, item.explanation])
}

export function liveClips(lines: readonly string[] = bankLines()): Live {
  const key = voiceKey()
  const spoken = [...new Set(lines.map((text) => ttsLine(text)).filter((line) => line !== ''))]
  const current = new Set(spoken.map((line) => clipId(line, undefined, SPOKEN_VERSION)))

  const written = lines.map((text) => text.replace(/\s+/g, ' ').trim()).filter((l) => l !== '')
  const candidates = [...new Set([...spoken, ...written])]
  const earlier = new Map<string, number>()
  for (let version = SPOKEN_VERSION - 1; version >= 0; version--) {
    for (const line of candidates) {
      const id = version === 0 ? legacyId(line) : clipId(line, undefined, version)
      if (!current.has(id)) earlier.set(id, version)
    }
  }
  return { voiceKey: key, current, earlier }
}

export type Summary = {
  rows: number
  bytes: number
  stale: number
  staleBytes: number
  keptUnplaced: number

  reasons: Map<string, { rows: number; bytes: number }>
  staleIds: string[]
}

export function summarize(rows: readonly ClipRow[], live: Live): Summary {
  const summary: Summary = {
    rows: rows.length,
    bytes: 0,
    stale: 0,
    staleBytes: 0,
    keptUnplaced: 0,
    reasons: new Map(),
    staleIds: [],
  }
  for (const row of rows) {
    summary.bytes += row.bytes
    const verdict = judge(row, live)
    if (verdict.keep) {
      if (verdict.why === 'unplaced') summary.keptUnplaced++
      continue
    }
    summary.stale++
    summary.staleBytes += row.bytes
    summary.staleIds.push(row.id)
    const entry = summary.reasons.get(verdict.reason) ?? { rows: 0, bytes: 0 }
    entry.rows++
    entry.bytes += row.bytes
    summary.reasons.set(verdict.reason, entry)
  }
  return summary
}

const MB = 1024 * 1024
export const mb = (bytes: number): string => `${(bytes / MB).toFixed(1)} MB`

export function report(label: string, s: Summary): string[] {
  const lines = [
    `${label}: total ${String(s.rows)} rows, ${mb(s.bytes)} of audio`,
    `${label}: stale ${String(s.stale)} rows, ${mb(s.staleBytes)}`,
    `${label}: kept ${String(s.rows - s.stale)} rows, ${mb(s.bytes - s.staleBytes)} (of their ${String(s.keptUnplaced)} unplaced: live voice key, not a line this tool can name)`,
  ]
  for (const [reason, r] of [...s.reasons].sort((a, b) => b[1].rows - a[1].rows)) {
    lines.push(`${label}:   ${reason}: ${String(r.rows)} rows, ${mb(r.bytes)}`)
  }
  return lines
}

async function readRows(query: Connection['query']): Promise<ClipRow[]> {
  const rows = await query(
    'select id, voice_key, octet_length(audio)::text as bytes from tts_clips order by id',
  )
  return rows.map((r) => ({
    id: String(r.id),
    voiceKey: String(r.voice_key),
    bytes: Number(r.bytes),
  }))
}

export async function prune(
  db: Connection,
  options: { apply: boolean; live?: Live },
): Promise<string[]> {
  const live = options.live ?? liveClips()
  const out: string[] = []
  const before = summarize(await readRows(db.query), live)
  if (!options.apply) {
    out.push(
      ...report('db:prune-clips', before),
      'db:prune-clips: dry run, nothing deleted (--apply deletes the stale rows)',
    )
    return out
  }
  await db.query('begin')
  try {
    const inside = summarize(await readRows(db.query), live)
    if (inside.staleIds.length > 0) {
      await db.query('delete from tts_clips where id = any($1::text[])', [inside.staleIds])
    }
    await db.query('commit')
  } catch (error) {
    await db.query('rollback')
    throw error
  }
  out.push(...report('before', before))
  out.push(...report('after', summarize(await readRows(db.query), live)))
  return out
}

function databaseUrl(args: readonly string[]): string | undefined {
  const envFile = argValue(args, '--env-file')
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  if (envFile === undefined) return undefined
  return envFileValue(readFileSync(path.resolve(envFile), 'utf8'), 'DATABASE_URL')
}

if (process.argv[1] === import.meta.filename) {
  const args = process.argv.slice(2)
  const url = databaseUrl(args)
  if (!url) {
    console.error('db:prune-clips: DATABASE_URL is not set (the environment, or --env-file <file>)')
    process.exit(2)
  }
  console.log(
    `db:prune-clips: a ${databaseKind(url)} database, spoken version ${String(SPOKEN_VERSION)}, voice key ${voiceKey().slice(0, 8)}`,
  )
  const db = await connect(url)
  try {
    for (const line of await prune(db, { apply: args.includes('--apply') })) console.log(line)
  } finally {
    await db.close()
  }
}
