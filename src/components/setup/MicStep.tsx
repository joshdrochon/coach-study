'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/Button'
import { Screen } from '@/components/Screen'
import { Text } from '@/components/Text'
import {
  afterFirstRun,
  fetchWelcomed,
  WELCOMED_WAIT_MS,
  welcomedWithin,
} from '@/lib/progress/client'

import styles from './MicStep.module.css'
import { SetupStep } from './SetupStep'

async function allowMicrophone(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    for (const track of stream.getTracks()) track.stop()
    return true
  } catch {
    return false
  }
}

function MicOffIcon() {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
      <path d="M3 3l18 18" />
    </svg>
  )
}

export function MicStep() {
  const router = useRouter()
  const [blocked, setBlocked] = useState(false)
  const [asking, setAsking] = useState(false)
  const welcomed = useRef<Promise<boolean> | null>(null)
  const [next, setNext] = useState(afterFirstRun(false))

  useEffect(() => {
    let live = true
    const asked = fetchWelcomed()
    welcomed.current = asked
    void asked.then((seen) => {
      if (live) setNext(afterFirstRun(seen))
    })
    return () => {
      live = false
    }
  }, [])

  async function ask() {
    if (asking) return
    setAsking(true)
    if (await allowMicrophone()) {
      router.push(afterFirstRun(await welcomedWithin(welcomed.current, WELCOMED_WAIT_MS)))
      return
    }
    setBlocked(true)
    setAsking(false)
  }

  if (blocked) {
    return (
      <Screen layout="moment">
        <div className={styles.disc}>
          <MicOffIcon />
        </div>
        <Text as="h1" variant="headline-xl">
          The app can’t hear you.
        </Text>
        <Text as="p" variant="subtitle" tone="text-2">
          Turn the microphone on for Coach Study in your iPad’s Settings, then come back. You can
          keep going by typing.
        </Text>
        <div className={styles.actions}>
          <Button variant="primary" onClick={() => void ask()} fullWidth>
            Try again
          </Button>
          <Button variant="secondary" href={next} fullWidth>
            Type instead
          </Button>
        </div>
      </Screen>
    )
  }

  return (
    <SetupStep step={3} title="Let the app hear you.">
      <Text as="p" variant="subtitle" tone="text-2">
        You’ll hold the mic to answer, and tap to record your coaching. Tap below, then tap Allow.
      </Text>
      <Button variant="primary" onClick={() => void ask()}>
        Allow microphone
      </Button>
    </SetupStep>
  )
}
