import { desc } from 'drizzle-orm'
import { z } from 'zod'

import type { Db } from '../db/client'
import { voiceTestRuns } from '../db/schema'
import { decide, type Path } from '../speech/keyterms'
import {
  decideVoiceTest,
  type VoiceTestDecision,
  type VoiceTestMode,
} from '../speech/voice-test-decision'

export type ListeningHold =
  | { measured: false }
  | {
      measured: true

      ownStops: number

      shortestMs: number | null
      medianMs: number | null

      longestListenMs: number
    }

export type VoiceTestRunView = {
  id: string
  at: string
  mode: VoiceTestMode

  completed: boolean
  sentencesRead: number
  sentencesHeard: number
  sentencesTotal: number
  keyTermsMissed: number
  keyTermsTotal: number
  errorRate: number
  path: Path
  readAloudWorked: boolean
  stalls: number
  missedTerms: string[]

  musicPlaying: boolean | null
  hold: ListeningHold
}

const detailsSchema = z.object({
  completed: z.boolean().optional(),
  musicPlaying: z.boolean().nullable().optional(),
  sentences: z.array(
    z.object({
      missed: z.array(z.string()).optional(),
      listenMs: z.number().optional(),
      holdsMs: z.array(z.number()).optional(),
    }),
  ),
})
type Details = z.infer<typeof detailsSchema>

function median(sorted: readonly number[]): number | null {
  if (sorted.length === 0) return null
  const middle = Math.floor(sorted.length / 2)
  const upper = sorted[middle] ?? 0
  return sorted.length % 2 === 1 ? upper : Math.round(((sorted[middle - 1] ?? 0) + upper) / 2)
}

export function listeningHold(sentences: Details['sentences']): ListeningHold {
  if (sentences.length === 0 || sentences.some((s) => s.holdsMs === undefined)) {
    return { measured: false }
  }
  const holds = sentences.flatMap((s) => s.holdsMs ?? []).sort((a, b) => a - b)
  return {
    measured: true,
    ownStops: holds.length,
    shortestMs: holds[0] ?? null,
    medianMs: median(holds),
    longestListenMs: Math.max(0, ...sentences.map((s) => s.listenMs ?? 0)),
  }
}

export async function listVoiceTestRuns(db: Db): Promise<VoiceTestRunView[]> {
  const rows = await db
    .select()
    .from(voiceTestRuns)
    .orderBy(desc(voiceTestRuns.createdAt))
    .limit(20)
  return rows.map((row) => {
    const parsed = detailsSchema.safeParse(row.details)
    const details: Details = parsed.success ? parsed.data : { sentences: [] }
    return {
      id: row.id,
      at: row.createdAt.toISOString(),
      mode: row.mode,
      completed: details.completed === true,
      sentencesRead: details.sentences.length,
      sentencesHeard: row.sentencesHeard,
      sentencesTotal: row.sentencesTotal,
      keyTermsMissed: row.keyTermsMissed,
      keyTermsTotal: row.keyTermsTotal,
      errorRate: row.errorRate,
      path: decide(row.errorRate),
      readAloudWorked: row.readAloudWorked,
      stalls: row.stalls,
      missedTerms: [...new Set(details.sentences.flatMap((s) => s.missed ?? []))],
      musicPlaying: details.musicPlaying ?? null,
      hold: listeningHold(details.sentences),
    }
  })
}

export function overall(runs: VoiceTestRunView[]): {
  safari: VoiceTestRunView | null
  homeScreen: VoiceTestRunView | null
  decision: VoiceTestDecision
} {
  const latest = (mode: VoiceTestMode) => runs.find((r) => r.mode === mode && r.completed) ?? null
  const safari = latest('safari-tab')
  const homeScreen = latest('home-screen')
  return {
    safari,
    homeScreen,
    decision: decideVoiceTest(safari?.path ?? null, homeScreen?.path ?? null),
  }
}

export const MODE_NAME: Record<VoiceTestMode, string> = {
  'safari-tab': 'a Safari tab',
  'home-screen': 'the Home Screen app',
}

const PATH_TEXT: Record<Path, string> = {
  keep: 'Under 10%: keep Safari speech recognition.',
  'keep-with-fix-step': '10–20%: keep it and add a one-tap fix-the-word step before grading.',
  switch: 'Over 20%: switch to a paid speech service (the one exception to one vendor).',
}

export function percent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`
}

export function decisionText(summary: ReturnType<typeof overall>): string {
  const { decision, safari, homeScreen } = summary
  if (!decision.decided) {
    return `Not decided yet. It needs a full run (all sentences read) in a Safari tab and in the Home Screen app. Still to run: ${decision.missing.map((mode) => MODE_NAME[mode]).join(' and ')}.`
  }
  const rate = (run: VoiceTestRunView | null) => (run ? percent(run.errorRate) : '?')
  if (decision.use === 'home-screen') {
    return `Voice works in the Home Screen app (${rate(homeScreen)} missed), so the learner uses the Home Screen app. ${PATH_TEXT[decision.path]}`
  }
  if (decision.use === 'safari-tab') {
    return `Voice works in a Safari tab (${rate(safari)} missed) but not in the Home Screen app (${rate(homeScreen)} missed), so the learner uses the app in a Safari tab: everything works except the two daily reminders, which need the Home Screen app. ${PATH_TEXT[decision.path]}`
  }
  return `Voice works in neither a Safari tab (${rate(safari)} missed) nor the Home Screen app (${rate(homeScreen)} missed). ${PATH_TEXT.switch}`
}

export function musicText(musicPlaying: boolean | null): string {
  if (musicPlaying === null) return 'music: not answered'
  return musicPlaying ? 'music playing' : 'no music'
}

export function holdText(hold: ListeningHold): string {
  if (!hold.measured) return 'Listening hold: not measured (run saved before hold times)'
  if (hold.ownStops === 0 || hold.shortestMs === null || hold.medianMs === null) {
    return `Listening held: never stopped on its own (longest listen ${seconds(hold.longestListenMs)})`
  }
  const times = hold.ownStops === 1 ? 'once' : `${String(hold.ownStops)} times`
  return `Listening held: stopped on its own ${times}, after ${seconds(hold.shortestMs)} at the shortest (median ${seconds(hold.medianMs)})`
}
