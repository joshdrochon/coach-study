import { randomUUID } from 'node:crypto'

import { beforeAll, describe, expect, it } from 'vitest'

import { loadBank } from '../content/bank'
import { openTestDb, type Db } from '../db/client'
import { MODELS } from '../grader/models'
import { progressSchema, rightOnCardsLine } from '../progress/client'
import { T0 } from '@/test/study-fixtures'

import { loadDeck } from './deck'
import { recordDraftCase, reviewDraftCase } from './flag-cases'
import { rightOnCardsLineEnabled } from './flags'
import { progressView } from './progress'

let db: Db

beforeAll(async () => {
  db = await openTestDb()
  const item = loadBank().byId.get('term-range')
  if (!item) throw new Error('no item')
  for (const now of ['right', 'partial'] as const) {
    await recordDraftCase(db, {
      dispute: { id: randomUUID(), flagId: randomUUID(), flaggedAt: T0 },
      item: now === 'right' ? item : { ...item, id: 'term-tempo' },
      words: { text: 'a mat a strap', from: 'answer' },
      answer: { reviewedAt: T0.toISOString(), entry: 'voice' },
      note: '',
      regrade: { model: MODELS.opus, was: 'wrong', now, reason: 'Opus reason.', traceId: 't' },
    })
  }
  const { evalCaseDrafts } = await import('../db/schema')
  for (const row of await db.select().from(evalCaseDrafts)) {
    await reviewDraftCase(db, { id: row.id, action: 'approve' })
  }
}, 60_000)

describe('the right-on-cards line', () => {
  it('is switched off: Progress neither reads nor sends the count', async () => {
    expect(rightOnCardsLineEnabled()).toBe(false)
    const view = await progressView(db, loadDeck(), T0)
    expect('rightOnCards' in view).toBe(false)
    expect(progressSchema.parse(view)).not.toHaveProperty('rightOnCards')
  })

  it('switched on, Progress sends the cards the admin review agreed with them on', async () => {
    const view = await progressView(db, loadDeck(), T0, undefined, true)

    expect(view.rightOnCards).toBe(2)
    expect(progressSchema.parse(view).rightOnCards).toBe(2)
  })

  it('reads in their voice, and is absent with nothing to count', () => {
    expect(rightOnCardsLine(2)).toBe('You were right on 2 cards you said looked wrong.')
    expect(rightOnCardsLine(1)).toBe('You were right on 1 card you said looked wrong.')
    expect(rightOnCardsLine(0)).toBeNull()
    expect(rightOnCardsLine(undefined)).toBeNull()

    const line = rightOnCardsLine(3) ?? ''
    expect(line).not.toMatch(/[—;!]|dispute|verdict|flag|item/i)
  })

  it('a malformed count from an older or newer server is dropped, never the screen', () => {
    const base = {
      name: 'Coach Alex',
      title: 'Starter',
      avatarUrl: '/api/avatar',
      practiceSessions: { done: 0, of: 3 },
      practiceClasses: { done: 0, of: 10 },
      readiness: [],
      isDayOne: true,
    }
    expect(progressSchema.parse({ ...base, rightOnCards: -1 }).rightOnCards).toBeUndefined()
    expect(progressSchema.parse({ ...base, rightOnCards: 'two' }).rightOnCards).toBeUndefined()
    expect(progressSchema.parse(base).rightOnCards).toBeUndefined()
  })
})
