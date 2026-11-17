import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  packageManager: string
}
const workflows = ['ci.yml'].map((name) => ({
  name,
  text: readFileSync(path.join(ROOT, '.github', 'workflows', name), 'utf8'),
}))

describe('supply chain', () => {
  it('pins every dependency to an exact version', () => {
    const all = { ...pkg.dependencies, ...pkg.devDependencies }
    const loose = Object.entries(all).filter(
      ([, version]) => !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version),
    )
    expect(loose).toEqual([])
    expect(pkg.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+/)
  })

  it('commits the lockfile', () => {
    expect(existsSync(path.join(ROOT, 'pnpm-lock.yaml'))).toBe(true)
  })

  it('installs only from the lockfile in every workflow that installs', () => {
    for (const { name, text } of workflows) {
      const installs = [...text.matchAll(/pnpm install\b[^\n]*/g)].map((m) => m[0])
      for (const install of installs) expect(install, name).toContain('--frozen-lockfile')
    }
  })

  it('audits the dependencies on every push', () => {
    const ci = workflows.find((w) => w.name === 'ci.yml')?.text ?? ''
    expect(ci).toMatch(/^on:[\s\S]*?\bpush\b/m)
    expect(ci).toMatch(/- run: pnpm audit --prod --audit-level=high/)
  })
})
