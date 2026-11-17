'use client'

import { Fragment } from 'react'

import { Card } from '@/components/Card'
import { Text } from '@/components/Text'
import { Placeholder } from '@/components/progress/Placeholder'
import { useLoad } from '@/components/progress/useLoad'
import { EVAL_CATEGORIES, fetchSystem, type SystemData } from '@/lib/dashboard/client'
import {
  countOf,
  formatCount,
  formatPercent,
  formatSeconds,
  formatShortDate,
  formatUsd,
} from '@/lib/dashboard/format'

import { FREE_PLAN_BYTES, formatMb, overWarnLine, planShare, WARN_BYTES } from '@/lib/db/size'

import { AdminAlert } from './AdminAlert'
import { DataTable } from './DataTable'
import styles from './panels.module.css'
import { NO_DATA, StatTile } from './StatTile'

const CARD_BUDGET_MS = 2500
const REPORT_BUDGET_MS = 15_000

type EvalGate = SystemData['evalGate']

function seconds(ms: number | null): string | null {
  return ms === null ? null : formatSeconds(ms)
}

function runDay(runAt: string): string {
  const at = new Date(runAt)
  return Number.isNaN(at.getTime()) ? runAt : formatShortDate(at)
}

function EvalGatePanel({ gate }: { gate: EvalGate | undefined }) {
  const value = (text: (g: NonNullable<EvalGate>) => string, variant: 'body-strong' | 'title') =>
    gate ? (
      <Text variant={variant}>{text(gate)}</Text>
    ) : (
      <Placeholder variant={variant} width="third" />
    )
  return (
    <Card label="Eval gate">
      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <Text as="h2" variant="body-l-strong">
            Eval gate
          </Text>
          {gate ? (
            <Text variant="caption" tone="text-subtle">
              grader: {gate.grader} · rubric {gate.rubric} (pinned) · run {runDay(gate.runAt)}
            </Text>
          ) : null}
        </div>
        {gate === null ? (
          <Text as="p" variant="body" tone="text-muted">
            No eval run yet.
          </Text>
        ) : (
          <>
            <ul className={styles.list}>
              {EVAL_CATEGORIES.map((name) => (
                <li key={name} className={styles.listRow}>
                  <Text variant="body">{name}</Text>
                  {value((g) => {
                    const rate = g.categories[name]
                    return rate === undefined ? NO_DATA : formatPercent(rate, { decimals: 1 })
                  }, 'body-strong')}
                </li>
              ))}
            </ul>
            <div className={styles.split}>
              <div className={styles.stat}>
                <Text variant="caption" tone="text-muted">
                  Held-out agreement
                </Text>
                {value(
                  (g) =>
                    g.heldOutAgreement === null
                      ? NO_DATA
                      : formatPercent(g.heldOutAgreement, { decimals: 1 }),
                  'title',
                )}
              </div>
              <div className={styles.stat}>
                <Text variant="caption" tone="text-muted">
                  False passes
                </Text>
                {gate ? (
                  <Text variant="title">
                    {gate.falsePasses === null ? NO_DATA : formatCount(gate.falsePasses)}
                    {gate.adversarial ? (
                      <Text variant="body-strong" tone="text-muted">
                        {' '}
                        · adversarial {countOf(gate.adversarial.held, gate.adversarial.of)} held
                      </Text>
                    ) : null}
                  </Text>
                ) : (
                  <Placeholder variant="title" width="third" />
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </Card>
  )
}

function DisputesPanel({ disputes }: { disputes: SystemData['disputes'] | undefined }) {
  return (
    <Card label="Disputes and flags">
      <div className={styles.panel}>
        <Text as="h2" variant="body-l-strong">
          Disputes &amp; flags
        </Text>
        {disputes === undefined ? (
          <Placeholder variant="body" />
        ) : disputes.length === 0 ? (
          <Text as="p" variant="body" tone="text-muted">
            No disputes or flags yet.
          </Text>
        ) : (
          disputes.map((dispute, index) => {
            const open = dispute.status === 'Needs review'
            return (
              <div
                key={`${dispute.title}-${String(index)}`}
                className={`${styles.dispute ?? ''} ${open ? (styles.needsReview ?? '') : ''}`}
              >
                <div className={styles.listRow}>
                  <Text variant="body-strong">{dispute.title}</Text>
                  <Text variant="caption-strong" tone={open ? 'warn-text' : 'text-muted'}>
                    {dispute.status}
                  </Text>
                </div>
                <Text as="p" variant="body" tone={open ? 'warn-text-muted' : 'text-muted'}>
                  {dispute.note}
                </Text>
              </div>
            )
          })
        )}
      </div>
    </Card>
  )
}

const TRACE_COLUMNS = [
  { header: 'Correlation ID' },
  { header: 'Call' },
  { header: 'Latency', align: 'end' as const },
  { header: 'Cost', align: 'end' as const },
  { header: 'Model', align: 'end' as const },
]

function callsCaption(calls: { total: number; fallbacks: number; micReports: number }): string {
  const graded =
    calls.total === 0
      ? 'No graded calls yet'
      : `${countOf(calls.fallbacks, calls.total)} calls fell back to self-grading`
  return calls.micReports > 0
    ? `${graded} · ${String(calls.micReports)} mic problems reported this week`
    : graded
}

export function SystemView() {
  const [state, retry] = useLoad(fetchSystem)
  if (state.status === 'error') {
    return <AdminAlert error={state.error} retry={retry} next="/admin/system" />
  }
  const data = state.status === 'ready' ? state.data : null
  const latency = data?.latency
  const calls = data?.calls

  return (
    <Fragment key={data ? 'loaded' : 'loading'}>
      <section aria-label="Health" className={styles.four}>
        <StatTile
          label="Cost today"
          value={data ? formatUsd(data.cost.today) : undefined}
          bar={data ? data.cost.today / data.cost.dailyCap : 0}
          caption={
            data
              ? `${formatUsd(data.cost.today)} of ${formatUsd(data.cost.dailyCap)} daily cap · ${formatUsd(data.cost.month)} this month of ${formatUsd(data.cost.monthlyLimit)}`
              : undefined
          }
        />
        <StatTile
          label="Flashcard verdict p95"
          value={latency ? seconds(latency.cardP95Ms) : undefined}
          caption={
            latency
              ? `budget ${formatSeconds(CARD_BUDGET_MS)}${latency.cardP50Ms === null ? '' : ` · p50 ${formatSeconds(latency.cardP50Ms)}`}`
              : undefined
          }
        />
        <StatTile
          label="Rep report p95"
          value={latency ? seconds(latency.practiceP95Ms) : undefined}
          caption={
            latency
              ? `budget ${formatSeconds(REPORT_BUDGET_MS)}${latency.reviewP95Ms === null ? '' : ` · self-review spoken p95 ${formatSeconds(latency.reviewP95Ms)}`}`
              : undefined
          }
        />
        <StatTile
          label="Errors & fallbacks"
          value={
            calls
              ? calls.total === 0
                ? null
                : formatPercent(calls.fallbacks / calls.total, { decimals: 1, round: 'up' })
              : undefined
          }
          caption={calls ? callsCaption(calls) : undefined}
        />
      </section>

      <section aria-label="Database" className={styles.pair}>
        <StatTile
          label="Database size"
          value={data ? formatMb(data.database.bytes) : undefined}
          bar={data ? Math.min(1, data.database.bytes / FREE_PLAN_BYTES) : 0}
          alert={data ? overWarnLine(data.database.bytes) : false}
          caption={
            data
              ? `${planShare(data.database.bytes)} of the ${formatMb(FREE_PLAN_BYTES)} free plan · warns at ${formatMb(WARN_BYTES)}${overWarnLine(data.database.bytes) ? ' · past the line' : ''}`
              : undefined
          }
        />
        <StatTile
          label="Voice clips"
          value={data ? formatMb(data.database.clips.bytes) : undefined}
          caption={
            data
              ? `${formatCount(data.database.clips.rows)} ${data.database.clips.rows === 1 ? 'clip' : 'clips'} · the app’s voice, made once per line`
              : undefined
          }
        />
      </section>

      <div className={styles.pair}>
        <EvalGatePanel gate={data ? data.evalGate : undefined} />
        <DisputesPanel disputes={data?.disputes} />
      </div>

      <DataTable
        label="Recent traces"
        kind="traces"
        columns={TRACE_COLUMNS}
        empty={data ? 'No traces yet. Each graded card and mic practice adds one.' : 'Loading…'}
        rows={(data?.traces ?? []).map((trace, index) => ({
          key: `${trace.id}-${String(index)}`,
          cells: [
            { content: trace.id, variant: 'code', tone: 'text-muted' },
            { content: trace.call },
            { content: trace.latencyMs === null ? NO_DATA : formatSeconds(trace.latencyMs) },
            { content: formatUsd(trace.costUsd, 'call') },
            { content: trace.model ?? 'none', tone: 'text-muted' },
          ],
        }))}
      />
    </Fragment>
  )
}
