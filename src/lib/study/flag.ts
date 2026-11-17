import 'server-only'

// 'This looks wrong': stores the learner's note, pulls the card from rotation and asks
// a stronger model to re-grade. A correction never lowers a grade.

import { createHash, randomUUID } from 'node:crypto'

import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { loadBank, type Bank } from '../content/bank'
import { citationSources } from '../content/citations'
import type { Item } from '../content/schema'
import type { Db } from '../db/client'
import { disputes, itemFlags, reviewEvents } from '../db/schema'
import {
  cardRegradeSystemPrompt,
  cardRegradeUserPrompt,
  plainReason,
  type CardRegradeOutput,
} from '../grader/card-regrade'
import { ROLES, type ModelId, type Usage } from '../grader/models'
import { proposeRating } from '../scheduler/rating'
import type { StructuredRequest } from '../tutor/anthropic'
import { TutorError } from '../tutor/errors'
import { runTutorCall } from '../tutor/run'

import { reviewEventSchema, sessionModeSchema, type FlagAnswer, type ReviewEvent } from './contract'
import { loadDeck, type Deck } from './deck'
import { recordDraftCase } from './flag-cases'
import { recordReview } from './state'

export const CARD_REGRADE_TIMEOUT_MS = 45_000

export const CARD_REGRADE_ESTIMATE_USD = 0.1

export type AskCardRegrade = (
  request: StructuredRequest,
  signal: AbortSignal,
) => Promise<{ value: CardRegradeOutput; model: ModelId; usage: Usage }>

export type FlagDeps = {
  db: Db
  ask: AskCardRegrade

  defer: (task: () => Promise<void>) => void
  now?: () => Date
  bank?: Bank
  deck?: Deck
}

export const REGRADE_DEVICE = 'opus-regrade'

export function correctionEventId(itemId: string, reviewedAt: Date): string {
  const hash = createHash('sha1')
    .update(`${REGRADE_DEVICE}:${itemId}:${reviewedAt.toISOString()}`)
    .digest()
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80
  const hex = hash.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

type Result = 'right' | 'partial' | 'wrong'
const RANK: Record<Result, number> = { wrong: 0, partial: 1, right: 2 }

export type Correction =
  | { status: 'applied'; eventId: string; rating: number }
  | { status: 'waiting'; reviewedAt: string }
  | { status: 'none'; why: string }

export type CardRegrade =
  | { status: 'pending' }
  | {
      status: 'done'
      model: string
      was: Result
      now: Result
      agrees: boolean
      reason: string
      traceId: string
      correction: Correction
    }
  | { status: 'not-run'; reason: string; traceId: string | null }

const ratingSchema = reviewEventSchema.shape.proposedRating
const resultSchema = z.enum(['right', 'partial', 'wrong'])
const doneSchema = z.object({
  status: z.literal('done'),
  model: z.string(),
  was: resultSchema,
  now: resultSchema,
  agrees: z.boolean(),
  reason: z.string(),
  traceId: z.string(),
  correction: z.discriminatedUnion('status', [
    z.object({ status: z.literal('applied'), eventId: z.string(), rating: z.number() }),
    z.object({ status: z.literal('waiting'), reviewedAt: z.string() }),
    z.object({ status: z.literal('none'), why: z.string() }),
  ]),
})

export type FlagOutcome =
  { status: 200; body: { ok: true } } | { status: 404; body: { error: 'unknown card' } }

export type CardFlag = { itemId: string; note: string; flagId?: string; answer?: FlagAnswer }

function answerEvents(db: Db, itemId: string, reviewedAt: string) {
  return db
    .select()
    .from(reviewEvents)
    .where(and(eq(reviewEvents.itemId, itemId), eq(reviewEvents.reviewedAt, new Date(reviewedAt))))
}

export async function correctGrade(
  db: Db,
  item: Item,
  reviewedAt: string,
  regraded: Result,
  traceId: string,
  deps: Pick<FlagDeps, 'now' | 'deck'>,
): Promise<Correction> {
  const events = await answerEvents(db, item.id, reviewedAt)
  if (events.length === 0) return { status: 'waiting', reviewedAt }
  const base = events.find((event) => !event.overridden)
  if (base?.gradedBy === 'self') return { status: 'none', why: 'the learner rated it themselves' }
  const existing = events.find((event) => event.deviceId === REGRADE_DEVICE)
  if (existing) return alreadyCorrected(existing, traceId)
  if (!base || events.some((event) => event.overridden)) {
    return { status: 'none', why: 'the learner changed the rating themselves' }
  }
  const mode = sessionModeSchema.safeParse(base.mode)
  const proposed = ratingSchema.safeParse(base.proposedRating)
  if (!mode.success || !proposed.success) return { status: 'none', why: 'not a study answer' }
  if (RANK[regraded] <= RANK[base.result]) {
    return { status: 'none', why: 'not better than first graded' }
  }
  const rating = proposeRating({
    correct: regraded,
    answerMs: base.answerMs,
    hintUsed: base.hintUsed,
    hintImposed: base.hintImposed,
    itemType: item.type,
    format: base.format,
  })
  const stands: number = base.rating
  if (rating.valueOf() === stands) {
    return { status: 'none', why: 'their schedule already matches this grade' }
  }
  const eventId = correctionEventId(item.id, base.reviewedAt)
  const at = deps.now?.() ?? new Date()
  const correction: ReviewEvent = {
    eventId,
    itemId: item.id,
    mode: mode.data,
    result: regraded,
    rating,
    proposedRating: proposed.data,
    overridden: true,
    answerText: base.answerText,
    answerMs: base.answerMs,
    hintUsed: base.hintUsed,
    hintImposed: base.hintImposed,
    format: base.format,
    gradedBy: 'tutor',
    traceId,
    deviceId: REGRADE_DEVICE,
    reviewedAt: base.reviewedAt.toISOString(),
    changedAt: new Date(base.reviewedAt.getTime() + 1).toISOString(),
  }
  const stored = await recordReview(db, deps.deck ?? loadDeck(), correction, at)
  if (stored === 'duplicate') {
    const [winner] = await db.select().from(reviewEvents).where(eq(reviewEvents.id, eventId))
    if (winner) return alreadyCorrected(winner, traceId)
  }
  if (stored !== 'stored') return { status: 'none', why: `not stored (${stored})` }
  return { status: 'applied', eventId, rating }
}

function alreadyCorrected(
  event: { id: string; traceId: string | null; rating: number },
  traceId: string,
): Correction {
  return event.traceId === traceId
    ? { status: 'applied', eventId: event.id, rating: event.rating }
    : { status: 'none', why: 'already corrected' }
}

export async function regradeCard(
  db: Db,
  item: Item,
  answer: FlagAnswer,
  note: string,
  deps: Pick<FlagDeps, 'ask' | 'now' | 'bank' | 'deck'>,
): Promise<CardRegrade> {
  return (await judgeCard(db, item, answer, note, deps)).regrade
}

export type JudgedWords = { text: string; from: 'answer' | 'note' }

async function judgeCard(
  db: Db,
  item: Item,
  answer: FlagAnswer,
  note: string,
  deps: Pick<FlagDeps, 'ask' | 'now' | 'bank' | 'deck'>,
): Promise<{ regrade: CardRegrade; words: JudgedWords | null }> {
  const notRun = (reason: string, traceId: string | null = null) => ({
    regrade: { status: 'not-run', reason, traceId } satisfies CardRegrade,
    words: null,
  })
  const traceId = randomUUID()
  const events = await answerEvents(db, item.id, answer.reviewedAt)
  const base = events.find((event) => !event.overridden)

  const was = base?.result ?? answer.result
  const said = base?.answerText ?? answer.text
  const words: JudgedWords = { text: said, from: base ? 'answer' : 'note' }
  if ((base?.gradedBy ?? answer.gradedBy) === 'self') {
    return notRun('the learner rated it themselves: their rating stands')
  }
  if (said.trim() === '') return notRun('nothing the learner said to re-grade')
  if (was === 'right') return notRun('already graded right')
  const bank = deps.bank ?? loadBank()
  const sources = citationSources(item.citations, bank.passages, bank.runs)
  let value: CardRegradeOutput
  try {
    const call = await runTutorCall(
      {
        db,
        kind: 'dispute',
        traceId,
        estimateUsd: CARD_REGRADE_ESTIMATE_USD,
        timeoutMs: CARD_REGRADE_TIMEOUT_MS,
        ...(deps.now ? { now: deps.now } : {}),
        verdict: (output: CardRegradeOutput) => ({
          itemId: item.id,
          result: output.result,
          missing: output.missing,
        }),
      },
      (signal) =>
        deps.ask(
          {
            model: ROLES.dispute,
            system: [
              {
                type: 'text',
                text: cardRegradeSystemPrompt(),
                cache_control: { type: 'ephemeral' },
              },
            ],
            messages: [
              {
                role: 'user',
                content: cardRegradeUserPrompt(item, said, note, sources, answer.entry),
              },
            ],
            maxTokens: 4000,
            effort: 'medium',
          },
          signal,
        ),
    )
    value = call.value
  } catch (error) {
    if (error instanceof TutorError) return notRun(error.kind, traceId)
    throw error
  }
  const now = value.result
  const correction: Correction =
    RANK[now] > RANK[was]
      ? await correctGrade(db, item, answer.reviewedAt, now, traceId, deps)
      : { status: 'none', why: now === was ? 'Opus agreed' : 'not better than first graded' }
  return {
    regrade: {
      status: 'done',
      model: ROLES.dispute,
      was,
      now,
      agrees: now === was,
      reason: plainReason(value.reason),
      traceId,
      correction,
    },
    words,
  }
}

export async function fileCardFlag(flag: CardFlag, deps: FlagDeps): Promise<FlagOutcome> {
  const bank = deps.bank ?? loadBank()
  const item = bank.byId.get(flag.itemId)
  if (!item) return { status: 404, body: { error: 'unknown card' } }
  const { db } = deps

  await db
    .insert(itemFlags)
    .values({ itemId: item.id, reason: 'this-looks-wrong' })
    .onConflictDoUpdate({
      target: itemFlags.itemId,
      set: {
        reason: 'this-looks-wrong',
        flaggedAt: sql`now()`,
        resolvedAt: null,
        resolution: null,
      },
      setWhere: sql`${itemFlags.resolvedAt} is not null`,
    })
  const { answer } = flag
  const [row] = await db
    .insert(disputes)
    .values({
      kind: 'card',
      itemId: item.id,
      note: flag.note,
      flagId: flag.flagId,
      regrade: answer ? ({ status: 'pending' } satisfies CardRegrade) : null,
    })
    .onConflictDoNothing({ target: disputes.flagId })
    .returning({ id: disputes.id, createdAt: disputes.createdAt })

  if (row && answer) {
    deps.defer(async () => {
      let judged: { regrade: CardRegrade; words: JudgedWords | null }
      try {
        judged = await judgeCard(db, item, answer, flag.note, { ...deps, bank })
      } catch (error) {
        console.error('card re-grade failed', error instanceof Error ? error.name : 'error')
        judged = { regrade: { status: 'not-run', reason: 'error', traceId: null }, words: null }
      }
      const { regrade, words } = judged
      await storeRegrade(db, row.id, item, regrade, deps)

      if (regrade.status === 'done' && words) {
        try {
          await recordDraftCase(
            db,
            {
              dispute: { id: row.id, flagId: flag.flagId ?? null, flaggedAt: row.createdAt },
              item,
              words,
              answer,
              note: flag.note,
              regrade,
            },
            bank,
          )
        } catch (error) {
          console.error('draft test case failed', error instanceof Error ? error.name : 'error')
        }
      }
    })
  }
  return { status: 200, body: { ok: true } }
}

export async function storeRegrade(
  db: Db,
  disputeId: string,
  item: Item,
  regrade: CardRegrade,
  deps: Pick<FlagDeps, 'now' | 'deck'> = {},
): Promise<void> {
  await db
    .update(disputes)
    .set({ regrade })
    .where(and(eq(disputes.id, disputeId), sql`${disputes.regrade}->>'status' = 'pending'`))
  if (regrade.status === 'done' && regrade.correction.status === 'waiting') {
    await resolveWaiting(db, disputeId, item, regrade, deps)
  }
}

type WaitingRegrade = z.infer<typeof doneSchema>

async function resolveWaiting(
  db: Db,
  disputeId: string,
  item: Item,
  regrade: WaitingRegrade,
  deps: Pick<FlagDeps, 'now' | 'deck'>,
): Promise<void> {
  if (regrade.correction.status !== 'waiting') return
  let correction: Correction
  try {
    correction = await correctGrade(
      db,
      item,
      regrade.correction.reviewedAt,
      regrade.now,
      regrade.traceId,
      deps,
    )
  } catch (error) {
    console.error('card re-grade correction failed', error instanceof Error ? error.name : 'error')
    correction = { status: 'none', why: 'correction failed' }
  }
  if (correction.status === 'waiting') return
  await db
    .update(disputes)
    .set({ regrade: { ...regrade, correction } })
    .where(
      and(
        eq(disputes.id, disputeId),
        sql`${disputes.regrade}->'correction'->>'status' = 'waiting'`,
      ),
    )
}

export async function applyWaitingCorrections(
  db: Db,
  event: Pick<ReviewEvent, 'itemId' | 'reviewedAt'>,
  deps: Pick<FlagDeps, 'now' | 'bank' | 'deck'> = {},
): Promise<void> {
  const rows = await db
    .select({ id: disputes.id, regrade: disputes.regrade })
    .from(disputes)
    .where(
      and(
        eq(disputes.kind, 'card'),
        eq(disputes.itemId, event.itemId),
        sql`${disputes.regrade}->'correction'->>'status' = 'waiting'`,
      ),
    )
  if (rows.length === 0) return
  const item = (deps.bank ?? loadBank()).byId.get(event.itemId)
  const at = new Date(event.reviewedAt).getTime()
  for (const row of rows) {
    const regrade = doneSchema.safeParse(row.regrade)
    if (!regrade.success || regrade.data.correction.status !== 'waiting') continue
    if (new Date(regrade.data.correction.reviewedAt).getTime() !== at) continue
    if (!item) {
      await db
        .update(disputes)
        .set({
          regrade: {
            ...regrade.data,
            correction: { status: 'none', why: 'not a card in the bank' },
          },
        })
        .where(eq(disputes.id, row.id))
      continue
    }
    await resolveWaiting(db, row.id, item, regrade.data, deps)
  }
}
