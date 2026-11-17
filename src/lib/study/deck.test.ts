import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { Rating, State } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'

import { loadBank, type Bank } from '@/lib/content/bank'
import { decideDifficulty } from '@/lib/scheduler/difficulty'
import { createScheduler, newCard } from '@/lib/scheduler/fsrs'
import type { QueuedCard } from '@/lib/scheduler/queue'
import { flatText } from '@/lib/text/lines'
import { at, DAY, MINUTE, T0 } from '@/test/study-fixtures'

import { cardViewSchema } from './contract'
import { buildDeck, cardCitation, cardView, dueInMs, loadDeck, loadPhotos } from './deck'

const fixed = createScheduler({ enableFuzz: false })
const deck = loadDeck()

function queued(itemId: string, overrides: Partial<QueuedCard> = {}): QueuedCard {
  const meta = deck.metaById.get(itemId)
  if (!meta) throw new Error(`no card ${itemId}`)
  return {
    kind: 'card',
    card: newCard(meta, T0),
    reason: 'new',
    format: 'free',
    hintFirst: false,
    decision: decideDifficulty([]),
    ...overrides,
  }
}

const withChoices = deck.bank.items.find((item) => item.choices && item.photoId === undefined)
const withParts = deck.bank.items.find((item) => item.parts !== undefined)
const fromVideo = deck.bank.items.find(
  (item) => cardCitation(deck.bank, item)?.label.startsWith('Video') === true,
)

describe('the shipped deck', () => {
  it('holds every accepted card, each with a citation and any photo it names', () => {
    const bank = loadBank()
    expect(deck.metas).toHaveLength(bank.items.length)
    expect(deck.metas.length).toBeGreaterThan(400)
    for (const item of bank.items) {
      expect(cardCitation(bank, item), item.id).not.toBeNull()
      if (item.photoId) expect(deck.photos.has(item.photoId), item.id).toBe(true)
    }
  })

  it('numbers new cards from 0 inside each category, in bank order', () => {
    const core = deck.metas.filter((meta) => meta.category === 'Floor work')
    expect(core.map((meta) => meta.position)).toEqual(core.map((_, index) => index))
    const groupB = deck.metas.find((meta) => meta.category === 'Standing work')
    expect(groupB?.position).toBe(0)
  })

  it('links a card to its exercise and marks the cards that ship choices', () => {
    const item = deck.bank.items.find((entry) => entry.exercise !== undefined && entry.choices)
    const meta = item ? deck.metaById.get(item.id) : undefined
    expect(meta).toMatchObject({ topic: item?.exercise, hasChoices: true, quarantined: false })
  })

  it('leaves out a card whose source passage is missing', () => {
    const bank = loadBank()
    const [first] = bank.items
    if (!first) throw new Error('empty bank')
    const broken: Bank = {
      ...bank,
      passages: new Map(
        [...bank.passages].filter(([id]) => !first.citations.some((c) => c.passageId === id)),
      ),
    }
    expect(buildDeck(broken, new Map()).metaById.has(first.id)).toBe(false)
    expect(cardCitation(broken, first)).toBeNull()
  })

  it('reads no photos from a folder without any', () => {
    expect(loadPhotos(mkdtempSync(path.join(tmpdir(), 'deck-')))).toEqual(new Map())
  })
})

describe('citationLabel', () => {
  it('shows the video time for a card cited from the training video', () => {
    expect(fromVideo).toBeDefined()
    if (fromVideo) expect(cardCitation(deck.bank, fromVideo)?.label).toMatch(/^Video \d:\d{2}$/)
  })
})

describe('cardView', () => {
  it('shows the card free, with its citation, as the contract says', () => {
    const item = deck.bank.items[0]
    if (!item) throw new Error('empty bank')
    const view = cardView(deck, queued(item.id), T0, 'seed', fixed)
    expect(cardViewSchema.parse(view)).toEqual(view)
    expect(view).toMatchObject({
      itemId: item.id,
      category: item.category,
      type: item.type,
      prompt: item.prompt,
      answer: item.answer,
      explanation: item.explanation,
      format: 'free',
      hintFirst: false,
    })
    expect(view.choices).toBeUndefined()

    const [citation] = item.citations
    expect(flatText(view.citation.quote).replace(/[’‘]/g, "'")).toContain(
      citation?.quote.replace(/[’‘]/g, "'"),
    )
    expect(view.citation.label).toMatch(/^Manual p\. \d+$/)
  })

  it('offers choices only when the queue asks for them, in a day-seeded order', () => {
    if (!withChoices?.choices) throw new Error('no card with choices')
    expect(cardView(deck, queued(withChoices.id), T0, 'seed', fixed).choices).toBeUndefined()
    const asked = queued(withChoices.id, { format: 'choices', hintFirst: true })
    const view = cardView(deck, asked, T0, 'study|2026-08-17', fixed)
    expect(view.format).toBe('choices')
    expect(view.hintFirst).toBe(true)
    expect(view.choices?.toSorted()).toEqual(withChoices.choices.toSorted())
    expect(cardView(deck, asked, T0, 'study|2026-08-17', fixed).choices).toEqual(view.choices)
    const orders = new Set(
      Array.from({ length: 12 }, (_, day) =>
        JSON.stringify(cardView(deck, asked, T0, `study|day-${String(day)}`, fixed).choices),
      ),
    )
    expect(orders.size).toBeGreaterThan(1)
  })

  it('passes a list card’s parts and whether order matters', () => {
    if (!withParts) throw new Error('no list card')
    const view = cardView(deck, queued(withParts.id), T0, 'seed', fixed)
    expect(view.parts).toEqual(withParts.parts)
    expect(view.ordered).toBe(withParts.ordered)
  })

  it('refuses a card that is not in the deck', () => {
    const stray = {
      ...queued(deck.metas[0]?.itemId ?? ''),
      card: newCard(
        { itemId: 'nope', category: 'Floor work', itemType: 'recall', position: 0 },
        T0,
      ),
    }
    expect(() => cardView(deck, stray, T0, 'seed', fixed)).toThrow(/not in the deck/)
  })
})

describe('dueInMs', () => {
  const meta = deck.metas[0]
  if (!meta) throw new Error('empty bank')

  it('previews each rating: Missed it in a minute, Got it in 10, Easy in days', () => {
    const [again, hard, good, easy] = dueInMs(newCard(meta, T0), T0, fixed)
    expect(again).toBe(MINUTE)
    expect(hard).toBeGreaterThan(again)
    expect(good).toBe(10 * MINUTE)
    expect(easy).toBeGreaterThanOrEqual(DAY)
  })

  it('previews from the last answer when this server’s clock is a little behind', () => {
    const reviewed = fixed.review(newCard(meta, T0), Rating.Good, at(5))
    expect(reviewed.card.fsrs.state).toBe(State.Learning)
    const preview = dueInMs(reviewed.card, T0, fixed)
    expect(preview[0]).toBe(MINUTE + 5)
  })
})
