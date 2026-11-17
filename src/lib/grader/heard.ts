// Speech-recognition corrections. The model may read a misheard word as the word the learner
// meant, but only when the two sound alike and the change doesn't flip a direction
// or a negation.

import { doubleMetaphone } from 'double-metaphone'
import { z } from 'zod'

import { plainPunctuation } from '../text/punctuation'
import type { AnswerEntry } from '../study/entry'

export { ANSWER_ENTRIES, type AnswerEntry } from '../study/entry'

export const correctionSchema = z.object({
  heard: z.string(),

  readAs: z.string(),
})
export type Correction = z.infer<typeof correctionSchema>

export const MAX_CORRECTIONS = 5
const MAX_CORRECTION_CHARS = 60

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function locate(answer: string, heard: string, taken: readonly [number, number][]): number {
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}'’])${escape(heard)}(?![\\p{L}\\p{N}'’])`, 'giu')
  for (const match of answer.matchAll(pattern)) {
    const start = match.index
    const end = start + match[0].length
    if (taken.every(([a, b]) => end <= a || start >= b)) return start
  }
  return -1
}

const POLARITY = new Set([
  'in',
  'into',
  'inside',
  'out',
  'outside',
  'up',
  'down',
  'on',
  'onto',
  'off',
  'left',
  'right',
  'over',
  'under',
  'above',
  'below',
  'front',
  'behind',
  'ahead',
  'toward',
  'towards',
  'away',
  'open',
  'opened',
  'close',
  'closed',
  'inner',
  'outer',
  'forward',
  'forwards',
  'backward',
  'backwards',
  'not',
  'no',
  'never',
  'none',
  'nor',
  'without',
])

const NUMBER_WORDS: Readonly<Record<string, string>> = {
  '0': 'zero',
  '1': 'one',
  '2': 'two',
  '3': 'three',
  '4': 'four',
  '5': 'five',
  '6': 'six',
  '7': 'seven',
  '8': 'eight',
  '9': 'nine',
  '10': 'ten',
  '12': 'twelve',
  '15': 'fifteen',
}

const tokens = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .trim()
    .split(' ')
    .filter((w) => w !== '')
    .map((w) => (w.endsWith("n't") ? 'not' : w))

function keys(word: string): string[] {
  const spoken = NUMBER_WORDS[word] ?? word
  return [...new Set(doubleMetaphone(spoken).map((key) => key.replace(/NT$/, 'N')))]
}

function distance(a: string, b: string): number {
  const table = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= a.length; i++) {
    const row = table[i] ?? []
    const prev = table[i - 1] ?? []
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
  }
  return table[a.length]?.[b.length] ?? 0
}

function spanKeys(words: readonly string[]): string[] {
  let joined = ['']
  for (const word of words) joined = joined.flatMap((head) => keys(word).map((k) => head + k))
  return [...new Set([...joined, ...keys(words.map((w) => NUMBER_WORDS[w] ?? w).join(''))])]
}

const MAX_SPAN_WORDS = 3

function closeInSound(said: readonly string[], read: readonly string[]): boolean {
  const a = spanKeys(said)
  const b = spanKeys(read)
  let gap = Infinity
  for (const x of a) for (const y of b) gap = Math.min(gap, distance(x, y))
  const longest = Math.max(...a.map((k) => k.length), ...b.map((k) => k.length))
  if (longest <= 1) return gap === 0
  return gap <= Math.max(1, Math.floor(longest / 4))
}

const polarityOf = (words: readonly string[]) =>
  words
    .filter((w) => POLARITY.has(w))
    .sort()
    .join(' ')

// Phonetic comparison (double metaphone), phrase to phrase, ignoring words both share.
export function soundsAlike(heard: string, readAs: string): boolean {
  const said = tokens(heard)
  const read = tokens(readAs)
  if (said.length === 0 || read.length === 0) return false
  if (polarityOf(said) !== polarityOf(read)) return false

  let start = 0
  while (start < said.length && start < read.length && said[start] === read[start]) start++
  let end = 0
  while (
    end < said.length - start &&
    end < read.length - start &&
    said[said.length - 1 - end] === read[read.length - 1 - end]
  ) {
    end++
  }
  const saidSpan = said.slice(start, said.length - end)
  const readSpan = read.slice(start, read.length - end)

  if (saidSpan.length === 0 || readSpan.length === 0) return saidSpan.length === readSpan.length
  if (saidSpan.length > MAX_SPAN_WORDS || readSpan.length > MAX_SPAN_WORDS) return false
  if (Math.abs(saidSpan.length - readSpan.length) > 1) return false
  return closeInSound(saidSpan, readSpan)
}

type Placed = Correction & { start: number; end: number }

function place(answer: string, corrections: readonly Correction[], key?: CardWords): Placed[] {
  const placed: Placed[] = []
  for (const correction of corrections) {
    if (placed.length === MAX_CORRECTIONS) break
    const heard = correction.heard.trim()
    const raw = correction.readAs.trim()
    if (heard === '' || raw === '' || same(heard, raw)) continue
    if (!soundsAlike(heard, raw)) continue
    if (key !== undefined && !inKey(raw, key)) continue
    const readAs = plainPunctuation(raw)
    if (heard.length > MAX_CORRECTION_CHARS || readAs.length > MAX_CORRECTION_CHARS) continue
    const taken = placed.map((p): [number, number] => [p.start, p.end])
    const start = locate(answer, heard, taken)
    if (start === -1) continue
    placed.push({
      heard: answer.slice(start, start + heard.length),
      readAs,
      start,
      end: start + heard.length,
    })
  }
  return placed.sort((a, b) => a.start - b.start)
}

function words(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .trim()} `
}

export type CardWords = string | readonly string[]

export function correctionWords(item: {
  answer: string
  parts?: readonly string[] | undefined
  prompt?: string | undefined
}): string[] {
  const key = [item.answer, ...(item.parts ?? [])].join(' ')
  return item.prompt ? [key, item.prompt] : [key]
}

const inKey = (readAs: string, key: CardWords): boolean => {
  const read = words(readAs)
  if (read.trim() === '') return false
  const sources: readonly string[] = typeof key === 'string' ? [key] : key
  return sources.some((source) => words(source).includes(read))
}

export function reviewCorrections(
  corrections: readonly Correction[],
  answer: string,
  entry: AnswerEntry,
  key: CardWords,
): { kept: Correction[]; dropped: boolean } {
  const meaningful = corrections.filter(
    ({ heard, readAs }) => heard.trim() !== '' && readAs.trim() !== '' && !same(heard, readAs),
  )
  if (entry !== 'voice') return { kept: [], dropped: meaningful.length > 0 }
  const kept = place(answer, corrections, key).map(({ heard, readAs }) => ({ heard, readAs }))
  const dropped = meaningful.some(
    ({ heard, readAs }) =>
      heard.trim().length > MAX_CORRECTION_CHARS ||
      readAs.trim().length > MAX_CORRECTION_CHARS ||
      locate(answer, heard.trim(), []) === -1 ||
      !inKey(readAs, key) ||
      !soundsAlike(heard, readAs),
  )
  return { kept, dropped }
}

export function keptCorrections(
  corrections: readonly Correction[],
  answer: string,
  entry: AnswerEntry,
  key: CardWords,
): Correction[] {
  return reviewCorrections(corrections, answer, entry, key).kept
}

export type HeardPart = { text: string; heard?: string }

export function heardParts(answer: string, corrections: readonly Correction[]): HeardPart[] {
  const parts: HeardPart[] = []
  let at = 0
  for (const { start, end, readAs, heard } of place(answer, corrections)) {
    if (start > at) parts.push({ text: answer.slice(at, start) })
    parts.push({ text: readAs, heard })
    at = end
  }
  if (at < answer.length || parts.length === 0) parts.push({ text: answer.slice(at) })
  return parts
}
