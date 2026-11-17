// Runs before pnpm dev and stops it if the dev database is a production one.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { devDatabaseProblem, devDatabaseUrl } from '../../src/lib/db/guard'

const root = path.resolve(import.meta.dirname, '..', '..')
const { url, from } = devDatabaseUrl(process.env, (file) => {
  const full = path.join(root, file)
  return existsSync(full) ? readFileSync(full, 'utf8') : undefined
})
const problem = devDatabaseProblem(url, process.env)
if (problem) {
  console.error(`pnpm dev refused: ${problem} (DATABASE_URL came from ${from}.)`)
  process.exitCode = 1
}
