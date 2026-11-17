'use client'

import { Fragment, type ReactNode } from 'react'

import { Card } from '@/components/Card'
import { Text } from '@/components/Text'
import { BarList, type BarRow } from '@/components/progress/BarList'
import { Placeholder } from '@/components/progress/Placeholder'
import { useLoad } from '@/components/progress/useLoad'
import { fetchLearning, type LearningData } from '@/lib/dashboard/client'
import { bandLabel, countOf, formatCount, formatPercent } from '@/lib/dashboard/format'
import { dayLabel, SCHEDULE } from '@/lib/schedule'

import { AdminAlert } from './AdminAlert'
import styles from './panels.module.css'
import { NO_DATA } from './StatTile'

function BarPanel({
  title,
  rows,
  empty,
  note,
}: {
  title: string
  rows: BarRow[] | undefined
  empty: string
  note?: ReactNode
}) {
  return (
    <Card label={title}>
      <div className={styles.panel}>
        <Text as="h2" variant="body-l-strong">
          {title}
        </Text>
        {rows === undefined ? (
          <div className={styles.list}>
            <Placeholder variant="body" />
            <Placeholder variant="body" />
          </div>
        ) : rows.length === 0 ? (
          <Text as="p" variant="body" tone="text-muted">
            {empty}
          </Text>
        ) : (
          <BarList size="admin" rows={rows} />
        )}
        {note ? (
          <Text as="p" variant="caption" tone="text-subtle">
            {note}
          </Text>
        ) : null}
      </div>
    </Card>
  )
}

function accuracyRows(sessions: LearningData['sessions']): BarRow[] {
  return sessions.map((session) => {
    const band = bandLabel(session.accuracy)
    return {
      label: session.label,
      value: session.accuracy,
      text: `${formatPercent(session.accuracy)}${band ? ` · ${band}` : ''}`,
    }
  })
}

function baselineRows(data: LearningData): BarRow[] {
  const rows: BarRow[] = []
  if (data.baseline) {
    rows.push({
      label: data.baseline.label,
      value: data.baseline.pct,
      text: `${formatPercent(data.baseline.pct)} of ${formatCount(data.baseline.of)} cards`,
    })
    rows.push(
      data.now
        ? {
            label: 'Now',
            value: data.now.pct,
            text: `${formatPercent(data.now.pct)} of ${formatCount(data.now.of)} cards`,
          }
        : { label: 'Now', value: 0, text: NO_DATA },
    )
  }
  return rows
}

function dueText(days: number): string {
  if (days === 0) return 'today'
  const n = Math.abs(days)
  const unit = n === 1 ? 'day' : 'days'
  return days > 0 ? `${formatCount(n)} ${unit} left` : `${formatCount(n)} ${unit} ago`
}

function northStarRows(star: LearningData['northStar']): BarRow[] {
  const run = star.sequencesInARow
  return [
    {
      label: 'Sequences in a row',
      value: Math.min(run.length, star.of) / star.of,
      text: `${countOf(run.length, star.of)}${run.length > 0 ? ` · ${run.join(', ')}` : ''}`,
    },
  ]
}

function northStarNote(star: LearningData['northStar']): string {
  const status = star.reachedOn
    ? `Reached ${star.reachedOn}.`
    : `${star.target} target: ${dueText(star.daysLeft)}.`
  return `Goal: every must-pass must-do on ${String(star.of)} different sequences in a row, by ${star.target}. ${status}`
}

function masteryRows(star: LearningData['northStar']): BarRow[] {
  return star.mastery.map((entry) => ({
    label: entry.label,
    value: Math.min(entry.sequences, star.of) / star.of,
    text: entry.mastered ? 'Mastered' : `${countOf(entry.sequences, star.of)} sequences`,
  }))
}

function masteryNote(star: LearningData['northStar']): string {
  const mastered = star.mastery.filter((entry) => entry.mastered).length
  return `Mastery: passed on ${String(star.of)} practices in a row across ${String(star.of)} different sequences. ${countOf(mastered, star.mastery.length)} mastered.`
}

export function LearningView({ recallHeading }: { recallHeading: string }) {
  const [state, retry] = useLoad(fetchLearning)
  if (state.status === 'error') {
    return <AdminAlert error={state.error} retry={retry} next="/admin/learning" />
  }
  const data = state.status === 'ready' ? state.data : null

  return (
    <Fragment key={data ? 'loaded' : 'loading'}>
      <section className={styles.pair}>
        <BarPanel
          title="Session accuracy"
          rows={data ? accuracyRows(data.sessions) : undefined}
          empty="No sessions yet."
          note="Target band 80–90%. Above it, new cards are added; below it, new cards pause."
        />
        <BarPanel
          title={recallHeading}
          rows={
            data
              ? data.readiness.map((r) => ({
                  label: r.category,
                  value: r.recall,
                  text: formatPercent(r.recall),
                }))
              : undefined
          }
          empty="No cards studied yet."
          note="Goal: 90% in every category."
        />
      </section>
      <section className={styles.pair}>
        <BarPanel
          title="Must-dos passed per mic practice"
          rows={
            data
              ? data.practices.map((p) => ({
                  label: p.label,
                  value: p.of === 0 ? 0 : p.passed / p.of,
                  text: countOf(p.passed, p.of),
                }))
              : undefined
          }
          empty="No mic practices yet."
          note={
            data ? `Most missed: ${data.mostMissed?.replace(/\.$/, '') ?? NO_DATA}.` : undefined
          }
        />
        <BarPanel
          title="Baseline vs now"
          rows={data ? baselineRows(data) : undefined}
          empty="No baseline check yet."
          note={
            data?.baseline
              ? `Same ${formatCount(data.baseline.of)}-card check, repeated before ${dayLabel(SCHEDULE.practiceDay)} and ${dayLabel(SCHEDULE.firstClass)}.`
              : undefined
          }
        />
      </section>
      <section className={styles.pair}>
        <BarPanel
          title="North star"
          rows={data ? northStarRows(data.northStar) : undefined}
          empty="No mic practices yet."
          note={data ? northStarNote(data.northStar) : undefined}
        />
        <BarPanel
          title="Must-dos mastered"
          rows={data ? masteryRows(data.northStar) : undefined}
          empty="No must-dos yet."
          note={data ? masteryNote(data.northStar) : undefined}
        />
      </section>
    </Fragment>
  )
}
