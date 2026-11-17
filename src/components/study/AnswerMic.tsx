'use client'

import { useEffect, useRef, type PointerEvent } from 'react'

import buttons from '../Button.module.css'
import { MicIcon } from '../icons'
import { Text } from '../Text'

import styles from './AnswerMic.module.css'

type Props = {
  recording: boolean
  onHoldStart: () => void
  onHoldEnd: () => void
}

export function AnswerMic({ recording, onHoldStart, onHoldEnd }: Props) {
  const held = useRef<number | null>(null)
  const end = useRef(onHoldEnd)
  useEffect(() => {
    end.current = onHoldEnd
  }, [onHoldEnd])
  useEffect(
    () => () => {
      if (held.current !== null) end.current()
    },
    [],
  )

  const press = (event: PointerEvent<HTMLButtonElement>) => {
    if (held.current !== null || (event.pointerType === 'mouse' && event.button !== 0)) return

    event.preventDefault()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {}
    held.current = event.pointerId
    onHoldStart()
  }
  const release = (event: PointerEvent<HTMLButtonElement>) => {
    if (held.current !== event.pointerId) return
    held.current = null
    onHoldEnd()
  }

  return (
    <button
      type="button"
      className={`${buttons.button} ${buttons.secondary} ${styles.mic}`}
      data-component="secondary-button"
      data-answer-mic={recording ? 'recording' : 'idle'}
      onPointerDown={press}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(event) => {
        event.preventDefault()
      }}
    >
      <MicIcon size="s" />
      <Text variant="button">Hold to talk</Text>
    </button>
  )
}
