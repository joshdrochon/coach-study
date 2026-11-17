import { beforeEach, describe, expect, it } from 'vitest'

import { recordSpend } from '../budget/ledger'
import { openTestDb, type Db } from '../db/client'
import { disputes, evalRuns, traces, ttsClips } from '../db/schema'

import { percentile, regradeNote, systemView } from './system'

const NOW = new Date('2026-08-18T17:00:00Z')

describe('percentile', () => {
  it('returns null for no data and the nearest-rank value otherwise', () => {
    expect(percentile([], 95)).toBeNull()
    expect(percentile([1200, 900, 1900, 1100], 95)).toBe(1900)
    expect(percentile([1200, 900, 1900, 1100], 50)).toBe(1100)
  })
})

describe('systemView', () => {
  let db: Db
  beforeEach(async () => {
    db = await openTestDb()
  })

  it('keeps the app voice’s lines out of the tutor’s calls, fallbacks and list', async () => {
    await db.insert(traces).values([
      {
        id: 'tts_1',
        kind: 'tts',
        startedAt: NOW,
        totalMs: 420,
        costUsd: 0,
        outcome: 'ok',
        steps: [{ name: 'elevenlabs', ms: 400, chars: 7 }],
      },
      {
        id: 'tts_2',
        kind: 'tts',
        startedAt: NOW,
        totalMs: 5,
        costUsd: 0,
        outcome: 'fallback',
        steps: [],
        error: 'budget',
      },
    ])
    const view = await systemView(db, NOW)
    expect(view.calls).toEqual({ total: 0, fallbacks: 0, micReports: 0 })
    expect(view.traces).toEqual([])
  })

  it('counts their mic reports of the last 7 days apart from the tutor’s calls', async () => {
    const mic = (id: string, startedAt: Date) => ({
      id,
      kind: 'mic' as const,
      startedAt,
      totalMs: 1500,
      costUsd: 0,
      outcome: 'error' as const,
      steps: [],
      result: { source: 'ipad', reason: 'ended-early' },
      error: 'ended-early',
    })
    await db
      .insert(traces)
      .values([
        mic('mic_1', NOW),
        mic('mic_2', new Date(NOW.getTime() - 86_400_000)),
        mic('mic_old', new Date(NOW.getTime() - 8 * 86_400_000)),
      ])
    const view = await systemView(db, NOW)
    expect(view.calls).toEqual({ total: 0, fallbacks: 0, micReports: 2 })
    expect(view.traces).toEqual([])
  })

  it('says what a card’s Opus re-grade found: both grades, the reason, and their grade', async () => {
    const at = (minute: number) => new Date(NOW.getTime() - (60 - minute) * 60_000)
    const done = {
      status: 'done',
      model: 'claude-opus-5-5',
      reason: 'The learner named the mat, the strap and the rollers, as the card does',
      traceId: 't1',
    }
    await db.insert(disputes).values([
      {
        kind: 'card',
        itemId: 'term-range',
        note: 'It heard me wrong',
        regrade: {
          ...done,
          was: 'partial',
          now: 'right',
          agrees: false,
          correction: { status: 'applied', eventId: 'e1', rating: 3 },
        },
        createdAt: at(1),
      },
      {
        kind: 'card',
        itemId: 'term-range',
        regrade: {
          ...done,
          was: 'partial',
          now: 'partial',
          agrees: true,
          reason: 'The strap is missing.',
          correction: { status: 'none', why: 'Opus agreed' },
        },
        outcome: 'upheld',
        createdAt: at(2),
      },
      {
        kind: 'card',
        itemId: 'term-range',
        regrade: {
          ...done,
          was: 'wrong',
          now: 'right',
          agrees: false,
          correction: { status: 'none', why: 'the learner rated it themselves' },
        },
        createdAt: at(3),
      },
      {
        kind: 'card',
        itemId: 'term-range',
        regrade: {
          ...done,
          was: 'wrong',
          now: 'partial',
          agrees: false,
          correction: { status: 'waiting', reviewedAt: NOW.toISOString() },
        },
        createdAt: at(4),
      },
      {
        kind: 'card',
        itemId: 'term-range',
        regrade: { status: 'not-run', reason: 'timeout', traceId: 't5' },
        createdAt: at(5),
      },
      {
        kind: 'card',
        itemId: 'term-range',
        regrade: { status: 'pending' },
        createdAt: at(6),
      },
    ])
    const view = await systemView(db, NOW)
    expect(view.disputes.map(({ status, note }) => ({ status, note }))).toEqual([
      { status: 'Needs review', note: 'Opus re-grade not back yet.' },

      { status: 'Needs review', note: 'Opus re-grade not run (timeout).' },
      {
        status: 'Needs review',
        note: 'Opus re-grade said partial, the grader said wrong. The learner named the mat, the strap and the rollers, as the card does. Their grade is corrected when their answer reaches the server.',
      },
      {
        status: 'Needs review',
        note: 'Opus re-grade said right, the grader said wrong. The learner named the mat, the strap and the rollers, as the card does. Their grade stands (the learner rated it themselves).',
      },
      {
        status: 'Resolved',
        note: 'Opus re-grade agreed with the grader: partial. The strap is missing.',
      },
      {
        status: 'Needs review',
        note: 'It heard me wrong. Opus re-grade said right, the grader said partial. The learner named the mat, the strap and the rollers, as the card does. Their grade was corrected.',
      },
    ])
    expect(view.disputes.every((d) => !/[—;]/.test(d.note))).toBe(true)
  })

  it('reads an unknown re-grade record as unreadable, never as a verdict', () => {
    expect(regradeNote('practice', { status: 'done' })).toBe('Opus re-grade unreadable.')

    expect(regradeNote('card', null, false)).toBe('No re-grade.')
  })

  it('shows honest empty values on day one', async () => {
    const view = await systemView(db, NOW)
    expect(view).toMatchObject({
      today: 'Aug 18',
      cost: { today: 0, dailyCap: 5, month: 0, monthlyLimit: 50 },
      latency: { cardP50Ms: null, cardP95Ms: null, practiceP95Ms: null, reviewP95Ms: null },
      calls: { total: 0, fallbacks: 0, micReports: 0 },
      evalGate: null,
      disputes: [],
      traces: [],
    })
  })

  it('reports the database size and the voice clips, read-only', async () => {
    const empty = await systemView(db, NOW)
    expect(empty.database.clips.rows).toBe(0)
    expect(empty.database.bytes).toBeGreaterThan(0)
    await db.insert(ttsClips).values([
      { id: 'a', voiceKey: 'v', chars: 30, audio: Buffer.alloc(200_000, 1) },
      { id: 'b', voiceKey: 'v', chars: 30, audio: Buffer.alloc(200_000, 2) },
    ])
    const view = await systemView(db, NOW)
    expect(view.database.clips.rows).toBe(2)
    expect(view.database.clips.bytes).toBeGreaterThan(empty.database.clips.bytes)
    expect(view.database.bytes).toBeGreaterThanOrEqual(view.database.clips.bytes)
  })

  it('reports real cost, latency, fallbacks, traces, disputes and the eval gate', async () => {
    await recordSpend(
      db,
      {
        scope: 'app',
        purpose: 'card-grade',
        model: 'claude-haiku-4-5',
        usage: { input_tokens: 1_000_000, output_tokens: 0 },
      },
      NOW,
    )
    await recordSpend(
      db,
      {
        scope: 'build',
        purpose: 'eval',
        model: 'claude-sonnet-5-5',
        usage: { input_tokens: 1_000_000, output_tokens: 0 },
      },
      NOW,
    )
    await db.insert(traces).values([
      {
        id: 'card_1',
        kind: 'card-grade',
        startedAt: NOW,
        totalMs: 1100,
        costUsd: 0.002,
        outcome: 'ok',
        steps: [{ name: 'model', ms: 1000, model: 'claude-haiku-4-5' }],
      },
      {
        id: 'card_2',
        kind: 'card-grade',
        startedAt: NOW,
        totalMs: 1900,
        costUsd: 0.002,
        outcome: 'ok',
        steps: [],
      },
      {
        id: 'rep_1',
        kind: 'practice-grade',
        startedAt: NOW,
        totalMs: 10_800,
        costUsd: 0.04,
        outcome: 'ok',
        steps: [{ name: 'review', ms: 3600, model: 'claude-sonnet-5-5' }],
      },
      {
        id: 'card_3',
        kind: 'card-grade',
        startedAt: NOW,
        totalMs: 8000,
        costUsd: 0,
        outcome: 'fallback',
        steps: [],
        error: 'timeout',
      },
    ])
    await db.insert(disputes).values({
      kind: 'card',
      itemId: 'term-range',
      note: 'The reviewer said otherwise',
      outcome: 'pending',
    })
    await db.insert(evalRuns).values([
      {
        set: 'golden',
        grader: 'claude-sonnet-5-5',
        strategy: 'evidence-first',
        rubric: 'v1',
        commit: 'abc',
        cases: 30,
        agreement: 0.97,
        falsePasses: 0,
        categories: { schema_valid: 1 },
        costUsd: 1.2,
        passed: true,
        runAt: NOW,
      },
      {
        set: 'heldout',
        grader: 'claude-sonnet-5-5',
        strategy: 'evidence-first',
        rubric: 'v1',
        commit: 'abc',
        cases: 30,
        agreement: 0.96,
        falsePasses: 0,
        categories: {},
        costUsd: 1.1,
        passed: true,
        runAt: NOW,
      },
      {
        set: 'adversarial',
        grader: 'claude-sonnet-5-5',
        strategy: 'evidence-first',
        rubric: 'v1',
        commit: 'abc',
        cases: 15,
        agreement: 0.98,
        falsePasses: 0,
        categories: {},
        costUsd: 0.6,
        passed: true,
        runAt: NOW,
      },
    ])
    const view = await systemView(db, NOW)
    expect(view.cost.today).toBeCloseTo(1)
    expect(view.cost.month).toBeCloseTo(1)
    expect(view.latency).toEqual({
      cardP50Ms: 1100,
      cardP95Ms: 1900,
      practiceP95Ms: 10_800,
      reviewP95Ms: 3600,
    })
    expect(view.calls).toEqual({ total: 4, fallbacks: 1, micReports: 0 })
    expect(view.traces.find((t) => t.id === 'card_3')?.call).toBe('Card check · timeout')
    expect(view.traces.find((t) => t.id === 'card_1')?.model).toBe('claude-haiku-4-5')
    expect(view.disputes[0]).toMatchObject({
      status: 'Needs review',
      note: 'The reviewer said otherwise. No re-grade: the card waits for your review.',
    })
    expect(view.evalGate).toMatchObject({
      heldOutAgreement: 0.96,
      falsePasses: 0,
      adversarial: { held: 15, of: 15 },
    })
  })

  it('shows the five category rates of the latest eval run', async () => {
    const run = (runAt: Date, categories: Record<string, number>, rubric: string) => ({
      set: 'golden' as const,
      grader: 'claude-sonnet-5-5',
      strategy: 'evidence-first',
      rubric,
      commit: rubric,
      cases: 30,
      agreement: 0.9,
      falsePasses: 0,
      categories,
      costUsd: 1,
      passed: true,
      runAt,
    })
    const older = {
      schema_valid: 0.5,
      citation_present: 0.5,
      verdict_correct: 0.5,
      no_invented_content: 0.5,
      stays_in_scope: 0.5,
    }
    const latest = {
      schema_valid: 1,
      citation_present: 0.98,
      verdict_correct: 0.968,
      no_invented_content: 0.99,
      stays_in_scope: 0.97,
    }

    await db.insert(evalRuns).values(run(new Date(NOW.getTime() - 3_600_000), latest, 'v3'))
    await db.insert(evalRuns).values(run(new Date(NOW.getTime() - 86_400_000), older, 'v2'))
    const view = await systemView(db, NOW)
    expect(view.evalGate?.categories).toEqual(latest)
    expect(view.evalGate?.rubric).toBe('v3')
    expect(view.evalGate?.runAt).toBe(new Date(NOW.getTime() - 3_600_000).toISOString())
  })
})
