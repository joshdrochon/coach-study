import type { ReactNode } from 'react'

import { Text, type TextTone } from '@/components/Text'
import type { TypeStyle } from '@/styles/tokens'

import styles from './DataTable.module.css'

export type Column = { header: string; align?: 'end' }
export type Cell = { content: ReactNode; variant?: TypeStyle; tone?: TextTone }
export type Row = { key: string; cells: Cell[] }

export function DataTable({
  label,
  kind,
  columns,
  rows,
  empty,
}: {
  label: string
  kind: 'traces' | 'pieces' | 'tally' | 'audits'
  columns: Column[]
  rows: Row[]

  empty: string
}) {
  const align = (column: Column | undefined) =>
    column?.align === 'end' ? (styles.end ?? '') : undefined
  return (
    <section
      role="table"
      aria-label={label}
      className={`${styles.table ?? ''} ${styles[kind] ?? ''}`}
    >
      <div role="row" className={styles.head}>
        {columns.map((column) => (
          <Text
            key={column.header}
            role="columnheader"
            variant="label"
            tone="text-subtle"
            className={align(column)}
          >
            {column.header}
          </Text>
        ))}
      </div>
      {rows.length === 0 ? (
        <div role="row" className={styles.empty}>
          <Text role="cell" variant="body" tone="text-muted">
            {empty}
          </Text>
        </div>
      ) : (
        rows.map((row) => (
          <div key={row.key} role="row" className={styles.row}>
            {row.cells.map((cell, index) => {
              const column = columns[index]
              return (
                <div key={column?.header ?? index} role="cell" className={align(column)}>
                  <Text variant="caption-strong" tone="text-muted" className={styles.cellLabel}>
                    {column?.header}{' '}
                  </Text>
                  <Text variant={cell.variant ?? 'body'} tone={cell.tone ?? 'inherit'}>
                    {cell.content}
                  </Text>
                </div>
              )
            })}
          </div>
        ))
      )}
    </section>
  )
}
