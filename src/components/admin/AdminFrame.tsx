import Link from 'next/link'
import type { ReactNode } from 'react'

import { Text } from '@/components/Text'

import styles from './AdminFrame.module.css'

export type AdminTab = 'system' | 'learning'

const TABS: { tab: AdminTab; href: string; label: string }[] = [
  { tab: 'system', href: '/admin/system', label: 'System' },
  { tab: 'learning', href: '/admin/learning', label: 'Learning' },
]

export function AdminFrame({
  current,
  subPage = false,
  aside,
  today,
  children,
}: {
  current: AdminTab
  subPage?: boolean

  aside?: ReactNode

  today: string
  children: ReactNode
}) {
  return (
    <div data-layout="workspace" className={styles.frame}>
      <header
        className={styles.header}

        data-anchor="admin-header"
      >
        <div className={styles.lead}>
          <Text as="h1" variant="headline-l">
            Admin
          </Text>
          <nav aria-label="Dashboard tabs" className={styles.tabs}>
            {TABS.map(({ tab, href, label }) => (
              <Link
                key={tab}
                href={href}
                aria-current={tab === current ? (subPage ? 'true' : 'page') : undefined}
                className={`${styles.tab ?? ''} ${tab === current ? (styles.current ?? '') : ''}`}
              >
                <Text variant="body-strong">{label}</Text>
              </Link>
            ))}
          </nav>
        </div>
        <div className={styles.end}>
          {aside}
          <Text as="p" variant="body" tone="text-muted">
            {today}
          </Text>
        </div>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  )
}
