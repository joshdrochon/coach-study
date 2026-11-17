'use client'

import { useEffect, useState } from 'react'

import { setSoundsOn, soundsOn } from '@/lib/sound/settings'
import { appVoice, preloadSounds } from '@/lib/speech/browser'

import { Button } from '../Button'
import { Screen } from '../Screen'
import { LandingGuard } from '../tap-guard'
import { Text } from '../Text'

import { timer } from './copy'
import styles from './screens.module.css'
import { toggleSounds } from './sounds-link'
import { TextLink } from './TextLink'

type Props = {
  endsAt: number | null
  onBack: () => void
  onDone: () => void
}

export function BreakScreen({ endsAt, onBack, onDone }: Props) {
  return (
    <Screen layout="moment">
      <div className={styles.stack40}>
        <Text as="h1" variant="headline-xl">
          {endsAt === null ? 'Paused.' : 'Take five.'}
        </Text>
        <Text as="p" variant="subtitle" tone="text-2">
          {endsAt === null
            ? 'Your answers are saved.'
            : '15 minutes in. Stand up, grab some water.'}
        </Text>
        {endsAt === null ? null : <BreakTimer endsAt={endsAt} />}
        <div className={styles.actions}>
          <Button variant="primary" onClick={onBack} fullWidth>
            Back to it
          </Button>
          <Button variant="secondary" onClick={onDone} fullWidth>
            Done for today
          </Button>
          <SoundsLink />
        </div>
      </div>
    </Screen>
  )
}

export const BREAK_OVER = 'Break’s over.'

function SoundsLink() {
  const [on, setOn] = useState(() => soundsOn())

  const [guard] = useState(() => new LandingGuard())
  function toggle() {
    const next = toggleSounds(on, {
      save: setSoundsOn,
      preload: preloadSounds,
      voice: appVoice(),
      guard,
    })
    setOn(next)
  }
  return (
    <div className={styles.linkRow}>
      <TextLink onClick={toggle}>{on ? 'Turn off sounds' : 'Turn on sounds'}</TextLink>
    </div>
  )
}

function BreakTimer({ endsAt }: { endsAt: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => {
      window.clearInterval(id)
    }
  }, [])
  const left = timer(endsAt - now)

  if (endsAt - now <= 0) {
    return (
      <div className={styles.timer} role="status">
        <Text as="p" variant="question-xl" tone="accent-text">
          {BREAK_OVER}
        </Text>
      </div>
    )
  }
  return (
    <div className={styles.timer} role="timer" aria-label={`${left} left`}>
      <Text variant="question-xl" tone="accent-text" aria-hidden="true">
        {left}
      </Text>
      <Text variant="caption" tone="text-muted" aria-hidden="true">
        left
      </Text>
    </div>
  )
}
