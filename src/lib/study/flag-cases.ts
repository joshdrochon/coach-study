import 'server-only'

import { and, asc, count, eq, gt, inArray, isNull, lte, notExists, sql } from 'drizzle-orm'

import { loadBank, type Bank } from '../content/bank'
import { sourceLabel } from '../content/citations'
import type { Item } from '../content/schema'
import type { Db } from '../db/client'
import { disputes, evalCaseDrafts, itemFlags } from '../db/schema'

import type { FlagAnswer } from './contract'
import {
  draftCardSchema,
  type DraftCard,
  type FlaggedView,
  type Result,
  type ReviewRequest,
} from './flag-cases-contract'

export { flaggedViewSchema, reviewRequestSchema, type ReviewRequest } from './flag-cases-contract'

const RANK: Record<Result, number> = { wrong: 0, partial: 1, right: 2 }

function cardOf(item: Item, bank: Bank): DraftCard {
  return {
    id: item.id,
    prompt: item.prompt,
    answer: item.answer,
    citations: item.citations.map((citation) => {
      const passage = bank.passages.get(citation.passageId)
      return {
        passageId: citation.passageId,
        quote: citation.quote,
        source: passage ? sourceLabel(passage) : citation.passageId,
      }
    }),
  }
}

export type DraftInput = {
  dispute: { id: string; flagId: string | null; flaggedAt: Date }
  item: Item

  words: { text: string; from: 'answer' | 'note' }
  answer: Pick<FlagAnswer, 'reviewedAt' | 'entry'>
  note: string
  regrade: { model: string; was: Result; now: Result; reason: string; traceId: string }
}

export async function recordDraftCase(
  db: Db,
  input: DraftInput,
  bank: Bank = loadBank(),
): Promise<'stored' | 'duplicate'> {
  const rows = await db
    .insert(evalCaseDrafts)
    .values({
      disputeId: input.dispute.id,
      flagId: input.dispute.flagId,
      itemId: input.item.id,
      card: cardOf(input.item, bank),
      words: input.words.text,
      wordsFrom: input.words.from,
      entry: input.answer.entry,
      note: input.note,
      firstResult: input.regrade.was,
      opusModel: input.regrade.model,
      opusResult: input.regrade.now,
      opusReason: input.regrade.reason,
      opusTraceId: input.regrade.traceId,
      answeredAt: new Date(input.answer.reviewedAt),
      flaggedAt: input.dispute.flaggedAt,
    })
    .onConflictDoNothing({ target: evalCaseDrafts.disputeId })
    .returning({ id: evalCaseDrafts.id })
  return rows.length > 0 ? 'stored' : 'duplicate'
}

export async function flaggedView(db: Db): Promise<FlaggedView> {
  const [rows, tallies] = await Promise.all([
    db
      .select()
      .from(evalCaseDrafts)
      .where(eq(evalCaseDrafts.status, 'draft'))
      .orderBy(asc(evalCaseDrafts.createdAt), asc(evalCaseDrafts.id)),
    db
      .select({ status: evalCaseDrafts.status, n: count() })
      .from(evalCaseDrafts)
      .groupBy(evalCaseDrafts.status),
  ])
  const tally = (status: 'approved' | 'fixed' | 'rejected') =>
    tallies.find((row) => row.status === status)?.n ?? 0
  return {
    drafts: rows.map((row) => ({
      id: row.id,
      flagId: row.flagId,
      card: draftCardSchema.parse(row.card),
      words: row.words,
      wordsFrom: row.wordsFrom,
      entry: row.entry,
      note: row.note,
      firstResult: row.firstResult,
      opusModel: row.opusModel,
      opusResult: row.opusResult,
      opusReason: row.opusReason,
      answeredAt: row.answeredAt.toISOString(),
      flaggedAt: row.flaggedAt.toISOString(),
    })),
    reviewed: { approved: tally('approved'), fixed: tally('fixed'), rejected: tally('rejected') },
  }
}

export type ReviewOutcome =
  | {
      status: 200
      body: { ok: true; status: 'approved' | 'fixed' | 'rejected'; returned: boolean }
    }
  | { status: 404; body: { error: 'unknown case' } }
  | { status: 409; body: { error: 'already reviewed' } }

export async function reviewDraftCase(
  db: Db,
  request: ReviewRequest,
  now: Date = new Date(),
): Promise<ReviewOutcome> {
  const [draft] = await db.select().from(evalCaseDrafts).where(eq(evalCaseDrafts.id, request.id))
  if (!draft) return { status: 404, body: { error: 'unknown case' } }
  const status =
    request.action === 'approve' ? 'approved' : request.action === 'fix' ? 'fixed' : 'rejected'
  const expected =
    request.action === 'approve'
      ? draft.opusResult
      : request.action === 'fix'
        ? request.expected
        : null
  const expectedReason =
    request.action === 'approve'
      ? draft.opusReason
      : request.action === 'fix'
        ? request.reason.trim()
        : null
  const [updated] = await db
    .update(evalCaseDrafts)
    .set({ status, expected, expectedReason, reviewedAt: now })
    .where(and(eq(evalCaseDrafts.id, draft.id), eq(evalCaseDrafts.status, 'draft')))
    .returning()
  if (!updated) {
    const [current] = await db.select().from(evalCaseDrafts).where(eq(evalCaseDrafts.id, draft.id))
    if (current) await settle(db, current, now)
    return { status: 409, body: { error: 'already reviewed' } }
  }
  const returned = await settle(db, updated, now)
  return { status: 200, body: { ok: true, status, returned } }
}

const REGRADE_RUNNING_MS = 10 * 60_000

async function settle(
  db: Db,
  row: typeof evalCaseDrafts.$inferSelect,
  now: Date,
): Promise<boolean> {
  if (row.status === 'draft') return false
  const final = row.expected ?? row.opusResult
  await db
    .update(disputes)
    .set({
      outcome: RANK[final] > RANK[row.firstResult] ? 'overturned' : 'upheld',
      reviewedAt: row.reviewedAt ?? now,
    })
    .where(and(eq(disputes.id, row.disputeId), isNull(disputes.reviewedAt)))
  return returnToDeck(db, row, now)
}

async function returnToDeck(
  db: Db,
  row: typeof evalCaseDrafts.$inferSelect,
  now: Date,
): Promise<boolean> {
  await db
    .update(itemFlags)
    .set({ resolvedAt: now, resolution: `test case ${row.status}` })
    .where(
      and(
        eq(itemFlags.itemId, row.itemId),
        isNull(itemFlags.resolvedAt),
        lte(itemFlags.flaggedAt, row.flaggedAt),
        notExists(
          db
            .select({ one: sql`1` })
            .from(evalCaseDrafts)
            .where(and(eq(evalCaseDrafts.itemId, row.itemId), eq(evalCaseDrafts.status, 'draft'))),
        ),
        notExists(
          db
            .select({ one: sql`1` })
            .from(disputes)
            .where(
              and(
                eq(disputes.kind, 'card'),
                eq(disputes.itemId, row.itemId),
                isNull(disputes.reviewedAt),
                sql`${disputes.regrade}->>'status' = 'pending'`,
                gt(disputes.createdAt, new Date(now.getTime() - REGRADE_RUNNING_MS)),
              ),
            ),
        ),
      ),
    )
  const [stillPulled] = await db
    .select({ itemId: itemFlags.itemId })
    .from(itemFlags)
    .where(and(eq(itemFlags.itemId, row.itemId), isNull(itemFlags.resolvedAt)))
  return stillPulled === undefined
}

export async function rightOnCards(db: Db): Promise<number> {
  const rows = await db
    .select({
      itemId: evalCaseDrafts.itemId,
      first: evalCaseDrafts.firstResult,
      expected: evalCaseDrafts.expected,
    })
    .from(evalCaseDrafts)
    .where(inArray(evalCaseDrafts.status, ['approved', 'fixed']))
  const cards = new Set<string>()
  for (const row of rows) {
    if (row.expected && RANK[row.expected] > RANK[row.first]) cards.add(row.itemId)
  }
  return cards.size
}
