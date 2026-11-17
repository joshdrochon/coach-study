import type { ReactNode } from 'react'

import { IconButton } from '../IconButton'
import { CloseIcon } from '../icons'
import { Text } from '../Text'

import styles from './StudyFrame.module.css'

type Props = {
  layout: 'moment' | 'workspace'

  dense?: boolean
  category?: string
  onEnd?: () => void
  progress?: { current: number; total: number } | null
  footerStart?: ReactNode
  footerEnd?: ReactNode

  headerTools?: ReactNode

  busy?: boolean
  children: ReactNode
}

export function StudyFrame({
  layout,
  dense = false,
  category,
  onEnd,
  progress,
  footerStart,
  footerEnd,
  headerTools,
  busy = false,
  children,
}: Props) {
  const label = progress ? `Card ${String(progress.current)} of ${String(progress.total)}` : ''
  return (
    <div data-layout={layout} className={styles.frame}>
      <header
        className={styles.header}

        data-anchor="study-header"
        aria-hidden={category === undefined && !onEnd ? true : undefined}
      >
        <div className={styles.headerStart}>
          {category === undefined ? null : (
            <Text variant="body-l" tone="text-muted">
              {category}
            </Text>
          )}
        </div>
        {onEnd ? (
          <nav aria-label="Session" className={styles.headerEnd}>
            {headerTools}
            <IconButton label="End session" labelAs="text" onClick={onEnd}>
              <CloseIcon />
            </IconButton>
          </nav>
        ) : null}
      </header>
      <div className={styles.barRow}>
        {progress ? (
          <progress
            className={styles.bar}
            value={progress.current}
            max={progress.total}
            aria-label={label}
            data-component="bar"
          />
        ) : null}
      </div>
      <main
        className={`${styles.main} ${styles[layout]} ${dense ? styles.dense : ''}`}
        aria-busy={busy || undefined}
      >
        {children}
      </main>
      {footerStart !== undefined || footerEnd !== undefined ? (
        <footer className={styles.footer}>
          <div className={styles.footerStart}>{footerStart}</div>
          <div className={styles.footerEnd}>{footerEnd}</div>
        </footer>
      ) : null}
    </div>
  )
}
