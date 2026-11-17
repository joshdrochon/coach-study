'use client'

import { useLayoutEffect, useRef, useState } from 'react'

import { Button } from '../Button'
import { Screen } from '../Screen'
import { Text } from '../Text'

import {
  cardCount,
  fittingHeadline,
  HEADLINE_STEPS,
  micPracticeCount,
  studyTime,
  type HeadlineStep,
} from './copy'
import styles from './screens.module.css'

const HEADLINE = 'Done for today.'
const PHRASE = 'nicely paced'

type Props = {
  cards: number

  micPractices: number | null
  studyMs: number

  milestone: string | null
}

export function DoneScreen({ cards, micPractices, studyMs, milestone }: Props) {
  const probe = useRef<HTMLDivElement>(null)
  const [variant, setVariant] = useState<HeadlineStep>('headline-xl')

  useLayoutEffect(() => {
    const box = probe.current
    if (!box) return
    const lines = [...box.children]
    const fit = () => {
      setVariant(
        fittingHeadline(
          lines.map((line) => line.getBoundingClientRect().width),
          box.getBoundingClientRect().width,
        ),
      )
    }
    fit()

    const observer = new ResizeObserver(fit)
    observer.observe(box)
    for (const line of lines) observer.observe(line)
    return () => {
      observer.disconnect()
    }
  }, [])

  const practices =
    micPractices !== null && micPractices > 0 ? micPracticeCount(micPractices) : null
  return (
    <Screen layout="moment">
      <div className={`${styles.stack40} ${styles.fitBox}`}>
        <Text as="h1" variant={variant} className={styles.drawn}>
          <span className={styles.bracketLeft} aria-hidden="true" />
          <span className={styles.drawnText}>
            {HEADLINE} <span className={styles.bracket}>{PHRASE}</span>
          </span>
          <span className={styles.bracketRight} aria-hidden="true" />
        </Text>
        <div ref={probe} className={styles.measure} aria-hidden="true">
          {HEADLINE_STEPS.map((step) => (
            <Text key={step} variant={step} className={`${styles.drawn} ${styles.probeLine}`}>
              <span className={styles.bracketLeft} />
              <span className={styles.drawnText}>
                {HEADLINE} <span className={styles.bracket}>{PHRASE}</span>
              </span>
              <span className={styles.bracketRight} />
            </Text>
          ))}
        </div>
        <Text as="p" variant="subtitle" tone="text-2">
          {[cardCount(cards), practices, studyTime(studyMs)]
            .filter((part) => part !== null)
            .join(' · ')}
        </Text>
        {milestone === null ? null : (
          <Text as="p" variant="body-l" tone="text-muted">
            {milestone}
          </Text>
        )}
        <Button variant="primary" href="/" fullWidth>
          Back to Home
        </Button>
      </div>
    </Screen>
  )
}
