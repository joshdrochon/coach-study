import { localDay } from '../scheduler/calendar'
import { WINDOW_SIZE } from '../scheduler/difficulty'
import { defaultScheduler, newCard, type Scheduler } from '../scheduler/fsrs'
import { compareText } from '../scheduler/seeded'
import type { SchedulerCard } from '../scheduler/types'

import { baselineAnswerRefs } from './baseline'
import { answerKey, effectiveTime, STUDY_EVENT_MODES, type StoredEvent } from './events'
import type { StudyState } from './pick'
import { replayItems, type ItemMeta } from './replay'

const STUDY_MODES = new Set<string>(STUDY_EVENT_MODES)

export function lastStudyAnswerItems(events: readonly StoredEvent[], limit: number): Set<string> {
  const answers = new Map<string, { itemId: string; at: number }>()
  for (const event of events) {
    if (!STUDY_MODES.has(event.mode)) continue
    const key = answerKey(event)
    const at = effectiveTime(event).getTime()
    const known = answers.get(key)
    if (!known || at < known.at) answers.set(key, { itemId: event.itemId, at })
  }
  const newest = [...answers.values()].toSorted(
    (a, b) => b.at - a.at || compareText(a.itemId, b.itemId),
  )
  return new Set(newest.slice(0, limit).map((answer) => answer.itemId))
}

export function stateFromEvents(
  metas: readonly ItemMeta[],
  events: readonly StoredEvent[],
  quarantined: ReadonlySet<string>,
  now: Date,
  scheduler: Scheduler = defaultScheduler,
): StudyState {
  const metaById = new Map(metas.map((meta) => [meta.itemId, meta]))
  const replayed = replayItems(metaById, events, scheduler)
  const dayStart = localDay(now).start

  const recent = lastStudyAnswerItems(events, WINDOW_SIZE)
  for (const event of events) {
    if (effectiveTime(event).getTime() >= dayStart) recent.add(event.itemId)
  }
  const cards = metas.map((meta): SchedulerCard => {
    const fsrs = replayed.get(meta.itemId)?.card.fsrs
    const card = fsrs ? { ...meta, fsrs } : newCard(meta, now)
    return { ...card, quarantined: quarantined.has(meta.itemId) }
  })
  const answers = [...recent].flatMap((itemId) => replayed.get(itemId)?.answers ?? [])
  return {
    cards,
    history: answers.flatMap((answer) => (answer.log ? [answer.log] : [])),
    answersToday: answers.filter(
      (answer) =>
        answer.at.getTime() >= dayStart &&
        (answer.context === 'study' || answer.context === 'baseline'),
    ).length,
    baselineAnswers: baselineAnswerRefs(events),
  }
}
