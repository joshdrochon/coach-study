'use client'

import { useLayoutEffect, useRef, useState } from 'react'

import { Text } from '../Text'

import { Bracketed } from './Bracketed'
import { questionStyleFor } from './copy'
import styles from './screens.module.css'

export function Question({ prompt }: { prompt: string }) {
  const probe = useRef<HTMLDivElement>(null)
  const [variant, setVariant] = useState<'question-xl' | 'headline-l'>('question-xl')

  useLayoutEffect(() => {
    const box = probe.current
    if (!box) return
    const fit = () => {
      const copy = box.firstElementChild
      if (!(copy instanceof HTMLElement)) return
      setVariant(
        questionStyleFor(
          copy.getBoundingClientRect().height,
          parseFloat(getComputedStyle(copy).lineHeight),
        ),
      )
    }
    fit()

    const observer = new ResizeObserver(fit)
    observer.observe(box)
    if (box.firstElementChild) observer.observe(box.firstElementChild)
    return () => {
      observer.disconnect()
    }
  }, [prompt])

  return (
    <div className={styles.questionBox}>
      <div ref={probe} className={styles.measure} aria-hidden="true">
        <Text as="p" variant="question-xl" className={styles.question}>
          <Bracketed text={prompt} />
        </Text>
      </div>
      <Text as="h1" variant={variant} className={styles.question}>
        <Bracketed text={prompt} />
      </Text>
    </div>
  )
}
