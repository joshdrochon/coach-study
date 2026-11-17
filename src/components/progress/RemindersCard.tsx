'use client'

import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { Text, type TextTone } from '@/components/Text'
import { TextLink } from '@/components/study/TextLink'
import {
  checkReminders,
  remindersApi,
  turnOff,
  turnOn,
  type ReminderChange,
  type ReminderError,
  type ReminderState,
} from '@/lib/nudges/client'

import { browserPushEnv } from './browserPush'
import styles from './RemindersCard.module.css'

const WHEN = 'At most two a day, between 8 am and 9 pm, only when you have cards left.'

const STATE_LINE: Record<ReminderState, string> = {
  checking: WHEN,
  off: WHEN,
  on: `Reminders are on. ${WHEN}`,
  tab: 'Reminders work when you open Coach Study from your Home Screen.',
  unsupported: 'This iPad can’t show reminders. Update iPadOS, then open Coach Study again.',
  denied: 'Notifications are off for Coach Study. Turn them on in Settings, then come back.',
}

type Busy = 'on' | 'off' | null
type Line = { text: string; tone: TextTone }

function lineFor(state: ReminderState, busy: Busy, error: ReminderError | null, tried: Busy): Line {
  if (busy === 'on') return { text: 'Turning on reminders…', tone: 'text-2' }
  if (busy === 'off') return { text: 'Turning off reminders…', tone: 'text-2' }
  switch (error) {
    case null:
      return { text: STATE_LINE[state], tone: 'text' }
    case 'not-allowed':
      return { text: 'Reminders stay off until you tap Allow.', tone: 'text' }
    case 'network':
      return { text: 'No connection. Check your Wi-Fi, then try again.', tone: 'warn-text' }
    case 'unauthorized':
      return { text: 'Enter your passcode again to change reminders.', tone: 'warn-text' }
    default:
      return {
        text:
          tried === 'off'
            ? 'Reminders didn’t turn off. Try again in a minute.'
            : 'Reminders didn’t turn on. Try again in a minute.',
        tone: 'warn-text',
      }
  }
}

export function RemindersCard({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<ReminderState>('checking')
  const [busy, setBusy] = useState<Busy>(null)
  const [tried, setTried] = useState<Busy>(null)
  const [error, setError] = useState<ReminderError | null>(null)

  const changing = useRef(false)
  const generation = useRef(0)

  useEffect(() => {
    let live = true
    const check = () => {
      if (changing.current) return
      const mine = (generation.current += 1)
      const current = () => live && generation.current === mine && !changing.current
      checkReminders(browserPushEnv(), publicKey, remindersApi(), current)
        .catch((): ReminderChange => ({ state: 'off', error: 'failed' }))
        .then((result) => {
          if (!result || !current()) return
          setState(result.state)
          setError(result.error)
          setTried(null)
        })
        .catch(() => undefined)
    }
    check()

    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      live = false
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [publicKey])

  function change(to: 'on' | 'off') {
    if (changing.current) return
    changing.current = true
    generation.current += 1
    setBusy(to)
    setTried(to)
    setError(null)
    const env = browserPushEnv()
    const done = to === 'on' ? turnOn(env, publicKey, remindersApi()) : turnOff(env, remindersApi())
    void done.then((result) => {
      changing.current = false
      setState(result.state)
      setError(result.error)
      setBusy(null)
    })
  }

  const line = lineFor(state, busy, error, tried)
  return (
    <Card>
      <div className={styles.reminders}>
        <Text as="h2" variant="label" tone="text-muted">
          Reminders
        </Text>
        <Text as="p" variant="body-l" tone={line.tone} role="status">
          {line.text}
        </Text>
        {state === 'off' ? (
          <Button
            variant="secondary"
            onClick={() => {
              change('on')
            }}
          >
            Turn on reminders
          </Button>
        ) : null}
        {state === 'on' ? (
          <TextLink
            edge="start"
            onClick={() => {
              change('off')
            }}
          >
            Turn off reminders
          </TextLink>
        ) : null}
      </div>
    </Card>
  )
}
