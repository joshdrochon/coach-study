import 'server-only'

// The deck: accepted cards from the content bank, with the citation each one shows.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

import { cardSource, citationsFor, loadBank, type Bank } from '../content/bank'
import { sourceLabel } from '../content/citations'
import type { Item, Passage } from '../content/schema'
import { defaultScheduler, type Scheduler } from '../scheduler/fsrs'
import type { QueuedCard } from '../scheduler/queue'

import { toCardView } from './card-view'
import type { CardView, DeckCard } from './contract'
import type { ItemMeta } from './replay'

export { dueInMs } from './card-view'

export const photoSchema = z.object({
  id: z.string().min(1),
  page: z.number().int().positive(),
  exercise: z.string().optional(),
  alt: z.string(),
})
export type Photo = z.infer<typeof photoSchema>
const photoFileSchema = z.object({ photos: z.array(photoSchema) })

export type Deck = {
  bank: Bank

  metas: ItemMeta[]
  metaById: Map<string, ItemMeta>
  photos: Map<string, Photo>
}

const CONTENT_ROOT = path.join(process.cwd(), 'content')

export function loadPhotos(root: string = CONTENT_ROOT): Map<string, Photo> {
  const dir = path.join(root, 'photos')
  const photos = new Map<string, Photo>()
  if (!existsSync(dir)) return photos
  for (const name of readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()) {
    const file: unknown = JSON.parse(readFileSync(path.join(dir, name), 'utf8'))
    for (const photo of photoFileSchema.parse(file).photos) photos.set(photo.id, photo)
  }
  return photos
}

export function buildDeck(bank: Bank, photos: Map<string, Photo>): Deck {
  const perCategory = new Map<string, number>()
  const metas: ItemMeta[] = []
  for (const item of bank.items) {
    if (citationsFor(bank, item).length === 0) continue
    const position = perCategory.get(item.category) ?? 0
    perCategory.set(item.category, position + 1)
    metas.push({
      itemId: item.id,
      category: item.category,
      itemType: item.type,
      topic: item.exercise ?? null,
      hasChoices: (item.choices?.length ?? 0) > 0,
      position,
      quarantined: false,
    })
  }
  return { bank, metas, metaById: new Map(metas.map((meta) => [meta.itemId, meta])), photos }
}

let cached: Deck | undefined

export function loadDeck(): Deck {
  cached ??= buildDeck(loadBank(), loadPhotos())
  return cached
}

export function citationLabel(passage: Passage): string {
  return sourceLabel(passage)
}

export function cardCitation(bank: Bank, item: Item): CardView['citation'] | null {
  const source = cardSource(bank, item)
  return source ? { label: source.label, quote: source.layout } : null
}

export function deckCard(deck: Deck, itemId: string): DeckCard | null {
  const item = deck.bank.byId.get(itemId)
  const meta = deck.metaById.get(itemId)
  const citation = item ? cardCitation(deck.bank, item) : null
  if (!item || !meta || !citation) return null
  const photo = item.photoId === undefined ? undefined : deck.photos.get(item.photoId)
  return {
    itemId: item.id,
    category: item.category,
    type: item.type,
    prompt: item.prompt,
    ...(item.choices ? { choices: item.choices } : {}),
    ...(item.parts ? { parts: item.parts } : {}),
    ...(item.ordered === undefined ? {} : { ordered: item.ordered }),
    answer: item.answer,
    explanation: item.explanation,
    citation,
    ...(photo ? { photo: { src: `/api/media/${photo.id}`, alt: photo.alt } } : {}),
    ...(item.exercise ? { exercise: item.exercise } : {}),
    position: meta.position,
  }
}

export function deckCards(deck: Deck): DeckCard[] {
  return deck.metas.flatMap((meta) => deckCard(deck, meta.itemId) ?? [])
}

export function cardView(
  deck: Deck,
  queued: QueuedCard,
  now: Date,
  seed: string,
  scheduler: Scheduler = defaultScheduler,
): CardView {
  const card = deckCard(deck, queued.card.itemId)
  if (!card) throw new Error(`card ${queued.card.itemId} is not in the deck`)
  return toCardView(card, queued, now, seed, scheduler)
}
