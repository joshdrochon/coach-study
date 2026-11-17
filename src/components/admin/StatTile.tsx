import type { ReactNode } from 'react'

import { Card } from '@/components/Card'
import { Text } from '@/components/Text'
import { Bar } from '@/components/progress/Bar'
import { Placeholder } from '@/components/progress/Placeholder'

import styles from './panels.module.css'

export const NO_DATA = 'no data yet'

export function StatTile({
  label,
  value,
  bar,
  caption,
  alert = false,
}: {
  label: string
  value: string | null | undefined
  bar?: number
  caption?: ReactNode

  alert?: boolean
}) {
  return (
    <Card as="div">
      <div className={styles.tile}>
        <Text as="p" variant="caption-strong" tone="text-muted">
          {label}
        </Text>
        {value === undefined ? (
          <Placeholder variant="figure" width="half" />
        ) : (
          <Text
            as="p"
            variant="figure"
            tone={value === null ? 'text-muted' : alert ? 'warn-text' : 'text'}
          >
            {value ?? NO_DATA}
          </Text>
        )}
        {bar !== undefined ? <Bar value={bar} /> : null}
        {value === undefined ? (
          <Placeholder variant="caption" />
        ) : caption ? (
          <Text as="p" variant="caption" tone="text-subtle">
            {caption}
          </Text>
        ) : null}
      </div>
    </Card>
  )
}
