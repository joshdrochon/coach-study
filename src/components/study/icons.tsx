import type { ReactNode } from 'react'

import styles from '../icons.module.css'

type Size = 'm' | 'l' | 'xl'

function Svg({ size, children }: { size: Size; children: ReactNode }) {
  return (
    <svg
      className={styles[size]}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={size === 'm' ? 2.2 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export function ArcIcon({ size = 'xl' }: { size?: Size }) {
  return (
    <Svg size={size}>
      <path d="M21 12a9 9 0 1 1-6.2-8.56" />
    </Svg>
  )
}

export function MicOffIcon({ size = 'xl' }: { size?: Size }) {
  return (
    <Svg size={size}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
      <path d="M3 3l18 18" />
    </Svg>
  )
}

export function SpeakerIcon({ size = 'm' }: { size?: Size }) {
  return (
    <Svg size={size}>
      <path d="M11 5 6 9H3v6h3l5 4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </Svg>
  )
}
