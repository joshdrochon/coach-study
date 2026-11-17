// Voice test scoring: did recognition get the key terms of each sentence right.

import { z } from 'zod'

export const keyTermSchema = z.object({
  term: z.string().min(1),
  accept: z.array(z.string().min(1)).min(1),
})
export const sentenceSchema = z.object({
  id: z.string(),
  page: z.number().int().positive(),
  category: z.string(),
  text: z.string().min(1),
  keyTerms: z.array(keyTermSchema).min(1),
})
export const voiceTestSchema = z.object({
  version: z.number(),
  source: z.string(),
  sentences: z.array(sentenceSchema).length(40),
})
export type VoiceTestSentence = z.infer<typeof sentenceSchema>

const NUMBER_WORDS: Record<string, string> = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
  fifteen: '15',
  twenty: '20',
  thirty: '30',
  sixty: '60',
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ﬁ/g, 'fi')
    .replace(/ﬂ/g, 'fl')
    .replace(/ﬃ/g, 'ffi')
    .replace(/ﬀ/g, 'ff')
    .replace(/ﬄ/g, 'ffl')
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9'.]+/g, ' ')
    .replace(/\.(?!\d)/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => NUMBER_WORDS[word] ?? word)
    .join(' ')
}

export function containsPhrase(transcript: string, phrase: string): boolean {
  const haystack = ` ${normalize(transcript)} `
  const needle = ` ${normalize(phrase)} `
  return needle.trim() !== '' && haystack.includes(needle)
}

export type SentenceScore = { heard: string[]; missed: string[] }

export function scoreSentence(sentence: VoiceTestSentence, transcript: string): SentenceScore {
  const heard: string[] = []
  const missed: string[] = []
  for (const keyTerm of sentence.keyTerms) {
    const ok = [keyTerm.term, ...keyTerm.accept].some((form) => containsPhrase(transcript, form))
    ;(ok ? heard : missed).push(keyTerm.term)
  }
  return { heard, missed }
}

export type Path = 'keep' | 'keep-with-fix-step' | 'switch'

export function decide(errorRate: number): Path {
  if (errorRate < 0.1) return 'keep'
  if (errorRate <= 0.2) return 'keep-with-fix-step'
  return 'switch'
}

export function errorRate(scores: SentenceScore[]): {
  total: number
  missed: number
  rate: number
} {
  const missed = scores.reduce((sum, s) => sum + s.missed.length, 0)
  const total = scores.reduce((sum, s) => sum + s.missed.length + s.heard.length, 0)
  return { total, missed, rate: total === 0 ? 1 : missed / total }
}
