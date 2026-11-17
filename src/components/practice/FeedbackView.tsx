import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { Screen } from '@/components/Screen'
import { Text } from '@/components/Text'
import type { PracticeReport, ReportCheck } from '@/lib/practice/contract'

import styles from './MicPractice.module.css'

const VERDICT_WORD: Record<ReportCheck['verdict'], string> = {
  pass: 'Done',
  miss: 'Missed',
  'not-applicable': 'Not in this practice',
  unjudged: 'Not checked',
}

export function headline(report: PracticeReport): string {
  const { passed, of } = report.mustPass
  if (of === 0) return 'Practice saved.'
  return report.allMustPass
    ? `All ${String(of)} must-dos done.`
    : `${String(passed)} of ${String(of)} must-dos done.`
}

// Must-dos first, then the rest; checks that do not apply are left off.
export function shownChecks(report: PracticeReport): ReportCheck[] {
  return report.checks
    .filter((check) => check.verdict !== 'not-applicable')
    .toSorted((a, b) => Number(b.mustPass) - Number(a.mustPass))
}

export function FeedbackView({ report, onAgain }: { report: PracticeReport; onAgain: () => void }) {
  return (
    <Screen
      layout="sheet"
      footer={
        <Button variant="secondary" href="/">
          Home
        </Button>
      }
    >
      <Text as="h1" variant="headline-l">
        {headline(report)}
      </Text>
      <Card kind="accent" label="Feedback">
        <Text as="p" variant="body-l">
          {report.feedback.wentWell}
        </Text>
        <Text as="p" variant="body-l-strong">
          {report.feedback.toWorkOn}
        </Text>
      </Card>
      <ul className={styles.list}>
        {shownChecks(report).map((check) => (
          <li key={check.gateId} className={styles.check} data-verdict={check.verdict}>
            <Text as="p" variant="body-strong">
              {VERDICT_WORD[check.verdict]} · {check.label}
            </Text>
            <Text as="p" variant="caption" tone="text-muted">
              {check.quote ? `“${check.quote}”` : check.note}
            </Text>
          </li>
        ))}
      </ul>
      <Button variant="primary" onClick={onAgain}>
        Practice again
      </Button>
    </Screen>
  )
}
