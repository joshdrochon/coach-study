import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { createScheduler, newCard } from '@/lib/scheduler/fsrs'
import { decideDifficulty } from '@/lib/scheduler/difficulty'
import { cardView, loadDeck } from '@/lib/study/deck'
import type { AnswerEntry } from '@/lib/study/entry'
import type { Correction } from '@/lib/grader/heard'
import type { Outcome } from '@/lib/study/session'
import { T0 } from '@/test/study-fixtures'

import { ENTRY_LABELS } from './copy'
import { ResultScreen } from './ResultScreen'
import { SelfGradeScreen } from './SelfGradeScreen'

const none = () => undefined
const deck = loadDeck()
const meta = deck.metaById.get('session-feel')
if (!meta) throw new Error('card not in the deck')
const card = cardView(
  deck,
  {
    kind: 'card',
    card: newCard(meta, T0),
    reason: 'new',
    format: 'free',
    hintFirst: false,
    decision: decideDifficulty([]),
  },
  T0,
  'seed',
  createScheduler({ enableFuzz: false }),
)

const SAID = 'we start slow and then pick up the count after the first minute'

function result(entry: AnswerEntry, answer = SAID, corrections: Correction[] = []): string {
  const outcome: Outcome = {
    result: 'right',
    word: 'right',
    rating: 3,
    proposedRating: 3,
    spoken: 'Got it.',
    missing: [],
    gradedBy: 'tutor',
    traceId: null,
    revealed: false,
    corrections,
  }
  return renderToStaticMarkup(
    createElement(ResultScreen, {
      card,
      outcome,
      answer,
      entry,
      progress: null,
      redo: false,
      onEnd: none,
      onChange: none,
      onSource: none,
      onReport: none,
      onRedo: none,
      onNext: none,
      onReplay: none,
    }),
  )
}

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

describe('their answer on the result', () => {
  it('names how the learner gave it: said, typed or chose', () => {
    expect(ENTRY_LABELS).toEqual({ voice: 'You said', typed: 'You typed', choice: 'You chose' })
    expect(text(result('voice'))).toContain(`You said ${SAID}`)
    expect(text(result('typed'))).toContain(`You typed ${SAID}`)
    expect(text(result('choice', 'Hands + feet'))).toContain('You chose Hands + feet')
  })

  it('is left out when the learner asked for the answer instead', () => {
    expect(text(result('voice', ''))).not.toMatch(/You said|You typed/)
  })

  it('shows their words with straight quotes made curly', () => {
    expect(text(result('voice', "don't lift"))).toContain('don’t lift')
  })
})

describe('words read as sound-alikes', () => {
  const then = [{ heard: 'then', readAs: 'bend' }]

  it('shows the word as read, one quiet mark, and what was heard beside it', () => {
    const html = result('voice', SAID, then)
    expect(text(html)).toContain(
      'You said we start slow and bend heard “then” pick up the count after the first minute',
    )
    expect(html.match(/class="[^"]*readAs[^"]*"/g)).toHaveLength(1)
    expect(html).toMatch(/class="[^"]*readAs[^"]*">bend</)
  })

  it('never shows a correction the grader didn’t return, or one not in their words', () => {
    expect(text(result('voice'))).not.toContain('heard “')
    expect(text(result('voice', SAID, [{ heard: 'lift', readAs: 'bend' }]))).not.toContain(
      'heard “',
    )
  })

  it('shows none on a typed or tapped answer', () => {
    expect(text(result('typed', SAID, then))).not.toContain('heard “')
    expect(text(result('typed', SAID, then))).toContain('and then pick up')
    expect(text(result('choice', SAID, then))).not.toContain('heard “')
  })
})

describe('Check it yourself names it the same way', () => {
  it('says You typed for a typed answer', () => {
    const html = renderToStaticMarkup(
      createElement(SelfGradeScreen, {
        card,
        progress: null,
        answer: 'bend your arms',
        entry: 'typed',
        onEnd: none,
        onRate: none,
        onReplay: none,
      }),
    )
    expect(text(html)).toContain('You typed')
    expect(text(html)).not.toContain('You said')
  })
})
