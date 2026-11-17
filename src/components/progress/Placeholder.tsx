import { Text } from '@/components/Text'
import type { TypeStyle } from '@/styles/tokens'

import styles from './Placeholder.module.css'

export const EMPTY_LINE = String.fromCharCode(160)

export function Placeholder({
  variant,
  width = 'full',
}: {
  variant: TypeStyle
  width?: 'full' | 'half' | 'third'
}) {
  return (
    <Text
      variant={variant}
      className={`${styles.placeholder ?? ''} ${styles[width] ?? ''}`}
      aria-hidden="true"
    >
      {EMPTY_LINE}
    </Text>
  )
}
