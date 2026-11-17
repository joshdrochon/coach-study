import type { ReactNode } from 'react'

import styles from './Card.module.css'

type Props = {
  children: ReactNode

  kind?: 'card' | 'hero' | 'accent' | 'warn'
  as?: 'section' | 'div' | 'article'
  label?: string
}

export function Card({ children, kind = 'card', as: Component = 'section', label }: Props) {
  return (
    <Component
      className={`${styles.card} ${styles[kind] ?? ''}`}
      data-component={kind === 'card' ? 'card' : 'hero-panel'}
      aria-label={label}
    >
      {children}
    </Component>
  )
}
