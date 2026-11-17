import { describe, expect, it } from 'vitest'

import {
  databaseKind,
  devDatabaseProblem,
  devDatabaseUrl,
  envFileValue,
  productionUseProblem,
  testDatabaseProblem,
} from './guard'

const NEON =
  'postgresql://app:pw@ep-fake-pool-123456.us-east-2.aws.neon.tech/neondb?sslmode=require'
const OTHER_REMOTE = 'postgres://user:pw@db.example.invalid:5432/app'
const LOCAL = 'postgres://postgres:postgres@localhost:5432/coach_test'

describe('databaseKind', () => {
  it('tells PGlite, this machine, and anywhere else apart', () => {
    expect(databaseKind(undefined)).toBe('unset')
    expect(databaseKind('  ')).toBe('unset')
    expect(databaseKind('pglite://memory')).toBe('pglite')
    expect(databaseKind('pglite://.pglite-dev')).toBe('pglite')
    expect(databaseKind(LOCAL)).toBe('local')
    expect(databaseKind('postgresql://u@127.0.0.1/x')).toBe('local')
    expect(databaseKind('postgres://u@[::1]:5432/x')).toBe('local')
    expect(databaseKind(NEON)).toBe('remote')
    expect(databaseKind(OTHER_REMOTE)).toBe('remote')
    expect(databaseKind('${DATABASE_URL_UNPOOLED}')).toBe('unreadable')
    expect(databaseKind('mysql://u@localhost/x')).toBe('unreadable')
  })
})

describe('test runs (vitest, Playwright, audits)', () => {
  it('accept only PGlite or a Postgres on this machine', () => {
    for (const ok of [undefined, '', 'pglite://memory', 'pglite:///tmp/x', LOCAL]) {
      expect(testDatabaseProblem(ok)).toBeNull()
    }
    for (const bad of [NEON, OTHER_REMOTE, 'not a url']) {
      expect(testDatabaseProblem(bad)).toMatch(/never on production\./)
    }
  })

  it('name the production database without printing its URL or host', () => {
    const problem = testDatabaseProblem(NEON) ?? ''
    expect(problem).toMatch(/a Neon database \(neon\.tech\): the production database/)
    expect(problem).not.toMatch(/ep-fake|app:pw|neondb/)
    expect(testDatabaseProblem(OTHER_REMOTE)).toMatch(/a database that is not on this machine/)
    expect(testDatabaseProblem(OTHER_REMOTE)).not.toMatch(/example\.invalid/)
  })
})

describe('pnpm dev', () => {
  it('refuses a database off this machine unless ALLOW_PRODUCTION_DATABASE=1', () => {
    expect(devDatabaseProblem(NEON, {})).toMatch(/Local dev never uses the production database/)
    expect(devDatabaseProblem(NEON, { ALLOW_PRODUCTION_DATABASE: 'true' })).not.toBeNull()
    expect(devDatabaseProblem(NEON, { ALLOW_PRODUCTION_DATABASE: '1' })).toBeNull()
    expect(devDatabaseProblem('pglite://.pglite-dev', {})).toBeNull()
    expect(devDatabaseProblem(LOCAL, {})).toBeNull()
    expect(devDatabaseProblem(undefined, {})).toBeNull()
  })

  it('finds the URL the way next dev loads it: environment first, then the env files in order', () => {
    const files: Record<string, string> = {
      '.env.local': `# pulled from Vercel\nOTHER=1\nDATABASE_URL="${NEON}" # production\n`,
      '.env': 'DATABASE_URL=pglite://memory\n',
    }
    const read = (file: string) => files[file]
    expect(devDatabaseUrl({}, read)).toEqual({ url: NEON, from: '.env.local' })
    expect(devDatabaseUrl({ DATABASE_URL: 'pglite://memory' }, read)).toEqual({
      url: 'pglite://memory',
      from: 'the environment',
    })

    expect(devDatabaseUrl({ DATABASE_URL: '' }, read).from).toBe('.env.local')
    expect(devDatabaseUrl({}, () => undefined)).toEqual({ url: undefined, from: 'nowhere' })

    const opened: string[] = []
    devDatabaseUrl({ DATABASE_URL: LOCAL }, (file) => {
      opened.push(file)
      return undefined
    })
    expect(opened).toEqual([])
  })

  it('reads dotenv lines: export, quotes, comments, the last line wins', () => {
    expect(envFileValue('export DATABASE_URL=pglite://memory', 'DATABASE_URL')).toBe(
      'pglite://memory',
    )
    expect(envFileValue(`DATABASE_URL='${LOCAL}'`, 'DATABASE_URL')).toBe(LOCAL)
    expect(envFileValue('DATABASE_URL=pglite://a # note', 'DATABASE_URL')).toBe('pglite://a')
    expect(envFileValue('DATABASE_URL=pglite://a\nDATABASE_URL=pglite://b', 'DATABASE_URL')).toBe(
      'pglite://b',
    )
    expect(envFileValue('NOT_DATABASE_URL=x\n# DATABASE_URL=y', 'DATABASE_URL')).toBeUndefined()
  })
})

describe('migrations and the paid evals ledger', () => {
  it('reach production only in CI or with --production', () => {
    expect(productionUseProblem(NEON, {}, [], 'db:migrate')).toMatch(
      /db:migrate runs against it only in CI, or with --production/,
    )
    expect(productionUseProblem(NEON, { CI: 'true' }, [], 'db:migrate')).toBeNull()
    expect(productionUseProblem(NEON, { CI: '1' }, [], 'db:migrate')).toBeNull()
    expect(productionUseProblem(NEON, { CI: 'false' }, [], 'db:migrate')).not.toBeNull()
    expect(productionUseProblem(NEON, { CI: '', GITHUB_ACTIONS: 'true' }, [], 'x')).toBeNull()
    expect(productionUseProblem(NEON, {}, ['--production'], 'db:migrate')).toBeNull()
    expect(productionUseProblem(LOCAL, {}, [], 'db:migrate')).toBeNull()
    expect(productionUseProblem(undefined, {}, [], 'audit:grader')).toBeNull()
  })
})
