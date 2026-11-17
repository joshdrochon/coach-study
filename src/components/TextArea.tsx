import type { TextareaHTMLAttributes } from 'react'

import { Text, typeClass } from './Text'
import styles from './TextArea.module.css'

type Props = {
  id: string
  label: string
  error?: string
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id' | 'style' | 'className'>

export function TextArea({ id, label, error, ...textarea }: Props) {
  const errorId = `${id}-error`
  return (
    <div className={styles.field}>
      <Text as="label" htmlFor={id} variant="label" tone="text-muted">
        {label}
      </Text>
      <textarea
        id={id}
        className={[styles.input, typeClass('transcript'), error ? styles.invalid : undefined]
          .filter(Boolean)
          .join(' ')}
        data-component="text-area"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...textarea}
      />
      {error ? (
        <Text as="p" id={errorId} variant="body-strong" tone="warn-text" role="alert">
          {error}
        </Text>
      ) : null}
    </div>
  )
}
