'use client'

import { useState, type SyntheticEvent } from 'react'

import { afterPasscode } from '@/lib/progress/client'

import { Button } from './Button'
import styles from './PasscodeForm.module.css'
import { TextField } from './TextField'

type Props = {
  kind: 'app' | 'admin'
  next: string
  label: string
  numeric: boolean
}

type ErrorBody =
  | { error: 'invalid' }
  | { error: 'wrong'; triesLeft: number }
  | { error: 'locked'; retryAfterSeconds: number }

function isErrorBody(value: unknown): value is ErrorBody {
  return typeof value === 'object' && value !== null && 'error' in value
}

function message(body: ErrorBody | null): string {
  if (body?.error === 'locked') {
    const minutes = Math.max(1, Math.ceil(body.retryAfterSeconds / 60))
    return `Too many tries. Wait ${String(minutes)} ${minutes === 1 ? 'minute' : 'minutes'}, then try again.`
  }
  return 'That passcode didn’t work. Try again.'
}

type FormError = {
  text: string

  clearOnFocus: boolean
}

export function PasscodeForm({ kind, next, label, numeric }: Props) {
  const [passcode, setPasscode] = useState('')
  const [error, setError] = useState<FormError | undefined>()
  const [busy, setBusy] = useState(false)

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return

    if (error?.clearOnFocus) return
    if (passcode.trim() === '') {
      setError({
        text: numeric ? 'Enter your 4-digit passcode.' : 'Enter the admin passcode.',
        clearOnFocus: false,
      })
      return
    }
    setBusy(true)
    try {
      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, passcode }),
      })
      if (response.status === 204) {
        window.location.assign(kind === 'app' ? await afterPasscode(next) : next)
        return
      }
      const body: unknown = await response.json().catch(() => null)
      setError({ text: message(isErrorBody(body) ? body : null), clearOnFocus: true })
    } catch {
      setError({ text: 'No connection. Check your Wi-Fi, then try again.', clearOnFocus: false })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
      <TextField
        id="passcode"
        label={label}
        type="password"
        inputMode={numeric ? 'numeric' : 'text'}
        pattern={numeric ? '[0-9]{4}' : undefined}
        maxLength={numeric ? 4 : 200}
        autoComplete="current-password"
        autoFocus
        required
        value={passcode}
        onFocus={() => {
          if (error?.clearOnFocus) setPasscode('')
        }}
        onChange={(event) => {
          setPasscode(event.target.value)
          setError(undefined)
        }}
        error={error?.text}
      />
      <Button variant="primary" type="submit">
        Unlock
      </Button>
    </form>
  )
}
