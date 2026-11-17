import type { ReactNode } from 'react'

import { Screen } from '@/components/Screen'
import { Text } from '@/components/Text'

import styles from './SetupStep.module.css'

export function SetupStep({
  step,
  title,
  safariOnly = false,
  children,
}: {
  step: 1 | 2 | 3
  title: string

  safariOnly?: boolean
  children: ReactNode
}) {
  return (
    <Screen layout="sheet">
      <div className={safariOnly ? `${styles.step} ${styles.safariOnly}` : styles.step}>
        <Text as="p" variant="label" tone="text-muted">
          Step {step} of 3
        </Text>
        <Text as="h1" variant="headline-l">
          {title}
        </Text>
        {children}
      </div>
    </Screen>
  )
}
