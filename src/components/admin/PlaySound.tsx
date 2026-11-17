'use client'

import { useState } from 'react'

import { Button } from '@/components/Button'
import { Text } from '@/components/Text'

import styles from './PlaySound.module.css'

let current: HTMLAudioElement | null = null

export function PlaySound({
  id,
  src,
  label = `Play ${id}`,
}: {
  id: string
  src: string | null

  label?: string
}) {
  const [failed, setFailed] = useState(false)

  if (src === null) {
    return (
      <Text as="p" variant="body" tone="text-muted">
        Nothing to play yet.
      </Text>
    )
  }

  function play(from: string) {
    current?.pause()
    const audio = new Audio(from)
    current = audio
    setFailed(false)

    audio.addEventListener('error', () => {
      if (current === audio) setFailed(true)
    })
    audio.play().catch((error: unknown) => {
      if (current !== audio) return
      if (error instanceof DOMException && error.name === 'AbortError') return
      setFailed(true)
    })
  }

  return (
    <div className={styles.play}>
      <Button
        variant="secondary"
        onClick={() => {
          play(src)
        }}
      >
        {label}
      </Button>
      {failed ? (
        <Text as="p" variant="body" tone="warn-text" role="alert">
          It didn’t play. Reload the page and try again.
        </Text>
      ) : null}
    </div>
  )
}
