import { z } from 'zod'

import data from '../../../content/method/glossary.json'

// The source's own definitions, as data (content/method/glossary.json). The grader is told them
// so it reads a card's terms the way the source defines them.
export const glossaryEntrySchema = z.strictObject({
  term: z.string().min(1),
  means: z.string().min(1),
  page: z.number().int().positive(),
  passageIds: z.array(z.string().min(1)).min(1),
  quote: z.string().min(1),
})
export type GlossaryEntry = z.infer<typeof glossaryEntrySchema>

export const glossaryFileSchema = z.strictObject({ entries: z.array(glossaryEntrySchema) })

export const GLOSSARY: readonly GlossaryEntry[] = glossaryFileSchema.parse(data).entries

export function glossaryBlock(entries: readonly GlossaryEntry[] = GLOSSARY): string {
  return [
    "GLOSSARY: the source's own definitions (term = what it means, page).",
    ...entries.map((entry) => `- ${entry.term} = ${entry.means} (page ${String(entry.page)})`),
  ].join('\n')
}

const words = (text: string): string =>
  ` ${text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9']+/g, ' ')
    .trim()} `

export function glossaryFor(
  cardText: string,
  entries: readonly GlossaryEntry[] = GLOSSARY,
): string[] {
  const text = words(cardText)
  return entries
    .filter((entry) => text.includes(words(entry.term)))
    .map((entry) => `${entry.term} ${entry.means} ${entry.quote}`)
}
