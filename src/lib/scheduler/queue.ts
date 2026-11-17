// Decides the next card. Order of preference: learning steps that are due, reviews that
// are due (lowest recall first), then new cards within the daily cap.

import { State } from 'ts-fsrs'

import { addMinutes, dayKey, localDay, TIME_ZONE, type LocalDay } from './calendar'
import {
  byReviewTime,
  decideDifficulty,
  EASIER_FORMATS,
  HARDER_FORMATS,
  isStudy,
  type DifficultyDecision,
  type NewCardPace,
} from './difficulty'
import { defaultScheduler, isLearning, isNew, type Scheduler } from './fsrs'
import { compareText, seededKey, seededRandom, weightedPick } from './seeded'
import type { ItemType, ModeRequest, PresentationFormat, ReviewLog, SchedulerCard } from './types'

export const DAILY_NEW_CAP = 40

export const STUDY_MINUTES_PER_DAY = 45

export const LEARN_AHEAD_MINUTES = 20

export const STRUGGLING_RECALL = 0.7
export const STRUGGLING_LAPSES = 2

export const TOGETHER_WEIGHTS = {
  recall: 1,
  list: 1,
  cue: 3,
  scenario: 3,
  audit: 3,
} as const satisfies Record<ItemType, number>

export type QueueInput = {
  mode: ModeRequest
  cards: readonly SchedulerCard[]

  history: readonly ReviewLog[]
  now: Date

  seed: string

  skip?: readonly string[]
  studyMinutesPerDay?: number
  timeZone?: string
}

export type CardReason = 'learning' | 'review' | 'new' | 'practice' | 'learn-ahead' | 'again'

export type QueuedCard = {
  kind: 'card'
  card: SchedulerCard
  reason: CardReason

  format: PresentationFormat

  hintFirst: boolean
  decision: DifficultyDecision
}

export type QueueDone = { kind: 'done'; nextDueAt: Date | null; decision: DifficultyDecision }

export type NextCard = QueuedCard | QueueDone

export function dailyNewCap(
  studyMinutes: number = STUDY_MINUTES_PER_DAY,
  pace: NewCardPace = 'steady',
): number {
  if (pace === 'none') return 0
  const scaled = Math.round((DAILY_NEW_CAP * Math.max(0, studyMinutes)) / STUDY_MINUTES_PER_DAY)
  return Math.min(DAILY_NEW_CAP, scaled)
}

export function newCardIsDue(
  pending: number,
  newLeft: number,
  sinceLastNew: number,
  pace: NewCardPace,
): boolean {
  if (newLeft <= 0 || pace === 'none') return false
  if (pending <= 0) return true
  const steadySlots = Math.ceil((pending + newLeft) / newLeft)
  const slots = pace === 'more' ? Math.ceil(steadySlots / 2) : steadySlots
  return sinceLastNew + 1 >= slots
}

type Day = {
  today: LocalDay
  decision: DifficultyDecision

  newLeft: number

  sinceLastNew: number

  lastStudy: ReviewLog | null

  lastAnswerOn: ReadonlyMap<string, ReviewLog>

  todayOn: ReadonlyMap<string, readonly ReviewLog[]>
  studiedToday: number
}

function readDay(
  history: readonly ReviewLog[],
  now: Date,
  timeZone: string,
  studyMinutes: number | undefined,
): Day {
  const today = localDay(now, timeZone)
  const ordered = history.toSorted(byReviewTime)
  const study = ordered.filter(isStudy)
  const decision = decideDifficulty(study.map((log) => log.result))
  const todays = study.filter((log) => today.includes(log.fsrs.review))
  const isIntroduction = (log: ReviewLog): boolean => log.fsrs.state === State.New
  const introduced = todays.filter(isIntroduction).length
  const lastNew = todays.findLastIndex(isIntroduction)
  return {
    today,
    decision,
    newLeft: Math.max(0, dailyNewCap(studyMinutes, decision.newCards) - introduced),
    sinceLastNew: todays.length - (lastNew + 1),
    lastStudy: study.at(-1) ?? null,
    lastAnswerOn: new Map(study.map((log) => [log.itemId, log])),
    todayOn: groupByItem(todays),
    studiedToday: todays.length,
  }
}

function groupByItem(logs: readonly ReviewLog[]): Map<string, ReviewLog[]> {
  const groups = new Map<string, ReviewLog[]>()
  for (const log of logs) {
    const group = groups.get(log.itemId)
    if (group) group.push(log)
    else groups.set(log.itemId, [log])
  }
  return groups
}

function againToday(
  pool: readonly SchedulerCard[],
  day: Day,
  now: Date,
  scheduler: Scheduler,
  seed: string,
): Candidate[][] {
  const groups: Candidate[][] = [[], [], []]
  const eligible = pool.flatMap((card) => {
    const answers = day.todayOn.get(card.itemId)
    if (answers === undefined || card.fsrs.state !== State.Review) return []
    if (isDueReview(card, now, day.today)) return []
    if (answers.slice(1).some((log) => log.fsrs.state === State.Review)) return []
    const worst = answers.some((log) => log.result === 'wrong')
      ? 0
      : answers.some((log) => log.result === 'partial')
        ? 1
        : 2
    return [
      {
        card,
        worst,
        recall: scheduler.retrievability(card, now),
        key: seededKey(seed, card.itemId),
      },
    ]
  })
  for (const entry of eligible.toSorted(
    (a, b) => a.recall - b.recall || compareText(a.key, b.key),
  )) {
    groups[entry.worst]?.push({ card: entry.card, reason: 'again' })
  }
  return groups
}

function halfway(card: SchedulerCard): number {
  const due = card.fsrs.due.getTime()
  const last = card.fsrs.last_review?.getTime() ?? due
  return last + (due - last) / 2
}

export function isDueReview(card: SchedulerCard, now: Date, today: LocalDay): boolean {
  if (card.fsrs.state !== State.Review) return false
  return (
    card.fsrs.due <= now || (today.isOnOrBefore(card.fsrs.due) && now.getTime() >= halfway(card))
  )
}

type Candidate = { card: SchedulerCard; reason: CardReason }

type Tier = { candidates: readonly Candidate[]; pick: 'first' | 'balanced' | 'weighted' }
const inOrder = (candidates: readonly Candidate[]): Tier => ({ candidates, pick: 'first' })
const balanced = (candidates: readonly Candidate[]): Tier => ({ candidates, pick: 'balanced' })
const weighted = (candidates: readonly Candidate[]): Tier => ({ candidates, pick: 'weighted' })

type Stage = () => readonly Tier[]

type Recent = { itemId: string | null; category: string | null; random: number }

function choose(stages: readonly Stage[], recent: Recent): Candidate | null {
  const passes: ((candidate: Candidate) => boolean)[] = [
    ({ card }) => card.category !== recent.category && card.itemId !== recent.itemId,
    ({ card }) => card.itemId !== recent.itemId,
    () => true,
  ]
  for (const build of stages) {
    const tiers = build()
    for (const pass of passes) {
      for (const tier of tiers) {
        const [first, ...rest] = tier.candidates.filter(pass)
        if (first === undefined) continue
        switch (tier.pick) {
          case 'first':
            return first
          case 'balanced':
            return pickBalanced(first, rest, tier.candidates)
          case 'weighted':
            return pickByType(first, rest, tier.candidates, recent.random)
        }
      }
    }
  }
  return null
}

function pickBalanced(
  first: Candidate,
  rest: readonly Candidate[],
  tier: readonly Candidate[],
): Candidate {
  const left = (category: string): number =>
    tier.filter(({ card }) => card.category === category).length
  const seen = new Set([first.card.category])
  let best = first
  let bestLeft = left(first.card.category)
  for (const candidate of rest) {
    const { category } = candidate.card
    if (seen.has(category)) continue
    seen.add(category)
    const candidateLeft = left(category)
    if (candidateLeft > bestLeft) {
      best = candidate
      bestLeft = candidateLeft
    }
  }
  return best
}

function pickByType(
  first: Candidate,
  rest: readonly Candidate[],
  tier: readonly Candidate[],
  random: number,
): Candidate {
  const types: ItemType[] = []
  for (const { card } of [first, ...rest]) {
    if (!types.includes(card.itemType)) types.push(card.itemType)
  }
  const options = types.map((type) => {
    const [head = first, ...others] = [first, ...rest].filter(({ card }) => card.itemType === type)
    return pickBalanced(head, others, tier)
  })
  const [option = first, ...more] = options
  return weightedPick([option, ...more], ({ card }) => TOGETHER_WEIGHTS[card.itemType], random)
}

// Pure: the same input and seed always give the same card, which keeps sessions and
// tests reproducible.
export function nextCard(input: QueueInput, scheduler: Scheduler = defaultScheduler): NextCard {
  const { now, seed } = input
  const day = readDay(input.history, now, input.timeZone ?? TIME_ZONE, input.studyMinutesPerDay)
  const { decision } = day
  const skip = new Set(input.skip)
  const focus = input.mode.mode === 'focus' ? new Set(input.mode.categories) : null
  const active = input.cards.filter((card) => !card.quarantined)
  const pool = active.filter(
    (card) => !skip.has(card.itemId) && (focus === null || focus.has(card.category)),
  )

  const tag =
    (reason: CardReason) =>
    (card: SchedulerCard): Candidate => ({ card, reason })
  const byDue = (a: SchedulerCard, b: SchedulerCard): number =>
    a.fsrs.due.getTime() - b.fsrs.due.getTime() || compareText(a.itemId, b.itemId)

  const byRecall = (cards: readonly SchedulerCard[], reason: CardReason): Candidate[] =>
    cards
      .map((card) => ({
        card,
        recall: scheduler.retrievability(card, now),
        key: seededKey(seed, card.itemId),
      }))
      .toSorted((a, b) => a.recall - b.recall || compareText(a.key, b.key))
      .map(({ card }) => ({ card, reason }))

  const learningDue = pool
    .filter((card) => isLearning(card) && card.fsrs.due <= now)
    .toSorted(byDue)
    .map(tag('learning'))
  const inReview = pool.filter((card) => card.fsrs.state === State.Review)
  const isDue = (card: SchedulerCard): boolean => isDueReview(card, now, day.today)
  const reviewDue = byRecall(inReview.filter(isDue), 'review')

  const practice = (): Candidate[] =>
    byRecall(
      inReview.filter(
        (card) =>
          !isDue(card) &&
          (card.fsrs.last_review === undefined || !day.today.includes(card.fsrs.last_review)),
      ),
      'practice',
    )
  const aheadUntil = addMinutes(now, LEARN_AHEAD_MINUTES)
  const learnAhead: Stage = () => [
    balanced(
      pool
        .filter((card) => isLearning(card) && card.fsrs.due > now && card.fsrs.due <= aheadUntil)
        .toSorted(byDue)
        .map(tag('learn-ahead')),
    ),
  ]

  const learnedTopics = new Set(
    active
      .filter((card) => card.fsrs.state === State.Review && EASIER_FORMATS.includes(card.itemType))
      .flatMap((card) => (card.topic === null ? [] : [card.topic])),
  )
  const isPromoted = (card: SchedulerCard): boolean =>
    decision.promoteFormats &&
    HARDER_FORMATS.includes(card.itemType) &&
    card.topic !== null &&
    learnedTopics.has(card.topic)
  const fresh = (day.newLeft > 0 ? pool.filter(isNew) : [])
    .toSorted((a, b) => a.position - b.position || compareText(a.itemId, b.itemId))
    .map(tag('new'))
  const promoted = fresh.filter(({ card }) => isPromoted(card))
  const unpromoted = fresh.filter(({ card }) => !isPromoted(card))

  const paced = (newCards: readonly Candidate[]): boolean =>
    newCardIsDue(
      learningDue.length + reviewDue.length,
      Math.min(day.newLeft, newCards.length),
      day.sinceLastNew,
      decision.newCards,
    )

  let stages: Stage[]
  switch (input.mode.mode) {
    case 'start': {
      const newTiers = [inOrder(promoted), inOrder(unpromoted)]
      const again: Stage = () =>
        decision.band === 'below'
          ? againToday(pool, day, now, scheduler, seed).map((group) => inOrder(group))
          : []
      stages = paced(fresh)
        ? [() => [balanced(learningDue), ...newTiers, balanced(reviewDue)], learnAhead, again]
        : [() => [balanced(learningDue), balanced(reviewDue)], () => newTiers, learnAhead, again]
      break
    }

    case 'focus': {
      stages = [
        () => [balanced(learningDue), balanced(reviewDue)],
        () => [inOrder(promoted), inOrder(unpromoted)],
        () => [balanced(practice())],
        learnAhead,
      ]
      break
    }

    case 'together': {
      const harder = decision.promoteFormats
        ? unpromoted.filter(({ card }) => HARDER_FORMATS.includes(card.itemType))
        : []
      const newTiers = paced([...promoted, ...harder]) ? [inOrder(promoted), inOrder(harder)] : []
      stages = [
        () => [balanced(learningDue), ...newTiers, weighted(reviewDue)],
        () => [weighted(practice())],
        learnAhead,
      ]
      break
    }
  }

  const lastItemId = day.lastStudy?.itemId ?? null
  const chosen = choose(stages, {
    itemId: lastItemId,
    category: input.cards.find((card) => card.itemId === lastItemId)?.category ?? null,

    random: seededRandom(
      `${seed}|${lastItemId ?? ''}|${String(day.lastStudy?.fsrs.review.getTime() ?? '')}|${String(day.studiedToday)}`,
    )(),
  })
  if (chosen === null) {
    return { kind: 'done', nextDueAt: nextDue(pool, day.today), decision }
  }

  const lastAnswer = day.lastAnswerOn.get(chosen.card.itemId)
  const pickedFromChoices = lastAnswer?.format === 'choices' && lastAnswer.result === 'right'
  return {
    kind: 'card',
    card: chosen.card,
    reason: chosen.reason,
    format:
      decision.easierFormats &&
      chosen.card.hasChoices &&
      !pickedFromChoices &&
      (chosen.reason === 'again' || isStruggling(chosen.card, now, scheduler, day.today))
        ? 'choices'
        : 'free',
    hintFirst: decision.hintFirst,
    decision,
  }
}

function nextDue(pool: readonly SchedulerCard[], today: LocalDay): Date | null {
  const dayStarts = new Map<string, number>()
  const dayStart = (at: Date): number => {
    const key = dayKey(at, today.timeZone)
    const known = dayStarts.get(key)
    if (known !== undefined) return known
    const start = localDay(at, today.timeZone).start
    dayStarts.set(key, start)
    return start
  }
  const upcoming = pool
    .filter((card) => !isNew(card))
    .map((card) => {
      const due = card.fsrs.due.getTime()
      return isLearning(card)
        ? due
        : Math.min(due, Math.max(dayStart(card.fsrs.due), halfway(card)))
    })
  return upcoming.length > 0 ? new Date(Math.min(...upcoming)) : null
}

// A card counts as struggling when its recall is low or it has lapsed repeatedly.
export function isStruggling(
  card: SchedulerCard,
  now: Date,
  scheduler: Scheduler = defaultScheduler,
  today: LocalDay = localDay(now),
): boolean {
  if (isLearning(card)) return true
  if (!isDueReview(card, now, today)) return false
  return (
    card.fsrs.lapses >= STRUGGLING_LAPSES || scheduler.retrievability(card, now) < STRUGGLING_RECALL
  )
}

export type TodayPlan = {
  review: number

  learning: number

  new: number

  again: number
  total: number
}

export function todayPlan(
  input: Omit<QueueInput, 'mode' | 'seed'>,
  scheduler: Scheduler = defaultScheduler,
): TodayPlan {
  const day = readDay(
    input.history,
    input.now,
    input.timeZone ?? TIME_ZONE,
    input.studyMinutesPerDay,
  )
  const skip = new Set(input.skip)
  const active = input.cards.filter((card) => !card.quarantined && !skip.has(card.itemId))
  const review = active.filter((card) => isDueReview(card, input.now, day.today)).length
  const learning = active.filter(isLearning).length
  const fresh = Math.min(active.filter(isNew).length, day.newLeft)
  const again =
    day.decision.band === 'below'
      ? againToday(active, day, input.now, scheduler, '').flat().length
      : 0
  return { review, learning, new: fresh, again, total: review + learning + fresh + again }
}
