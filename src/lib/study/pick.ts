import { CATEGORIES } from '../content/schema'
import { dayKey, TIME_ZONE } from '../scheduler/calendar'
import { decideDifficulty, HARDER_FORMATS, studyResults } from '../scheduler/difficulty'
import { defaultScheduler, isNew, type Scheduler } from '../scheduler/fsrs'
import { meanRecall } from '../scheduler/readiness'
import { nextCard, todayPlan, type NextCard, type QueuedCard } from '../scheduler/queue'
import type { ModeRequest, ReviewLog, SchedulerCard } from '../scheduler/types'

import { currentRound, type BaselineAnswerRef, type CurrentRound } from './baseline'
import type { CardView, HomeView, NextResponse, SessionMode } from './contract'
import { daysUntil, endOfEvaluationDay, MILESTONES } from './days'
import { readinessAfterToday } from './pace'

export type StudyState = {
  cards: SchedulerCard[]
  history: ReviewLog[]
  answersToday: number
  baselineAnswers: BaselineAnswerRef[]
}

export type NextQuery = {
  mode: SessionMode
  categories: string[]
  exclude: string[]
}

const KNOWN_CATEGORIES = new Set<string>(CATEGORIES)

export function modeRequest(query: NextQuery): ModeRequest | null {
  switch (query.mode) {
    case 'baseline':
      return null
    case 'start':
      return { mode: 'start' }
    case 'together':
      return { mode: 'together' }
    case 'focus': {
      const categories = [...new Set(query.categories)]
      if (categories.length === 0 || !categories.every((name) => KNOWN_CATEGORIES.has(name))) {
        return null
      }
      return { mode: 'focus', categories }
    }
  }
}

export function daySeed(now: Date): string {
  return `study|${dayKey(now)}`
}

export function todayCounts(
  mode: ModeRequest,
  state: StudyState,
  decision: NextCard['decision'],
  now: Date,

  exclude: readonly string[] = [],
): NextResponse['today'] {
  const focus = mode.mode === 'focus' ? new Set(mode.categories) : null
  const pool = focus ? state.cards.filter((card) => focus.has(card.category)) : state.cards
  const plan = todayPlan({ cards: pool, history: state.history, now, skip: exclude })

  const harderNew = (card: SchedulerCard): boolean =>
    isNew(card) && !card.quarantined && HARDER_FORMATS.includes(card.itemType)
  const newLeft =
    mode.mode !== 'together'
      ? plan.new
      : decision.promoteFormats
        ? Math.min(plan.new, pool.filter(harderNew).length)
        : 0

  const again = mode.mode === 'start' ? plan.again : 0
  return { due: plan.review + plan.learning + again, newLeft, done: state.answersToday }
}

export type CardRenderer = (queued: QueuedCard, seed: string) => CardView

function checkCard(
  round: CurrentRound | null,
  state: StudyState,
  exclude: readonly string[],
  render: CardRenderer,
  decision: NextCard['decision'],
  now: Date,
): CardView | null {
  const skip = new Set(exclude)
  const itemId = round?.order.find((id) => !skip.has(id))
  const card = state.cards.find((entry) => entry.itemId === itemId)
  if (!card) return null
  const queued: QueuedCard = {
    kind: 'card',
    card,
    reason: isNew(card) ? 'new' : 'review',
    format: 'free',
    hintFirst: false,
    decision,
  }
  return { ...render(queued, daySeed(now)), dueInMs: undefined, baseline: true }
}

export function pickNext(
  query: NextQuery,
  state: StudyState,
  render: CardRenderer,
  now: Date,
  scheduler: Scheduler = defaultScheduler,
): NextResponse | null {
  const round =
    query.mode === 'start' || query.mode === 'baseline'
      ? currentRound(state.cards, state.baselineAnswers, now)
      : null
  if (query.mode === 'baseline') {
    const decision = decideDifficulty(studyResults(state.history))
    return {
      card: checkCard(round, state, query.exclude, render, decision, now),
      today: { due: round?.remaining ?? 0, newLeft: 0, done: state.answersToday },
    }
  }
  const mode = modeRequest(query)
  if (mode === null) return null
  const seed = daySeed(now)
  const next = nextCard(
    { mode, cards: state.cards, history: state.history, now, seed, skip: query.exclude },
    scheduler,
  )
  const today = todayCounts(mode, state, next.decision, now, query.exclude)
  const check = checkCard(round, state, query.exclude, render, next.decision, now)
  if (round && check) return { card: check, today: { ...today, due: today.due + round.remaining } }
  return { card: next.kind === 'card' ? render(next, seed) : null, today }
}

export function homeCounts(
  state: StudyState,
  now: Date,
  timeZone: string,
): Pick<
  HomeView,
  'daysToPracticeDay' | 'daysToFirstClass' | 'dueToday' | 'baseline' | 'readiness' | 'studiedToday'
> {
  const plan = todayPlan({ cards: state.cards, history: state.history, now })
  const round = currentRound(state.cards, state.baselineAnswers, now, TIME_ZONE)
  const daysToPracticeDay = daysUntil(MILESTONES.practiceDay, now, timeZone)
  const daysToFirstClass = daysUntil(MILESTONES.firstClass, now, timeZone)
  return {
    daysToPracticeDay,
    daysToFirstClass,
    dueToday: plan.total + (round?.remaining ?? 0),
    baseline: round ? { label: round.label, cards: round.remaining } : null,

    readiness:
      daysToPracticeDay < 0 && daysToFirstClass >= 0
        ? firstClassReadiness(state.cards, plan, now)
        : null,
    studiedToday: state.answersToday > 0,
  }
}

function firstClassReadiness(
  cards: readonly SchedulerCard[],
  plan: ReturnType<typeof todayPlan>,
  now: Date,
): { now: number; afterToday: number } {
  const at = endOfEvaluationDay(MILESTONES.firstClass)
  return {
    now: meanRecall(cards, at),
    afterToday: readinessAfterToday(cards, plan.new, now, at),
  }
}
