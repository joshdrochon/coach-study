import { CATEGORIES, type Category, type Item, type Passage } from '@/lib/content/schema'

import { cardCount } from './copy'

export type CategoryChoice = { name: Category; detail: string }

const DRAWN: Category[] = ['Floor work', 'Standing work', 'Glossary', 'Coaching voice']
const EXERCISE_FAMILIES = new Set<Category>([
  'Floor work',
  'Standing work',
  'Balance work',
  'Stretch work',
])

const DESCRIBED: Partial<Record<Category, string>> = {
  'Coaching voice': 'Sample cues and timing',
}

export function categoryChoices(
  items: Item[],
  passages: ReadonlyMap<string, Passage>,
): CategoryChoice[] {
  const order = [...DRAWN, ...CATEGORIES.filter((category) => !DRAWN.includes(category))]
  return order.flatMap((category) => {
    const cards = items.filter((item) => item.category === category)
    if (cards.length === 0) return []
    const described = DESCRIBED[category]
    if (described) return [{ name: category, detail: described }]
    const pages = cards.flatMap((item) =>
      item.citations.flatMap((citation) => {
        const passage = passages.get(citation.passageId)
        return passage?.kind === 'manual' ? [passage.page] : []
      }),
    )
    const page = pages.length > 0 ? `Manual p. ${String(Math.min(...pages))}` : null
    const exercises = new Set(cards.flatMap((item) => (item.exercise ? [item.exercise] : []))).size
    const counted =
      EXERCISE_FAMILIES.has(category) && exercises > 0
        ? `${String(exercises)} ${exercises === 1 ? 'exercise' : 'exercises'}`
        : null
    const detail = [counted, page].filter((part) => part !== null).join(' · ')
    return [{ name: category, detail: detail === '' ? cardCount(cards.length) : detail }]
  })
}
