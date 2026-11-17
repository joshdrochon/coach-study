// Refuses to run tests, dev or scripts against a production database by accident.

export type DatabaseKind = 'unset' | 'pglite' | 'local' | 'remote' | 'unreadable'

export const ALLOW_PRODUCTION_DATABASE = 'ALLOW_PRODUCTION_DATABASE'

export const PRODUCTION_ARG = '--production'

const LOOPBACK = new Set(['', 'localhost', '127.0.0.1', '[::1]', '::1'])

type Env = Readonly<Record<string, string | undefined>>

function postgresHost(value: string): string | undefined {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') return undefined
    return parsed.hostname.toLowerCase()
  } catch {
    return undefined
  }
}

export function databaseKind(url: string | undefined): DatabaseKind {
  const value = url?.trim() ?? ''
  if (value === '') return 'unset'
  if (value.startsWith('pglite:')) return 'pglite'
  const host = postgresHost(value)
  if (host === undefined) return 'unreadable'
  return LOOPBACK.has(host) ? 'local' : 'remote'
}

function onThisMachine(kind: DatabaseKind): boolean {
  return kind === 'unset' || kind === 'pglite' || kind === 'local'
}

function where(url: string | undefined): string {
  const kind = databaseKind(url)
  if (kind === 'unreadable') return 'something that is not a Postgres or PGlite URL'
  if (kind !== 'remote') return 'a database on this machine'
  const host = postgresHost(url?.trim() ?? '') ?? ''
  return host === 'neon.tech' || host.endsWith('.neon.tech')
    ? 'a Neon database (neon.tech): the production database'
    : 'a database that is not on this machine'
}

export function inCi(env: Env): boolean {
  return env.CI === 'true' || env.CI === '1' || env.GITHUB_ACTIONS === 'true'
}

export function testDatabaseProblem(url: string | undefined): string | null {
  if (onThisMachine(databaseKind(url))) return null
  return `DATABASE_URL points at ${where(url)}. Tests and audits run only on pglite://memory, pglite://<dir> or a Postgres on this machine (localhost), never on production. Unset DATABASE_URL or set it to pglite://memory.`
}

export function devDatabaseProblem(url: string | undefined, env: Env): string | null {
  if (onThisMachine(databaseKind(url))) return null
  if (env[ALLOW_PRODUCTION_DATABASE] === '1') return null
  return `DATABASE_URL points at ${where(url)}. Local dev never uses the production database. Run DATABASE_URL=pglite://.pglite-dev pnpm dev (a local database, gitignored), or set ${ALLOW_PRODUCTION_DATABASE}=1 if you really mean to.`
}

export function productionUseProblem(
  url: string | undefined,
  env: Env,
  args: readonly string[],
  what: string,
): string | null {
  if (onThisMachine(databaseKind(url))) return null
  if (inCi(env) || args.includes(PRODUCTION_ARG)) return null
  return `DATABASE_URL points at ${where(url)}. ${what} runs against it only in CI, or with ${PRODUCTION_ARG}.`
}

export const DEV_ENV_FILES = ['.env.development.local', '.env.local', '.env.development', '.env']

export function envFileValue(text: string, key: string): string | undefined {
  let found: string | undefined
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][\w.-]*)\s*=\s*(.*)$/.exec(line)
    if (match?.[1] !== key) continue
    let value = (match[2] ?? '').trim()
    const quote = value[0]
    if (quote === '"' || quote === "'" || quote === '`') {
      const end = value.indexOf(quote, 1)
      value = end > 0 ? value.slice(1, end) : value.slice(1)
    } else {
      value = value.replace(/\s+#.*$/, '').trim()
    }

    found = value
  }
  return found
}

export function devDatabaseUrl(
  env: Env,
  read: (file: string) => string | undefined,
): { url: string | undefined; from: string } {
  if (env.DATABASE_URL) return { url: env.DATABASE_URL, from: 'the environment' }
  for (const file of DEV_ENV_FILES) {
    const text = read(file)
    if (text === undefined) continue
    const url = envFileValue(text, 'DATABASE_URL')
    if (url !== undefined) return { url, from: file }
  }
  return { url: undefined, from: 'nowhere' }
}
