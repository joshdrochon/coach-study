import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx')
const NEON =
  'postgresql://app:pw@ep-fake-pool-123456.us-east-2.aws.neon.tech/neondb?sslmode=require'

const RESULTS = mkdtempSync(path.join(tmpdir(), 'guard-results-'))

afterAll(() => {
  rmSync(RESULTS, { recursive: true, force: true })
})

function run(args: string[], env: Record<string, string>): { code: number | null; output: string } {
  const base: NodeJS.ProcessEnv = { ...process.env }
  delete base.CI
  delete base.GITHUB_ACTIONS
  delete base.ALLOW_PRODUCTION_DATABASE
  const result = spawnSync(TSX, args, {
    cwd: ROOT,
    env: { ...base, AUDIT_RESULTS_DIR: RESULTS, ...env },
    encoding: 'utf8',
    timeout: 60_000,
  })
  return { code: result.status, output: `${result.stdout}${result.stderr}` }
}

const VITEST = `import('vitest/node').then(async ({ startVitest }) => {
  const vitest = await startVitest('test', ['src/lib/db/guard.test.ts'], { watch: false, reporters: ['dot'] })
  await vitest?.close()
  process.exit(process.exitCode ?? 0)
}, (error) => { console.error(error.message); process.exit(4) })`

describe('the production database guard at each entry point', () => {
  it('vitest refuses to start on it', () => {
    const refused = run(['--eval', VITEST], { DATABASE_URL: NEON })
    expect(refused.code).not.toBe(0)
    expect(refused.output).toMatch(/vitest refused: DATABASE_URL points at a Neon database/)
    expect(refused.output).not.toMatch(/ep-fake/)
    expect(refused.output).not.toMatch(/Tests\s+\d+ passed/)
  })

  it('pnpm dev refuses it unless ALLOW_PRODUCTION_DATABASE=1', () => {
    const refused = run(['scripts/db/dev-guard.ts'], { DATABASE_URL: NEON })
    expect(refused.code).toBe(1)
    expect(refused.output).toMatch(
      /pnpm dev refused: .*\(DATABASE_URL came from the environment\.\)/,
    )
    expect(refused.output).not.toMatch(/ep-fake/)
    const allowed = { DATABASE_URL: NEON, ALLOW_PRODUCTION_DATABASE: '1' }
    expect(run(['scripts/db/dev-guard.ts'], allowed).code).toBe(0)
    expect(run(['scripts/db/dev-guard.ts'], { DATABASE_URL: 'pglite://memory' }).code).toBe(0)
  })

  it('db:migrate refuses it outside CI without --production', () => {
    const refused = run(['scripts/db/migrate.ts'], { DATABASE_URL: NEON })
    expect(refused.code).toBe(1)
    expect(refused.output).toMatch(/db:migrate refused: .*only in CI, or with --production/)
  })
})
