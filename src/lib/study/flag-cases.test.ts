import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { loadBank } from '@/lib/content/bank'
import { openTestDb, type Db } from '@/lib/db/client'
import {
  cardStates,
  disputes,
  evalCaseDrafts,
  itemFlags,
  reviewEvents,
  traces,
} from '@/lib/db/schema'
import type { CardRegradeOutput } from '@/lib/grader/card-regrade'
import { MODELS } from '@/lib/grader/models'
import { TutorError } from '@/lib/tutor/errors'
import { posted, T0 } from '@/test/study-fixtures'

import type { FlagAnswer } from './contract'
import { loadDeck } from './deck'
import { fileCardFlag, type AskCardRegrade, type CardFlag } from './flag'
import {
  flaggedView,
  recordDraftCase,
  reviewDraftCase,
  reviewRequestSchema,
  rightOnCards,
  type ReviewRequest,
} from './flag-cases'
import { loadStudyState, recordReview } from './state'

let db: Db
const ITEM = 'term-range'
const NOTE = 'It heard me wrong, I said a strap'
const REASON = 'The learner named the mat, the strap and the rollers, as the card does.'

const MISHEARD = 'um a mat… a strapAnd “rollers”  on the front whale?!\tthat’s it,\nI think '

function opus(result: CardRegradeOutput['result'], reason = REASON): AskCardRegrade {
  return (req) =>
    Promise.resolve({
      value: { result, missing: [], reason },
      model: req.model,
      usage: { input_tokens: 2000, output_tokens: 300 },
    })
}

const answer = (overrides: Partial<FlagAnswer> = {}): FlagAnswer => ({
  text: MISHEARD,
  reviewedAt: T0.toISOString(),
  result: 'partial',
  gradedBy: 'tutor',
  entry: 'voice',
  ...overrides,
})

async function saveAnswer(text: string, itemId = ITEM) {
  await recordReview(
    db,
    loadDeck(),
    posted({ itemId, result: 'partial', rating: 2, proposedRating: 2, answerText: text }),
    new Date(T0.getTime() + 60_000),
  )
}

async function flag(ask: AskCardRegrade, body: Partial<CardFlag> = {}) {
  const tasks: (() => Promise<void>)[] = []
  const outcome = await fileCardFlag(
    { itemId: ITEM, note: NOTE, flagId: randomUUID(), answer: answer(), ...body },
    { db, ask, defer: (task) => tasks.push(task) },
  )
  expect(outcome.status).toBe(200)
  for (const task of tasks) await task()
}

const drafts = () => db.select().from(evalCaseDrafts)
const pulled = async () =>
  (await db.select().from(itemFlags)).filter((row) => row.resolvedAt === null).map((r) => r.itemId)

async function onlyDraft() {
  const rows = await drafts()
  expect(rows).toHaveLength(1)
  const [row] = rows
  if (!row) throw new Error('no draft')
  return row
}

beforeAll(async () => {
  db = await openTestDb()
}, 60_000)

beforeEach(async () => {
  await db.delete(evalCaseDrafts)
  await db.delete(disputes)
  await db.delete(itemFlags)
  await db.delete(reviewEvents)
  await db.delete(cardStates)
  await db.delete(traces)
})

describe('a resolved flag becomes a draft test case', () => {
  it('keeps their saved answer byte for byte, with the card, their note, both grades and timestamps', async () => {
    await saveAnswer(MISHEARD)
    const flagId = randomUUID()
    await flag(opus('right'), { flagId, answer: answer({ text: 'what the iPad sent' }) })
    const row = await onlyDraft()

    expect(row.words).toBe(MISHEARD)
    expect(Buffer.from(row.words, 'utf8').equals(Buffer.from(MISHEARD, 'utf8'))).toBe(true)
    expect(row.wordsFrom).toBe('answer')
    const [dispute] = await db.select().from(disputes)
    const item = loadBank().byId.get(ITEM)
    expect(row).toMatchObject({
      status: 'draft',
      disputeId: dispute?.id,
      flagId,
      itemId: ITEM,
      entry: 'voice',
      note: NOTE,
      firstResult: 'partial',
      opusModel: MODELS.opus,
      opusResult: 'right',
      opusReason: REASON,
      expected: null,
      expectedReason: null,
      reviewedAt: null,
    })
    expect(row.card).toMatchObject({ id: ITEM, prompt: item?.prompt, answer: item?.answer })
    expect((row.card as { citations: { source: string }[] }).citations[0]?.source).toMatch(
      /^Manual p\. \d+$/,
    )
    expect(row.answeredAt.toISOString()).toBe(T0.toISOString())
    expect(row.flaggedAt.getTime()).toBe(dispute?.createdAt.getTime())
    expect(row.opusTraceId).toEqual(expect.any(String))
  })

  it('keeps the words sent with the note, exactly, when their answer isn’t on the server yet', async () => {
    const sent = '  sample move a,, sample move c…  “seated” lift!!  '
    await flag(opus('partial'), { answer: answer({ text: sent, entry: 'typed' }) })
    const row = await onlyDraft()
    expect(row.words).toBe(sent)
    expect(row.wordsFrom).toBe('note')
    expect(row.entry).toBe('typed')

    expect(row.opusResult).toBe('partial')
  })

  it('keeps every byte of an odd transcript: emoji, combining accents, a lone backslash', async () => {
    const odd = 'café \\ 🙂 ½  — 15 sec max! (front rail)'
    await saveAnswer(odd)
    await flag(opus('right'))
    expect((await onlyDraft()).words).toBe(odd)
  })

  it('makes no draft when Opus gave no result', async () => {
    await saveAnswer(MISHEARD)
    await flag(() => Promise.reject(new TutorError('timeout', 'timeout', 'nothing')))
    expect(await drafts()).toEqual([])
  })

  it('makes no draft for a note with no answer, a self-rated answer or one already right', async () => {
    await flag(opus('right'), { answer: undefined })
    await flag(opus('right'), { answer: answer({ gradedBy: 'self' }) })
    await flag(opus('right'), { answer: answer({ result: 'right' }) })
    expect(await drafts()).toEqual([])
  })

  it('stores one draft for a note sent twice (the same flag ID)', async () => {
    await saveAnswer(MISHEARD)
    const flagId = randomUUID()
    await flag(opus('right'), { flagId })
    await flag(opus('right'), { flagId })
    expect(await drafts()).toHaveLength(1)
  })

  it('stores one draft per dispute however often it is recorded', async () => {
    const item = loadBank().byId.get(ITEM)
    if (!item) throw new Error('no item')
    const input = {
      dispute: { id: randomUUID(), flagId: null, flaggedAt: T0 },
      item,
      words: { text: MISHEARD, from: 'note' as const },
      answer: { reviewedAt: T0.toISOString(), entry: 'voice' as const },
      note: '',
      regrade: {
        model: MODELS.opus,
        was: 'wrong' as const,
        now: 'partial' as const,
        reason: REASON,
        traceId: 't',
      },
    }
    expect(await recordDraftCase(db, input)).toBe('stored')
    expect(await recordDraftCase(db, { ...input, words: { text: 'other', from: 'note' } })).toBe(
      'duplicate',
    )
    expect((await onlyDraft()).words).toBe(MISHEARD)
  })
})

describe('the admin review', () => {
  async function oneDraft(ask: AskCardRegrade = opus('right')) {
    await saveAnswer(MISHEARD)
    await flag(ask)
    return onlyDraft()
  }

  const review = (request: ReviewRequest) =>
    reviewDraftCase(db, request, new Date(T0.getTime() + 86_400_000))

  it('lists drafts with everything the review needs, and counts the reviewed ones', async () => {
    const draft = await oneDraft()
    const view = await flaggedView(db)
    expect(view.reviewed).toEqual({ approved: 0, fixed: 0, rejected: 0 })
    expect(view.drafts).toEqual([
      expect.objectContaining({
        id: draft.id,
        words: MISHEARD,
        note: NOTE,
        firstResult: 'partial',
        opusResult: 'right',
        opusReason: REASON,
      }),
    ])
    await review({ id: draft.id, action: 'approve' })
    expect(await flaggedView(db)).toEqual({
      drafts: [],
      reviewed: { approved: 1, fixed: 0, rejected: 0 },
    })
  })

  it('Approve: Opus’s result and reason become the answer key, and the card goes back in their deck', async () => {
    const draft = await oneDraft()
    expect(await pulled()).toEqual([ITEM])
    expect(await review({ id: draft.id, action: 'approve' })).toEqual({
      status: 200,
      body: { ok: true, status: 'approved', returned: true },
    })
    const row = await onlyDraft()
    expect(row).toMatchObject({ status: 'approved', expected: 'right', expectedReason: REASON })
    expect(row.words).toBe(MISHEARD)
    expect(await pulled()).toEqual([])
    const [flagRow] = await db.select().from(itemFlags)
    expect(flagRow?.resolution).toBe('test case approved')
    const [dispute] = await db.select().from(disputes)
    expect(dispute).toMatchObject({ outcome: 'overturned' })
    expect(dispute?.reviewedAt).not.toBeNull()

    const state = await loadStudyState(db, loadDeck(), new Date(T0.getTime() + 86_400_000))
    expect(state.cards.find((card) => card.itemId === ITEM)?.quarantined).toBe(false)
  })

  it('Reject: no answer key, and the card still goes back in their deck', async () => {
    const draft = await oneDraft(opus('partial'))
    expect((await review({ id: draft.id, action: 'reject' })).status).toBe(200)
    expect(await onlyDraft()).toMatchObject({
      status: 'rejected',
      expected: null,
      expectedReason: null,
      words: MISHEARD,
    })
    expect(await pulled()).toEqual([])
    expect((await db.select().from(disputes))[0]?.outcome).toBe('upheld')
  })

  it('reviews a case once: a second tap is refused and changes nothing', async () => {
    const draft = await oneDraft()
    await review({ id: draft.id, action: 'reject' })
    expect(await review({ id: draft.id, action: 'approve' })).toEqual({
      status: 409,
      body: { error: 'already reviewed' },
    })
    expect((await onlyDraft()).status).toBe('rejected')
  })

  it('a review whose follow-up stopped part way is finished by the next try', async () => {
    const draft = await oneDraft()

    await db
      .update(evalCaseDrafts)
      .set({ status: 'approved', expected: 'right', expectedReason: REASON, reviewedAt: T0 })
      .where(eq(evalCaseDrafts.id, draft.id))
    expect(await pulled()).toEqual([ITEM])
    expect((await review({ id: draft.id, action: 'approve' })).status).toBe(409)
    expect(await pulled()).toEqual([])
    const [dispute] = await db.select().from(disputes)
    expect(dispute).toMatchObject({ outcome: 'overturned', reviewedAt: T0 })
  })

  it('refuses an unknown case', async () => {
    expect(await review({ id: randomUUID(), action: 'approve' })).toEqual({
      status: 404,
      body: { error: 'unknown case' },
    })
  })

  it('keeps the card pulled while another of their notes on it is still a draft', async () => {
    await saveAnswer(MISHEARD)
    await flag(opus('right'))
    await flag(opus('right'))
    const [first, second] = await db.select().from(evalCaseDrafts).orderBy(evalCaseDrafts.createdAt)
    if (!first || !second) throw new Error('two drafts expected')
    expect(await review({ id: first.id, action: 'approve' })).toMatchObject({
      body: { returned: false },
    })
    expect(await pulled()).toEqual([ITEM])
    expect(await review({ id: second.id, action: 'reject' })).toMatchObject({
      body: { returned: true },
    })
    expect(await pulled()).toEqual([])
  })

  it('keeps the card pulled while another note’s re-grade is still running, not forever', async () => {
    const draft = await oneDraft()

    await fileCardFlag(
      { itemId: ITEM, note: 'again', flagId: randomUUID(), answer: answer() },
      { db, ask: opus('right'), defer: () => undefined },
    )
    expect(await review({ id: draft.id, action: 'approve' })).toMatchObject({
      body: { returned: false },
    })
    expect(await pulled()).toEqual([ITEM])

    const later = new Date(Date.now() + 11 * 60_000)
    expect((await reviewDraftCase(db, { id: draft.id, action: 'approve' }, later)).status).toBe(409)
    expect(await pulled()).toEqual([])
  })

  it('a new note on a card back in their deck pulls it again', async () => {
    const draft = await oneDraft()
    await review({ id: draft.id, action: 'approve' })
    expect(await pulled()).toEqual([])
    await flag(opus('right'))
    expect(await pulled()).toEqual([ITEM])
  })

  it('a stale second review never puts back a card a newer note pulled', async () => {
    const draft = await oneDraft()
    await review({ id: draft.id, action: 'approve' })

    await flag(opus('right'), { answer: answer({ gradedBy: 'self' }) })
    expect(await pulled()).toEqual([ITEM])
    expect((await review({ id: draft.id, action: 'approve' })).status).toBe(409)
    expect(await pulled()).toEqual([ITEM])
  })

  it('the request never carries their words: Fix with a words field is refused', () => {
    const id = randomUUID()
    expect(reviewRequestSchema.safeParse({ id, action: 'approve' }).success).toBe(true)
    expect(
      reviewRequestSchema.safeParse({
        id,
        action: 'fix',
        expected: 'right',
        reason: 'Card says so.',
      }).success,
    ).toBe(true)
    expect(
      reviewRequestSchema.safeParse({
        id,
        action: 'fix',
        expected: 'right',
        reason: 'Card says so.',
        words: 'tidied words',
      }).success,
    ).toBe(false)
    expect(reviewRequestSchema.safeParse({ id, action: 'approve', words: 'tidied' }).success).toBe(
      false,
    )

    expect(
      reviewRequestSchema.safeParse({ id, action: 'fix', expected: 'right', reason: ' ok ' })
        .success,
    ).toBe(false)
  })
})

describe('rightOnCards', () => {
  it('counts each card once where the reviewed result beats their first grade', async () => {
    await saveAnswer(MISHEARD)
    await flag(opus('right'))
    await flag(opus('right'))
    await saveAnswer('counts per part', 'term-tempo')
    await flag(opus('right'), { itemId: 'term-tempo', answer: answer({ text: 'counts per part' }) })
    await flag(opus('partial'), {
      itemId: 'sample-move-b-setup',
      answer: answer({ text: 'x y z' }),
    })
    expect(await rightOnCards(db)).toBe(0)
    const rows = await db.select().from(evalCaseDrafts)
    const byItem = (id: string) => rows.filter((row) => row.itemId === id)
    const [a, b] = byItem(ITEM)
    const [c] = byItem('term-tempo')
    const [d] = byItem('sample-move-b-setup')
    if (!a || !b || !c || !d) throw new Error('drafts missing')
    await reviewDraftCase(db, { id: a.id, action: 'approve' })
    await reviewDraftCase(db, { id: b.id, action: 'approve' })

    expect(await rightOnCards(db)).toBe(1)

    await reviewDraftCase(db, {
      id: c.id,
      action: 'fix',
      expected: 'partial',
      reason: 'Half of it.',
    })
    expect(await rightOnCards(db)).toBe(1)

    await reviewDraftCase(db, { id: d.id, action: 'approve' })
    expect(await rightOnCards(db)).toBe(1)
    const [row] = await db.select().from(evalCaseDrafts).where(eq(evalCaseDrafts.id, d.id))
    expect(row?.expected).toBe('partial')
  })
})
