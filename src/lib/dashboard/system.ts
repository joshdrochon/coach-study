import { and, count, desc, eq, gte, notInArray, sql } from 'drizzle-orm'
import { z } from 'zod'

import { pacificDay } from '../budget/ledger'
import type { Db } from '../db/client'
import { apiSpend, disputes, evalRuns, traces, ttsClips } from '../db/schema'
import type { DatabaseSize } from '../db/size'

const regradeSchema = z.union([
  z.object({ status: z.literal('done'), agrees: z.boolean() }),
  z.object({ status: z.literal('not-run'), reason: z.string() }),
])

const sentence = (note: string) => {
  const said = note.trim()
  return said && !/[.!?…"”’)]$/.test(said) ? `${said}.` : said
}

const cardResult = z.enum(['right', 'partial', 'wrong'])
const cardRegradeSchema = z.union([
  z.object({ status: z.literal('pending') }),
  z.object({
    status: z.literal('done'),
    was: cardResult,
    now: cardResult,
    agrees: z.boolean(),
    reason: z.string(),
    correction: z.discriminatedUnion('status', [
      z.object({ status: z.literal('applied') }),
      z.object({ status: z.literal('waiting') }),
      z.object({ status: z.literal('none'), why: z.string() }),
    ]),
  }),
  z.object({ status: z.literal('not-run'), reason: z.string() }),
])

function cardRegradeNote(regrade: unknown, awaitingReview: boolean): string {
  if (regrade === null || regrade === undefined) {
    return awaitingReview ? 'No re-grade: the card waits for your review.' : 'No re-grade.'
  }
  const parsed = cardRegradeSchema.safeParse(regrade)
  if (!parsed.success) return 'Opus re-grade unreadable.'
  const data = parsed.data
  if (data.status === 'pending') return 'Opus re-grade not back yet.'
  if (data.status === 'not-run') return `Opus re-grade not run (${data.reason}).`
  const verdict = data.agrees
    ? `Opus re-grade agreed with the grader: ${data.now}.`
    : `Opus re-grade said ${data.now}, the grader said ${data.was}.`
  const why = sentence(data.reason)
  const grade =
    data.correction.status === 'applied'
      ? 'Their grade was corrected.'
      : data.correction.status === 'waiting'
        ? 'Their grade is corrected when their answer reaches the server.'
        : data.agrees
          ? ''
          : `Their grade stands (${data.correction.why}).`
  return [verdict, why, grade].filter(Boolean).join(' ')
}

export function regradeNote(
  kind: 'card' | 'practice',
  regrade: unknown,
  awaitingReview = true,
): string {
  if (kind === 'card') return cardRegradeNote(regrade, awaitingReview)
  if (regrade === null || regrade === undefined) return 'Opus re-grade not back yet.'
  const parsed = regradeSchema.safeParse(regrade)
  if (!parsed.success) return 'Opus re-grade unreadable.'
  if (parsed.data.status === 'not-run') return `Opus re-grade not run (${parsed.data.reason}).`
  return parsed.data.agrees
    ? 'Opus re-grade agreed with the grader.'
    : 'Opus re-grade disagreed with the grader.'
}

export type SystemView = {
  today: string

  cost: { today: number; dailyCap: 5; month: number; monthlyLimit: 50 }
  latency: {
    cardP50Ms: number | null
    cardP95Ms: number | null
    practiceP95Ms: number | null
    reviewP95Ms: number | null
  }

  calls: { total: number; fallbacks: number; micReports: number }

  database: DatabaseSize
  evalGate: {
    grader: string
    rubric: string
    categories: Record<string, number>
    heldOutAgreement: number | null
    falsePasses: number | null
    adversarial: { held: number; of: number } | null
    runAt: string
  } | null
  disputes: { title: string; status: 'Needs review' | 'Resolved'; note: string }[]
  traces: {
    id: string
    call: string
    latencyMs: number | null
    costUsd: number
    model: string | null
  }[]
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, index)] ?? null
}

const CALL_NAMES: Record<string, string> = {
  'card-grade': 'Card check',
  'practice-grade': 'Mic practice results',

  'practice-coaching': 'Mic practice coaching',
  explain: 'Explanation',
  chat: 'Chat',
  dispute: 'Dispute re-grade',
}

const stepSchema = z.object({
  name: z.string().optional(),
  ms: z.number().optional(),
  model: z.string().optional(),
})
type Step = z.infer<typeof stepSchema>

function stepsOf(value: unknown): Step[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item: unknown) => {
    const step = stepSchema.safeParse(item)
    return step.success ? [step.data] : []
  })
}

const categoriesSchema = z.record(z.string(), z.number()).catch({})

export async function systemView(db: Db, now: Date): Promise<SystemView> {
  const day = pacificDay(now)
  const monthStart = `${day.slice(0, 7)}-01`
  const [costToday] = await db
    .select({ usd: sql<string | null>`sum(${apiSpend.usd})` })
    .from(apiSpend)
    .where(and(eq(apiSpend.scope, 'app'), eq(apiSpend.day, day)))
  const [costMonth] = await db
    .select({ usd: sql<string | null>`sum(${apiSpend.usd})` })
    .from(apiSpend)
    .where(and(eq(apiSpend.scope, 'app'), gte(apiSpend.day, monthStart)))

  const weekAgo = new Date(now.getTime() - 7 * 86_400_000)

  const recent = await db
    .select()
    .from(traces)
    .where(and(gte(traces.startedAt, weekAgo), notInArray(traces.kind, ['tts', 'mic'])))
    .orderBy(desc(traces.startedAt))
  const ok = (kind: string) =>
    recent
      .filter((t) => t.kind === kind && t.outcome === 'ok' && t.totalMs !== null)
      .map((t) => t.totalMs ?? 0)
  const review = recent.flatMap((t) =>
    stepsOf(t.steps)
      .filter((s) => s.name === 'review')
      .map((s) => s.ms ?? 0),
  )
  const todayTraces = recent.filter((t) => pacificDay(t.startedAt) === day)
  const [mic] = await db
    .select({ n: sql<string>`count(*)` })
    .from(traces)
    .where(and(gte(traces.startedAt, weekAgo), eq(traces.kind, 'mic')))

  const latest = async (set: 'golden' | 'heldout' | 'adversarial') => {
    const [row] = await db
      .select()
      .from(evalRuns)
      .where(eq(evalRuns.set, set))
      .orderBy(desc(evalRuns.runAt))
      .limit(1)
    return row
  }
  const [golden, heldout, adversarial] = await Promise.all([
    latest('golden'),
    latest('heldout'),
    latest('adversarial'),
  ])

  const [sizeRow] = await db
    .select({
      bytes: sql<string>`pg_database_size(current_database())`,
      clipRows: count(),
      clipBytes: sql<string>`pg_total_relation_size('tts_clips')`,
    })
    .from(ttsClips)
  const size: DatabaseSize = {
    bytes: Number(sizeRow?.bytes ?? 0),
    clips: { rows: sizeRow?.clipRows ?? 0, bytes: Number(sizeRow?.clipBytes ?? 0) },
  }

  const disputeRows = await db.select().from(disputes).orderBy(desc(disputes.createdAt))

  return {
    today: new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      month: 'short',
      day: 'numeric',
    }).format(now),
    cost: {
      today: Number(costToday?.usd ?? 0),
      dailyCap: 5,
      month: Number(costMonth?.usd ?? 0),
      monthlyLimit: 50,
    },
    latency: {
      cardP50Ms: percentile(ok('card-grade'), 50),
      cardP95Ms: percentile(ok('card-grade'), 95),
      practiceP95Ms: percentile(ok('practice-grade'), 95),
      reviewP95Ms: percentile(review, 95),
    },
    database: size,
    calls: {
      total: todayTraces.length,
      fallbacks: todayTraces.filter((t) => t.outcome !== 'ok').length,
      micReports: Number(mic?.n ?? 0),
    },
    evalGate: golden
      ? {
          grader: golden.grader,
          rubric: golden.rubric,
          categories: categoriesSchema.parse(golden.categories),
          heldOutAgreement: heldout?.agreement ?? null,
          falsePasses: heldout ? heldout.falsePasses + (adversarial?.falsePasses ?? 0) : null,
          adversarial: adversarial
            ? { held: adversarial.cases - adversarial.falsePasses, of: adversarial.cases }
            : null,
          runAt: golden.runAt.toISOString(),
        }
      : null,
    disputes: disputeRows.map((d) => ({
      title:
        d.kind === 'card'
          ? `Card · ${d.itemId ?? 'unknown'}`
          : `Must-do ${d.gateId ?? ''} · practice`,
      status: d.outcome === 'pending' || d.outcome === 'pulled' ? 'Needs review' : 'Resolved',
      note: [
        sentence(d.note),
        regradeNote(d.kind, d.regrade, d.outcome === 'pending' || d.outcome === 'pulled'),
        d.outcome === 'pulled' ? 'Pulled from rotation until reviewed.' : '',
      ]
        .filter(Boolean)
        .join(' '),
    })),
    traces: recent.slice(0, 20).map((t) => ({
      id: t.id,
      call: `${CALL_NAMES[t.kind] ?? t.kind}${t.outcome === 'ok' ? '' : ` · ${t.error ?? 'fallback'}`}`,
      latencyMs: t.totalMs,
      costUsd: t.costUsd,
      model: stepsOf(t.steps).find((s) => s.model)?.model ?? null,
    })),
  }
}
