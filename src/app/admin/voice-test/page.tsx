import type { Metadata } from 'next'

import { Card } from '@/components/Card'
import { Text } from '@/components/Text'
import { AdminFrame } from '@/components/admin/AdminFrame'
import { todayLabel } from '@/lib/dashboard/format'
import {
  decisionText,
  holdText,
  listVoiceTestRuns,
  musicText,
  overall,
  percent,
  type VoiceTestRunView,
} from '@/lib/dashboard/voice-test'
import { getDb } from '@/lib/db/client'

import styles from './page.module.css'

export const metadata: Metadata = { title: 'Admin · Voice test results' }
export const dynamic = 'force-dynamic'

const MODE: Record<VoiceTestRunView['mode'], string> = {
  'safari-tab': 'Safari tab',
  'home-screen': 'Home Screen app',
}

function modeLine(run: VoiceTestRunView | null): string {
  return run ? `${percent(run.errorRate)} of key words missed` : 'no full run yet'
}

export default async function VoiceTestResultsPage() {
  const runs = await listVoiceTestRuns(await getDb())
  const summary = overall(runs)
  const paidService = summary.decision.decided && summary.decision.path === 'switch'
  return (
    <AdminFrame current="system" subPage today={todayLabel(new Date())}>
      <Text as="h2" variant="title">
        Voice test results
      </Text>
      <Card kind={paidService ? 'warn' : 'card'} label="Decision">
        <Text as="h3" variant="body-l-strong">
          Decision, committed in advance
        </Text>
        <Text as="p" variant="body-l">
          {runs.length === 0
            ? 'No run yet. The learner runs it on their iPad: once in a Safari tab, once from the Home Screen.'
            : decisionText(summary)}
        </Text>
        <Text as="p" variant="body" tone="text-2">
          Safari tab: {modeLine(summary.safari)} · Home Screen app: {modeLine(summary.homeScreen)}
        </Text>
      </Card>
      <ul className={styles.runs}>
        {runs.map((run) => (
          <li key={run.id}>
            <Card label={`Run ${run.at}`}>
              <Text as="p" variant="body-strong">
                {MODE[run.mode]} ·{' '}
                {new Date(run.at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}
              </Text>
              <Text as="p" variant="figure">
                {run.keyTermsMissed} of {run.keyTermsTotal}
              </Text>
              <Text as="p" variant="caption" tone="text-muted">
                key words missed ({percent(run.errorRate)}) · {run.sentencesHeard} of{' '}
                {run.sentencesTotal} sentences heard · read-aloud{' '}
                {run.readAloudWorked ? 'worked' : 'failed'} · {run.stalls} stalls ·{' '}
                {musicText(run.musicPlaying)}
              </Text>
              <Text as="p" variant="body" tone="text-2">
                {holdText(run.hold)}
              </Text>
              {run.completed ? null : (
                <Text as="p" variant="body" tone="warn-text">
                  Ended early: {run.sentencesRead} of {run.sentencesTotal} sentences read, so it
                  doesn’t count toward the decision.
                </Text>
              )}
              {run.missedTerms.length > 0 ? (
                <Text as="p" variant="body" tone="text-2">
                  Missed: {run.missedTerms.join(', ')}
                </Text>
              ) : null}
            </Card>
          </li>
        ))}
      </ul>
    </AdminFrame>
  )
}
