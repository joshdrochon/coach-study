import type { LearningData } from '../dashboard/client'
import { formatShortDate } from '../dashboard/format'
import type { Db } from '../db/client'
import { dayKey } from '../scheduler/calendar'
import { defaultScheduler, type Scheduler } from '../scheduler/fsrs'
import type { SchedulerCard } from '../scheduler/types'

import { baselineRounds } from './baseline'
import type { Deck } from './deck'
import { loadReps, northStarView } from './north-star-view'
import { latestPractices, type PracticeSummary } from './practices'
import { readiness } from './progress'
import type { Answer } from './replay'
import { loadAllAnswers } from './state'

type Day = [Answer, ...Answer[]]

function share(answers: Day): { pct: number; of: number } {
  const right = answers.filter((answer) => answer.result === 'right').length
  return { pct: right / answers.length, of: answers.length }
}

function byDay(answers: readonly Answer[]): Day[] {
  const days = new Map<string, Day>()
  for (const answer of answers.toSorted((a, b) => a.at.getTime() - b.at.getTime())) {
    const key = dayKey(answer.at)
    const list = days.get(key)
    if (list) list.push(answer)
    else days.set(key, [answer])
  }
  return [...days.values()]
}

export function sessions(answers: readonly Answer[]): LearningData['sessions'] {
  return byDay(answers.filter((answer) => answer.context === 'study')).map((day) => ({
    label: formatShortDate(day[0].at),
    accuracy: share(day).pct,
  }))
}

export function baselineVsNow(
  cards: readonly SchedulerCard[],
  answers: readonly Answer[],
): Pick<LearningData, 'baseline' | 'now'> {
  const { rounds } = baselineRounds(
    cards,
    answers.filter((answer) => answer.context === 'baseline'),
  )
  const dayOne = rounds.find((entry) => entry.round === 'day-1')?.answers
  const latest = rounds.filter((entry) => entry.round !== 'day-1').at(-1)?.answers
  return {
    baseline: dayOne
      ? { label: `Baseline · ${formatShortDate(dayOne[0].at)}`, ...share(dayOne) }
      : null,
    now: latest ? share(latest) : null,
  }
}

export const LEARNING_PRACTICES = 10

export const MOST_MISSED_SHOWN = 2

const inSentence = (label: string) =>
  /^[A-Z](?![A-Z.])/.test(label) ? `${label.charAt(0).toLowerCase()}${label.slice(1)}` : label

export function mostMissed(latest: readonly PracticeSummary[]): string | null {
  const counts = new Map<string, { misses: number; newest: number; order: number }>()
  latest.forEach((practice, index) => {
    practice.missed.forEach((label, order) => {
      const seen = counts.get(label)
      counts.set(label, {
        misses: (seen?.misses ?? 0) + 1,
        newest: seen?.newest ?? index,
        order: seen?.order ?? order,
      })
    })
  })
  const top = [...counts]
    .sort(([, a], [, b]) => b.misses - a.misses || a.newest - b.newest || a.order - b.order)
    .slice(0, MOST_MISSED_SHOWN)
  if (top.length === 0) return null
  return top
    .map(
      ([label, { misses }]) =>
        `${inSentence(label)} (${String(misses)} of ${String(latest.length)})`,
    )
    .join(', ')
}

export async function learningView(
  db: Db,
  deck: Deck,
  now: Date,
  scheduler: Scheduler = defaultScheduler,
): Promise<LearningData> {
  const [all, latest, reps] = await Promise.all([
    loadAllAnswers(db, deck, now, scheduler),
    latestPractices(db, LEARNING_PRACTICES),
    loadReps(db),
  ])
  return {
    sessions: sessions(all.answers),
    readiness: readiness(all.cards, now, scheduler),
    practices: latest.toReversed().map((practice) => ({
      label: `Practice ${String(practice.number)}`,
      passed: practice.passed,
      of: practice.of,
    })),
    mostMissed: mostMissed(latest),
    ...baselineVsNow(all.cards, all.answers),
    northStar: northStarView(reps, now),
  }
}
