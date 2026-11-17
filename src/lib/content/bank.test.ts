import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import nextConfig from '../../../next.config'

import { loadBank } from './bank'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const item = (id: string) => ({
  id,
  category: 'Floor work',
  type: 'recall',
  prompt: 'What color is the test card?',
  answer: 'Teal.',
  explanation: 'A card made up for this test.',
  citations: [{ passageId: 'm005-x', quote: 'teal' }],
})

const review = (itemId: string, verdict: 'accepted' | 'rejected', round: number) => ({
  itemId,
  verdict,
  reason: '',
  round,
})

function bankWith(reviewFiles: Record<string, ReturnType<typeof review>[]>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'bank-'))
  roots.push(root)
  for (const dir of ['items', 'reviews', 'passages']) mkdirSync(path.join(root, dir))
  const ids = ['kept', 'rejected-later', 'accepted-later', 'unreviewed']
  writeFileSync(
    path.join(root, 'items', 'sample.json'),
    JSON.stringify({ category: 'Floor work', items: ids.map(item) }),
  )
  for (const [name, reviews] of Object.entries(reviewFiles)) {
    writeFileSync(path.join(root, 'reviews', name), JSON.stringify({ category: 'Floor work', reviews }))
  }
  writeFileSync(path.join(root, 'passages', 'sample.json'), JSON.stringify({ passages: [] }))
  return root
}

describe('loadBank', () => {
  it('ships only cards whose latest review accepted them, whichever file recorded it', () => {

    const root = bankWith({
      'a-recheck.json': [review('rejected-later', 'rejected', 2), review('accepted-later', 'accepted', 2)],
      'sample.json': [
        review('kept', 'accepted', 1),
        review('rejected-later', 'accepted', 1),
        review('accepted-later', 'rejected', 1),
      ],
    })
    const bank = loadBank(root)
    expect(bank.items.map((card) => card.id)).toEqual(['kept', 'accepted-later'])
    expect(bank.byId.has('rejected-later')).toBe(false)
    expect(bank.byId.has('unreviewed')).toBe(false)
  })
})

describe('the passage runs their citations read across', () => {
  it('reads content/passage-runs.json, and none without it', () => {
    const root = bankWith({ 'sample.json': [review('kept', 'accepted', 1)] })
    expect(loadBank(root).runs.size).toBe(0)
    writeFileSync(path.join(root, 'passage-runs.json'), JSON.stringify({ runs: [['m005-a', 'm005-b']] }))
    expect(loadBank(root).runs.get('m005-b')).toEqual(['m005-a', 'm005-b'])
  })

  it('ships the runs file with every route that ships the passages', () => {
    const traced = Object.entries(nextConfig.outputFileTracingIncludes ?? {}).filter(([, files]) =>
      files.includes('./content/passages/**'),
    )
    expect(traced.length).toBeGreaterThan(0)
    for (const [route, files] of traced) {
      expect(files, route).toContain('./content/passage-runs.json')
    }
  })
})
