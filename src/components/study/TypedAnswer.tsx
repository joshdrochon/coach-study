import type { SyntheticEvent } from 'react'

import { MAX_ANSWER_CHARS } from '@/lib/study/session'

import { TextArea } from '../TextArea'

import styles from './screens.module.css'

export const TYPE_FORM_ID = 'type-answer'

type Props = {
  value: string
  error: string | undefined
  onChange: (text: string) => void
  onSubmit: () => void

  label?: string
  maxLength?: number
}

export function TypedAnswer({
  value,
  error,
  onChange,
  onSubmit,
  label = 'Your answer',
  maxLength = MAX_ANSWER_CHARS,
}: Props) {
  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit()
  }

  return (
    <form id={TYPE_FORM_ID} className={styles.typeForm} onSubmit={submit} noValidate>
      <TextArea
        id="answer"
        label={label}
        autoFocus
        autoComplete="off"
        autoCapitalize="none"
        enterKeyHint="done"
        maxLength={maxLength}
        value={value}
        error={error}
        onChange={(event) => {
          onChange(event.target.value)
        }}

        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
          event.preventDefault()
          event.currentTarget.form?.requestSubmit()
        }}
      />
    </form>
  )
}
