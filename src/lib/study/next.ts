import { defaultScheduler, type Scheduler } from '../scheduler/fsrs'

import type { NextResponse } from './contract'
import { cardView, type Deck } from './deck'
import { pickNext, type NextQuery, type StudyState } from './pick'

export { daySeed, modeRequest, todayCounts, type NextQuery } from './pick'

export function nextView(
  query: NextQuery,
  state: StudyState,
  deck: Deck,
  now: Date,
  scheduler: Scheduler = defaultScheduler,
): NextResponse | null {
  return pickNext(
    query,
    state,
    (queued, seed) => cardView(deck, queued, now, seed, scheduler),
    now,
    scheduler,
  )
}
