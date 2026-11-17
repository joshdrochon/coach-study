import { Fragment } from 'react'

import { CheckIcon, MicIcon } from '../icons'
import { Text } from '../Text'

import { ArcIcon, MicOffIcon } from './icons'
import styles from './Orb.module.css'

export type OrbState = 'waiting' | 'listening' | 'checking' | 'sent' | 'blocked'

const ICONS = {
  waiting: <MicIcon size="xl" />,
  listening: <MicIcon size="xl" />,
  checking: <ArcIcon />,
  sent: <CheckIcon size="xl" />,
  blocked: <MicOffIcon />,
} as const

export function Orb({
  state,
  label,
  compact = false,
}: {
  state: OrbState
  label?: string
  compact?: boolean
}) {
  return (
    <div className={`${styles.orbWithLabel} ${compact ? styles.compact : ''}`}>
      <div className={`${styles.orb} ${styles[state]}`} data-orb={state}>
        <span className={state === 'checking' ? styles.turning : styles.still}>{ICONS[state]}</span>
      </div>
      {label === undefined ? null : (
        <Text
          as="p"
          aria-live="polite"
          variant="title"
          tone={state === 'waiting' ? 'text-muted' : 'accent-text-strong'}
          className={styles.label}
        >
          {}
          <Fragment key={label}>{label}</Fragment>
        </Text>
      )}
    </div>
  )
}
