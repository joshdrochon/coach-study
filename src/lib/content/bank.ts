import 'server-only'

// Loads cards, passages and reviews from content/. Only cards accepted in review
// make it into the bank.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { displayedCitation, passageRuns, type CitationSource, type PassageRuns } from './citations'
import { acceptedIds } from './reviews'
import {
  itemFileSchema,
  passageFileSchema,
  passageRunsFileSchema,
  reviewFileSchema,
  type Item,
  type Passage,
} from './schema'

export type Bank = {
  items: Item[]
  byId: Map<string, Item>
  passages: Map<string, Passage>

  runs: PassageRuns
}

let cached: Bank | undefined

function jsonFiles(dir: string): unknown[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name): unknown => JSON.parse(readFileSync(path.join(dir, name), 'utf8')))
}

export function loadBank(root: string = path.join(process.cwd(), 'content')): Bank {
  if (cached && root === path.join(process.cwd(), 'content')) return cached
  const accepted = acceptedIds(
    jsonFiles(path.join(root, 'reviews')).flatMap((file) =>
      reviewFileSchema.parse(file).reviews.map((review) => ({ ...review, id: review.itemId })),
    ),
  )
  const items = jsonFiles(path.join(root, 'items'))
    .flatMap((file) => itemFileSchema.parse(file).items)
    .filter((item) => accepted.has(item.id))
  const passages = new Map<string, Passage>()
  for (const file of jsonFiles(path.join(root, 'passages'))) {
    for (const passage of passageFileSchema.parse(file).passages) passages.set(passage.id, passage)
  }
  const runsFile = path.join(root, 'passage-runs.json')
  const runs = passageRuns(
    existsSync(runsFile)
      ? passageRunsFileSchema.parse(JSON.parse(readFileSync(runsFile, 'utf8'))).runs
      : [],
  )
  const bank = { items, byId: new Map(items.map((item) => [item.id, item])), passages, runs }
  if (root === path.join(process.cwd(), 'content')) cached = bank
  return bank
}

export function citationsFor(bank: Bank, item: Item): { passage: Passage; quote: string }[] {
  return item.citations.flatMap((c) => {
    const passage = bank.passages.get(c.passageId)
    return passage ? [{ passage, quote: c.quote }] : []
  })
}

export function cardSource(bank: Bank, item: Item): CitationSource | null {
  return displayedCitation(item.citations, bank.passages, bank.runs)
}
