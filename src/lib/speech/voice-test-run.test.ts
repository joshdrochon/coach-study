import { describe, expect, it } from 'vitest'

import type { VoiceTestSentence } from './keyterms'
import { runSubmissionSchema, scoreRun, UnknownSentenceError } from './voice-test-run'

const sentences: VoiceTestSentence[] = [
  {
    id: 'vt-01',
    page: 5,
    category: 'Floor work',
    text: 'Hands on the front rail, feet on the sliding deck.',
    keyTerms: [
      { term: 'front rail', accept: ['front rail'] },
      { term: 'zone 1', accept: ['zone 1', 'mark one'] },
    ],
  },
  {
    id: 'vt-02',
    page: 9,
    category: 'Reading',
    text: 'Read each line at an even, steady pace.',
    keyTerms: [{ term: 'steady pace', accept: ['steady pace'] }],
  },
]

const answer = (id: string, transcript: string, stalled = false) => ({
  id,
  transcript,
  stalled,
  autoStops: 0,
  spokeOk: true,
  firstResultMs: stalled ? null : 600,
  listenMs: 3100,
})

describe('scoreRun', () => {
  it('counts stalls and empty sentences', () => {
    const run = runSubmissionSchema.parse({
      mode: 'home-screen',
      completed: false,
      readAloudWorked: false,
      sentences: [answer('vt-01', '', true)],
    })
    expect(scoreRun(run, sentences)).toMatchObject({
      sentencesHeard: 0,
      stalls: 1,
      keyTermsMissed: 2,
    })
  })

  it('rejects a sentence the test never asked for', () => {
    const run = runSubmissionSchema.parse({
      mode: 'safari-tab',
      completed: true,
      readAloudWorked: true,
      sentences: [answer('vt-99', 'anything')],
    })
    expect(() => scoreRun(run, sentences)).toThrow(UnknownSentenceError)
  })

  it('accepts a run from a page that sent neither (no answer, nothing measured)', () => {
    const run = runSubmissionSchema.parse({
      mode: 'safari-tab',
      completed: true,
      readAloudWorked: true,
      sentences: [answer('vt-02', 'steady pace')],
    })
    expect(run.musicPlaying).toBeNull()
    expect(run.sentences[0]?.holdsMs).toEqual([])
  })

  it('refuses malformed submissions', () => {
    expect(runSubmissionSchema.safeParse({ mode: 'desktop', sentences: [] }).success).toBe(false)
    const base = { mode: 'safari-tab', completed: true, readAloudWorked: true }
    expect(
      runSubmissionSchema.safeParse({
        ...base,
        musicPlaying: 'loud',
        sentences: [answer('vt-01', 'x')],
      }).success,
    ).toBe(false)
    expect(
      runSubmissionSchema.safeParse({
        ...base,
        sentences: [{ ...answer('vt-01', 'x'), holdsMs: [-5] }],
      }).success,
    ).toBe(false)
  })
})
