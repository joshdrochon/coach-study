'use client'

import { useSyncExternalStore } from 'react'

import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { Text } from '@/components/Text'
import { countOf, formatPercent } from '@/lib/dashboard/format'
import type { ApiError } from '@/lib/dashboard/http'
import {
  missedLine,
  progressCopy,
  progressData,
  rightOnCardsLine,
  type Practice,
  type ProgressData,
} from '@/lib/progress/client'
import { reminderKeyData } from '@/lib/nudges/client'
import { readinessHeading } from '@/lib/progress/milestones'
import { rightOnCardsLineEnabled } from '@/lib/study/flags'

import { Avatar } from './Avatar'
import { profileCounts } from './counts'
import { BarList } from './BarList'
import { Live } from './Live'
import { EMPTY_LINE } from './Placeholder'
import styles from './ProgressView.module.css'
import { RemindersCard } from './RemindersCard'
import { TextLink } from './TextLink'
import { TitleLadder } from './TitleLadder'
import { useCached } from './useCached'
import { useLocalCopy, useProfileCopy } from './useLocalCopy'

export const START_HREF = '/study'

function ProfileCard({
  profile,
  standIn,
}: {
  profile: ProgressData | null
  standIn: ProgressData | null
}) {
  const copy = useProfileCopy()
  const title = profile?.title ?? copy?.title ?? null
  const counts = (data: ProgressData) => profileCounts(data.practiceSessions, data.practiceClasses)
  return (
    <Card label="Coach Alex">
      <div className={styles.profile}>
        <div className={styles.top}>
          <div className={styles.identity}>
            <Avatar src={profile?.avatarUrl ?? copy?.avatarUrl ?? null} size="size-hero" />
            <div className={styles.names}>
              <Text as="p" variant="headline-m">
                Coach Alex
              </Text>
              <Text as="p" variant="subtitle" tone="text-2">
                <Live value={title} standIn={TITLE_STAND_IN} />
              </Text>
              <Text as="p" variant="body" tone="text-muted">
                <Live
                  value={profile ? counts(profile) : null}
                  standIn={standIn ? counts(standIn) : COUNTS_STAND_IN}
                />
              </Text>
            </div>
          </div>
          <TextLink href="/progress/title">Change title</TextLink>
        </div>
        <TitleLadder current={title} />
      </div>
    </Card>
  )
}

const TITLE_STAND_IN = 'Starter'
const COUNTS_STAND_IN = profileCounts({ done: 0, of: 3 }, { done: 0, of: 10 })

function ReadinessCard({
  heading,
  readiness,
  rightOnCards,
  loading,
}: {
  heading: string
  readiness: ProgressData['readiness']
  rightOnCards: ProgressData['rightOnCards']
  loading: boolean
}) {
  const right = rightOnCardsLineEnabled() ? rightOnCardsLine(rightOnCards) : null
  return (
    <Card>
      <div className={styles.readiness}>
        <Text as="h2" variant="label" tone="text-muted">
          {heading}
        </Text>
        <BarList
          size="progress"
          loading={loading}
          rows={readiness.map((r) => ({
            label: r.category,
            value: r.ready,
            text: formatPercent(r.ready),
          }))}
        />
        <Text as="p" variant="body" tone="text-muted">
          Goal: 90% in every category.
        </Text>
        {right ? (
          <Text as="p" variant="body" tone="text-muted" data-line="right-on-cards">
            <Live value={loading ? null : right} standIn={right} />
          </Text>
        ) : null}
      </div>
    </Card>
  )
}

function PracticesCard({ practices, loading }: { practices: Practice[]; loading: boolean }) {
  return (
    <Card>
      <div className={styles.practices}>
        <Text as="h2" variant="label" tone="text-muted">
          Mic practices
        </Text>
        <ul className={styles.practiceList}>
          {practices.slice(0, 3).map((practice, index) => (
            <li key={loading ? String(index) : practice.label} className={styles.practice}>
              <div className={styles.names}>
                <Text variant="body-l-strong">
                  <Live value={loading ? null : practice.label} standIn={practice.label} />
                </Text>
                <Text variant="body" tone="text-muted">
                  <Live
                    value={loading ? null : missedLine(practice.missed)}
                    standIn={missedLine(practice.missed)}
                  />
                </Text>
              </div>
              <Text variant="body-l-strong" className={styles.score}>
                <Live
                  value={loading ? null : countOf(practice.passed, practice.of)}
                  standIn={countOf(practice.passed, practice.of)}
                />
              </Text>
            </li>
          ))}
        </ul>
        <Text as="p" variant="body" tone="text-muted">
          Goal: every must-do on 3 different sequences in a row.
        </Text>
      </div>
    </Card>
  )
}

function Studied({
  heading,
  profile,
  loading,
}: {
  heading: string
  profile: ProgressData
  loading: boolean
}) {
  const practices = profile.practices ?? []
  const hasReadiness = profile.readiness.length > 0
  if (profile.isDayOne || (!hasReadiness && practices.length === 0)) return <DayOneCard />
  return (
    <div className={hasReadiness && practices.length > 0 ? styles.pair : styles.single}>
      {hasReadiness ? (
        <ReadinessCard
          heading={heading}
          readiness={profile.readiness}
          rightOnCards={profile.rightOnCards}
          loading={loading}
        />
      ) : null}
      {practices.length > 0 ? <PracticesCard practices={practices} loading={loading} /> : null}
    </div>
  )
}

function DayOneCard() {
  return (
    <Card>
      <div className={styles.message}>
        <Text as="h2" variant="label" tone="text-muted">
          Nothing here yet
        </Text>
        <Text as="p" variant="subtitle">
          Your readiness and mic practices show up after your first session.
        </Text>
        <Button variant="primary" href={START_HREF}>
          Start
        </Button>
      </div>
    </Card>
  )
}

const ERROR_TEXT: Record<ApiError, string> = {
  network: 'No connection. Check your Wi-Fi, then try again.',
  server: 'Your progress didn’t load. Try again in a minute.',
  invalid: 'Your progress didn’t load. Try again in a minute.',
  unauthorized: 'Enter your passcode again to see your progress.',
}

function ErrorCard({ error, retry }: { error: ApiError; retry: () => void }) {
  return (
    <Card>
      <div className={styles.message}>
        <Text as="p" variant="subtitle" role="alert">
          {ERROR_TEXT[error]}
        </Text>
        {error === 'unauthorized' ? (
          <Button variant="primary" href="/passcode?next=/progress">
            Enter your passcode
          </Button>
        ) : (
          <Button variant="primary" onClick={retry}>
            Try again
          </Button>
        )}
      </div>
    </Card>
  )
}

const noSubscription = () => () => undefined
const heading = () => readinessHeading(new Date())
const noHeading = () => EMPTY_LINE

export function ProgressView() {
  const [state, retry] = useCached(progressData)
  const standIn = useLocalCopy(progressCopy)
  const readiness = useSyncExternalStore(noSubscription, heading, noHeading)
  const profile = state.status === 'ready' ? state.data : null
  const shown = profile ?? (state.status === 'loading' ? standIn : null)
  const [key] = useCached(reminderKeyData)

  const reminderKey = shown && key.status === 'ready' ? key.data : null
  return (
    <>
      <header className={styles.header}>
        <Text as="h1" variant="headline-l">
          Progress
        </Text>
      </header>
      <p role="status" className={styles.srOnly}>
        {state.status === 'loading' ? 'Loading your progress' : ''}
      </p>
      {state.status === 'error' ? (
        <ErrorCard error={state.error} retry={retry} />
      ) : (
        <ProfileCard profile={profile} standIn={standIn} />
      )}
      {shown ? <Studied heading={readiness} profile={shown} loading={profile === null} /> : null}
      {reminderKey ? <RemindersCard publicKey={reminderKey} /> : null}
    </>
  )
}
