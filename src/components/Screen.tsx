import type { ReactNode } from 'react'

import styles from './Screen.module.css'

export type Layout = 'moment' | 'sheet' | 'workspace'

type Props = {
  layout: Layout

  wide?: boolean

  threeColumns?: boolean

  headerStart?: ReactNode
  headerEnd?: ReactNode

  footer?: ReactNode
  children: ReactNode
}

export function Screen({
  layout,
  wide = false,
  threeColumns = false,
  headerStart,
  headerEnd,
  footer,
  children,
}: Props) {
  const hasHeader = headerStart !== undefined || headerEnd !== undefined
  return (
    <div data-layout={layout} className={styles.frame}>
      {hasHeader ? (
        <header className={styles.header}>
          <div className={styles.headerStart}>{headerStart}</div>
          <div className={styles.headerEnd}>{headerEnd}</div>
        </header>
      ) : null}
      <main
        className={[
          styles.main,
          styles[layout],
          wide || threeColumns ? styles.wide : undefined,
          threeColumns ? styles.threeColumns : undefined,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {children}
      </main>
      {footer !== undefined ? <footer className={styles.footer}>{footer}</footer> : null}
    </div>
  )
}
