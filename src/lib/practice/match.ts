import { normalize } from '../speech/keyterms'

// A spoken word with the time it was heard, relative to the start of the practice.
export type Word = { text: string; atMs: number }

// One token per normalized word, keeping the index of the word it came from, so a match can be
// quoted back in their own words and placed in time.
type Token = { token: string; word: number }

export type Hit = { phrase: string; from: number; to: number }

function tokenize(words: readonly Word[]): Token[] {
  return words.flatMap((word, index) =>
    normalize(word.text)
      .split(' ')
      .filter(Boolean)
      .map((token) => ({ token, word: index })),
  )
}

// Plural and singular forms match each other ("rail" and "rails").
const same = (a: string, b: string) => a === b || a === `${b}s` || b === `${a}s`

// Every place a phrase is said, as word index ranges, earliest first.
export function findPhrase(words: readonly Word[], phrase: string): Hit[] {
  const needle = normalize(phrase).split(' ').filter(Boolean)
  if (needle.length === 0) return []
  const tokens = tokenize(words)
  const hits: Hit[] = []
  for (let i = 0; i + needle.length <= tokens.length; i++) {
    if (needle.every((part, k) => same(tokens[i + k]?.token ?? '', part))) {
      const first = tokens[i]
      const last = tokens[i + needle.length - 1]
      if (first && last) hits.push({ phrase, from: first.word, to: last.word })
    }
  }
  return hits
}

// The earliest hit of any phrase of a group that starts at or after `from`.
export function firstOf(words: readonly Word[], phrases: readonly string[], from = 0): Hit | null {
  let best: Hit | null = null
  for (const phrase of phrases) {
    const hit = findPhrase(words, phrase).find((h) => h.from >= from)
    if (hit && (best === null || hit.from < best.from)) best = hit
  }
  return best
}

export function quoteOf(words: readonly Word[], hit: Pick<Hit, 'from' | 'to'>): string {
  return words
    .slice(hit.from, hit.to + 1)
    .map((word) => word.text)
    .join(' ')
}

// Typed practice has no timings: words are spread evenly so time windows still make sense.
export const TYPED_WORD_MS = 400

export function typedWords(text: string, startMs = 0): Word[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => ({ text: word.slice(0, 80), atMs: startMs + index * TYPED_WORD_MS }))
}
