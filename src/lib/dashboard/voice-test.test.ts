import { beforeEach, describe, expect, it } from 'vitest'

import { openTestDb, type Db } from '../db/client'
import { voiceTestRuns } from '../db/schema'

import {
  decisionText,
  holdText,
  listeningHold,
  listVoiceTestRuns,
  musicText,
  overall,
} from './voice-test'

type RunOptions = {
  completed?: boolean
  musicPlaying?: boolean | null
  sentences?: { missed?: string[]; listenMs?: number; holdsMs?: number[] }[]
}

const run = (
  mode: 'safari-tab' | 'home-screen',
  missed: number,
  at: string,
  options: RunOptions = {},
) => ({
  mode,
  userAgent: 'iPad',
  sentencesTotal: 40,
  sentencesHeard: 40,
  keyTermsTotal: 60,
  keyTermsMissed: missed,
  errorRate: missed / 60,
  readAloudWorked: true,
  stalls: 0,
  details: {
    completed: options.completed ?? true,
    ...(options.musicPlaying === undefined ? {} : { musicPlaying: options.musicPlaying }),
    sentences: options.sentences ?? [{ missed: missed > 0 ? ['back step'] : [] }],
  },
  createdAt: new Date(at),
})

describe('voice test results', () => {
  let db: Db
  beforeEach(async () => {
    db = await openTestDb()
  })

  it('has no decision before any run', async () => {
    const summary = overall(await listVoiceTestRuns(db))
    expect(summary).toEqual({
      safari: null,
      homeScreen: null,
      decision: { decided: false, missing: ['safari-tab', 'home-screen'] },
    })
  })

  it('applies the committed thresholds to the latest full run per mode', async () => {
    await db
      .insert(voiceTestRuns)
      .values([
        run('safari-tab', 20, '2026-08-17T16:00:00Z'),
        run('safari-tab', 5, '2026-08-17T17:00:00Z'),
        run('home-screen', 10, '2026-08-17T17:30:00Z'),
      ])
    const runs = await listVoiceTestRuns(db)
    const summary = overall(runs)
    expect(summary.safari?.keyTermsMissed).toBe(5)
    expect(summary.safari?.path).toBe('keep')
    expect(summary.homeScreen?.path).toBe('keep-with-fix-step')

    expect(summary.decision).toEqual({
      decided: true,
      use: 'home-screen',
      path: 'keep-with-fix-step',
    })
    expect(runs[0]?.missedTerms).toEqual(['back step'])
  })

  it('sends them to a Safari tab when only the Home Screen run fails', async () => {
    await db
      .insert(voiceTestRuns)
      .values([
        run('safari-tab', 3, '2026-08-17T16:00:00Z'),
        run('home-screen', 60, '2026-08-17T16:30:00Z'),
      ])
    const summary = overall(await listVoiceTestRuns(db))
    expect(summary.decision).toEqual({ decided: true, use: 'safari-tab', path: 'keep' })
    expect(decisionText(summary)).toBe(
      'Voice works in a Safari tab (5.0% missed) but not in the Home Screen app (100.0% missed), so the learner uses the app in a Safari tab: everything works except the two daily reminders, which need the Home Screen app. Under 10%: keep Safari speech recognition.',
    )
  })

  it('switches only when both full runs fail', async () => {
    await db
      .insert(voiceTestRuns)
      .values([
        run('safari-tab', 30, '2026-08-17T16:00:00Z'),
        run('home-screen', 40, '2026-08-17T16:30:00Z'),
      ])
    const summary = overall(await listVoiceTestRuns(db))
    expect(summary.decision).toEqual({ decided: true, use: null, path: 'switch' })
    expect(decisionText(summary)).toMatch(/^Voice works in neither a Safari tab \(50\.0% missed\)/)
    expect(decisionText(summary)).toMatch(/switch to a paid speech service/)
  })

  it('never decides on a run the learner ended early', async () => {
    await db.insert(voiceTestRuns).values([
      run('safari-tab', 2, '2026-08-17T16:00:00Z'),

      run('home-screen', 0, '2026-08-17T16:30:00Z', {
        completed: false,
        sentences: [{}, {}, {}],
      }),
    ])
    const runs = await listVoiceTestRuns(db)
    expect(runs[0]).toMatchObject({ mode: 'home-screen', completed: false, sentencesRead: 3 })
    const summary = overall(runs)
    expect(summary.homeScreen).toBeNull()
    expect(summary.decision).toEqual({ decided: false, missing: ['home-screen'] })
    expect(decisionText(summary)).toBe(
      'Not decided yet. It needs a full run (all sentences read) in a Safari tab and in the Home Screen app. Still to run: the Home Screen app.',
    )
  })

  it('shows whether music was playing and how long listening held', async () => {
    await db.insert(voiceTestRuns).values([
      run('safari-tab', 0, '2026-08-17T16:00:00Z', {
        musicPlaying: true,
        sentences: [
          { listenMs: 9000, holdsMs: [6200, 2400] },
          { listenMs: 4000, holdsMs: [] },
          { listenMs: 12_000, holdsMs: [7100] },
        ],
      }),
      run('home-screen', 0, '2026-08-17T16:30:00Z', {
        musicPlaying: false,
        sentences: [{ listenMs: 5200, holdsMs: [] }],
      }),

      run('home-screen', 0, '2026-08-17T15:00:00Z'),
    ])
    const [noMusic, music, old] = await listVoiceTestRuns(db)
    expect(music?.musicPlaying).toBe(true)
    expect(music?.hold).toEqual({
      measured: true,
      ownStops: 3,
      shortestMs: 2400,
      medianMs: 6200,
      longestListenMs: 12_000,
    })
    expect(holdText(music?.hold ?? { measured: false })).toBe(
      'Listening held: stopped on its own 3 times, after 2.4 s at the shortest (median 6.2 s)',
    )
    expect(musicText(music?.musicPlaying ?? null)).toBe('music playing')

    expect(noMusic?.musicPlaying).toBe(false)
    expect(musicText(false)).toBe('no music')
    expect(holdText(noMusic?.hold ?? { measured: false })).toBe(
      'Listening held: never stopped on its own (longest listen 5.2 s)',
    )

    expect(old?.musicPlaying).toBeNull()
    expect(musicText(null)).toBe('music: not answered')
    expect(old?.hold).toEqual({ measured: false })
    expect(holdText({ measured: false })).toMatch(/^Listening hold: not measured/)
  })

  it('takes the median of an even number of holds as the middle two averaged', () => {
    expect(listeningHold([{ listenMs: 30_000, holdsMs: [4000, 1000, 3000, 2000] }])).toEqual({
      measured: true,
      ownStops: 4,
      shortestMs: 1000,
      medianMs: 2500,
      longestListenMs: 30_000,
    })
    expect(holdText(listeningHold([{ listenMs: 8000, holdsMs: [5000] }]))).toBe(
      'Listening held: stopped on its own once, after 5.0 s at the shortest (median 5.0 s)',
    )
    expect(listeningHold([])).toEqual({ measured: false })
  })
})
