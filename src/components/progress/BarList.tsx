import { Text } from '@/components/Text'

import { Bar } from './Bar'
import styles from './BarList.module.css'
import { Live } from './Live'

export type BarRow = { label: string; value: number; text: string }

export function BarList({
  rows,
  size,
  loading = false,
}: {
  rows: BarRow[]
  size: 'progress' | 'admin'
  loading?: boolean
}) {
  return (
    <ul className={`${styles.rows ?? ''} ${styles[size] ?? ''}`}>
      {rows.map((row, index) => (
        <li key={loading ? String(index) : row.label} className={styles.row}>
          <Text variant={size === 'progress' ? 'body-l' : 'body'} className={styles.label}>
            {loading ? <Live value={null} standIn={row.label} /> : row.label}
          </Text>
          <span className={styles.bar}>
            <Bar value={loading ? null : row.value} />
          </span>
          <Text variant="body" tone="text-muted" className={styles.value}>
            {loading ? <Live value={null} standIn={row.text} /> : row.text}
          </Text>
        </li>
      ))}
    </ul>
  )
}
