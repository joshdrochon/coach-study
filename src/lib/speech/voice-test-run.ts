import { z } from 'zod'

import { decide, errorRate, scoreSentence, type Path, type VoiceTestSentence } from './keyterms'

export const runSubmissionSchema = z.object({
  mode: z.enum(['safari-tab', 'home-screen']),
  completed: z.boolean(),
  readAloudWorked: z.boolean(),

  musicPlaying: z.boolean().nullable().default(null),
  sentences: z
    .array(
      z.object({
        id: z.string().max(20),
        transcript: z.string().max(2000),
        stalled: z.boolean(),
        autoStops: z.number().int().min(0).max(100),
        spokeOk: z.boolean(),
        firstResultMs: z.number().int().min(0).max(120_000).nullable(),
        listenMs: z.number().int().min(0).max(120_000),

        holdsMs: z.array(z.number().int().min(0).max(120_000)).max(100).default([]),
      }),
    )
    .min(1)
    .max(40),
})
export type RunSubmission = z.infer<typeof runSubmissionSchema>

export type ScoredRun = {
  sentencesTotal: number
  sentencesHeard: number
  keyTermsTotal: number
  keyTermsMissed: number
  errorRate: number
  path: Path
  stalls: number
  details: {
    id: string
    page: number
    transcript: string
    heard: string[]
    missed: string[]
    stalled: boolean
    autoStops: number
    spokeOk: boolean
    firstResultMs: number | null
    listenMs: number
    holdsMs: number[]
  }[]
}

export class UnknownSentenceError extends Error {}

export function scoreRun(run: RunSubmission, sentences: VoiceTestSentence[]): ScoredRun {
  const byId = new Map(sentences.map((s) => [s.id, s]))
  const details = run.sentences.map((answer) => {
    const sentence = byId.get(answer.id)
    if (!sentence) throw new UnknownSentenceError(`unknown sentence ${answer.id}`)
    return { ...answer, page: sentence.page, ...scoreSentence(sentence, answer.transcript) }
  })
  const totals = errorRate(details)
  return {
    sentencesTotal: sentences.length,
    sentencesHeard: details.filter((d) => d.transcript.trim() !== '').length,
    keyTermsTotal: totals.total,
    keyTermsMissed: totals.missed,
    errorRate: totals.rate,
    path: decide(totals.rate),
    stalls: details.filter((d) => d.stalled).length,
    details,
  }
}
