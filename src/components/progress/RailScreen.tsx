import Link from 'next/link'
import type { ReactNode } from 'react'

import { Text } from '@/components/Text'

import styles from './RailScreen.module.css'

type Place = 'home' | 'practice' | 'progress'

function RailIcon({ place }: { place: Place }) {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {place === 'home' ? (
        <>
          <path d="M3 11l9-7 9 7" />
          <path d="M5 10v10h14V10" />
        </>
      ) : place === 'practice' ? (
        <>
          <rect x="8" y="2" width="12" height="15" rx="2" />
          <path d="M5 6v13a2 2 0 0 0 2 2h9" />
          <path d="M2 10v10" />
        </>
      ) : (
        <>
          <path d="M4 20V10" />
          <path d="M10 20V4" />
          <path d="M16 20v-7" />
          <path d="M22 20H2" />
        </>
      )}
    </svg>
  )
}

const PLACES: { place: Place; href: string; label: string }[] = [
  { place: 'home', href: '/', label: 'Home' },

  { place: 'practice', href: '/choose', label: 'Practice' },

  { place: 'progress', href: '/progress', label: 'Progress' },
]

export function RailScreen({
  current,
  fill = false,
  layout = 'workspace',
  children,
}: {
  current: Place
  fill?: boolean

  layout?: 'workspace' | 'sheet'
  children: ReactNode
}) {
  return (
    <div
      data-layout={layout}
      className={[styles.frame, fill ? styles.fill : undefined].filter(Boolean).join(' ')}
    >
      <nav aria-label="Main" className={styles.rail}>
        {PLACES.map(({ place, href, label }) => (
          <Link
            key={place}
            href={href}
            aria-current={place === current ? 'page' : undefined}
            className={`${styles.tile ?? ''} ${place === current ? (styles.current ?? '') : ''}`}
          >
            <RailIcon place={place} />
            <Text variant="caption-strong">{label}</Text>
          </Link>
        ))}
      </nav>
      {layout === 'sheet' ? (
        <div className={`${styles.main ?? ''} ${styles.sheet ?? ''}`}>{children}</div>
      ) : (
        <main className={styles.main}>{children}</main>
      )}
    </div>
  )
}
