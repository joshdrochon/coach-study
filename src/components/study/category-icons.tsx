import type { ReactNode } from 'react'

import type { Category } from '@/lib/content/schema'

import styles from '../icons.module.css'

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      className={styles.l}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export type ChooseRow = Category | 'Everything' | 'Mic practice' | 'Voice test'

export const CATEGORY_ICONS: Partial<Record<ChooseRow, ReactNode>> = {
  Everything: (
    <Svg>
      <rect x="8" y="2" width="12" height="15" rx="2" />
      <path d="M5 6v13a2 2 0 0 0 2 2h9" />
      <path d="M2 10v10" />
    </Svg>
  ),

  'Mic practice': (
    <Svg>
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <rect x="2.6" y="13" width="3.6" height="6" rx="1.4" />
      <rect x="17.8" y="13" width="3.6" height="6" rx="1.4" />
      <path d="M4.4 19c0 1.8 2.4 2.6 6 2.6" />
      <circle cx="12" cy="21.6" r=".9" />
    </Svg>
  ),

  'Coaching voice': (
    <Svg>
      <path d="M3 10v4M8 6v12M13 9v6M18 4v16" />
    </Svg>
  ),

  'Floor work': (
    <Svg>
      <rect x="3" y="14" width="18" height="6" rx="1" />
      <path d="M3 10h18" />
    </Svg>
  ),

  'Standing work': (
    <Svg>
      <path d="M12 3v18M7 21h10" />
      <circle cx="12" cy="7" r="2" />
    </Svg>
  ),

  'Balance work': (
    <Svg>
      <path d="M12 4 20 18H4z" />
    </Svg>
  ),

  'Stretch work': (
    <Svg>
      <path d="M3 12h18M6 8l-3 4 3 4M18 8l3 4-3 4" />
    </Svg>
  ),

  Gear: (
    <Svg>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  ),

  Glossary: (
    <Svg>
      <path d="M5 6h14M5 12h14M5 18h9" />
    </Svg>
  ),

  Basics: (
    <Svg>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </Svg>
  ),

  'Voice test': (
    <Svg>
      <path d="M3 10v4M7 7v10M11 3v18M15 7v10M19 10v4" />
    </Svg>
  ),
}

export function categoryIcon(row: ChooseRow): ReactNode {
  return CATEGORY_ICONS[row] ?? null
}
