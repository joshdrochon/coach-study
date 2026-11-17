import Link from 'next/link'
import type { ReactNode } from 'react'

import { Text } from '@/components/Text'

import styles from './TextLink.module.css'

export const textLinkClass = styles.link ?? ''

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={textLinkClass} data-component="text-link">
      <Text variant="body-strong">{children}</Text>
    </Link>
  )
}
