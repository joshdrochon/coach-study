import type { InputHTMLAttributes } from 'react'

import { Text, typeClass } from './Text'
import styles from './TextField.module.css'

type Props = {
  id: string
  label: string
  error?: string
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'style' | 'className'>

export function TextField({ id, label, error, ...input }: Props) {
  const errorId = `${id}-error`
  return (
    <div className={styles.field}>
      <Text as="label" htmlFor={id} variant="label" tone="text-muted">
        {label}
      </Text>
      <input
        id={id}
        className={[styles.input, typeClass('transcript'), error ? styles.invalid : undefined]
          .filter(Boolean)
          .join(' ')}
        data-component="text-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...input}
      />
      {}
      {error ? (
        <Text as="p" id={errorId} variant="body-strong" tone="warn-text" role="alert">
          {error}
        </Text>
      ) : null}
    </div>
  )
}
