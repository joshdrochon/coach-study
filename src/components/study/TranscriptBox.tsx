import type { ReactNode } from 'react'

import { curly } from '@/lib/text/curly'

import { Text } from '../Text'

import styles from './TranscriptBox.module.css'

export function TranscriptBox({
  label,
  text,
  mic,
  lines = 1,
}: {
  label: 'You’re saying' | 'You said'
  text: string
  mic?: ReactNode
  lines?: 1 | 2
}) {
  const words = (
    <>
      <Text as="div" variant="label" tone="text-muted">
        {label}
      </Text>
      <div className={styles.viewport} data-transcript-viewport="">
        <Text as="p" variant="transcript">
          {curly(text)}
        </Text>
      </div>
    </>
  )
  return (
    <section
      className={[
        styles.box,
        lines === 2 ? styles.twoLines : '',
        mic === undefined ? '' : styles.withMic,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={label === 'You said' ? 'What you said' : 'What you’re saying'}
      data-transcript={label === 'You said' ? 'final' : 'live'}
      data-lines={lines}
    >
      {mic === undefined ? (
        words
      ) : (
        <>
          <div className={styles.words}>{words}</div>
          {mic}
        </>
      )}
    </section>
  )
}
