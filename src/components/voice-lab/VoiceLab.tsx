'use client'

import { useEffect, useReducer, useState, useSyncExternalStore } from 'react'

import {
  attemptSummary,
  diagnosticRows,
  initialLab,
  labReducer,
  VOICE_MODE_LABEL,
  voicePlayLine,
  type HoldMode,
  type Support,
  type VoiceMode,
} from '@/lib/speech/voice-lab'

import { Button } from '../Button'
import { Card } from '../Card'
import { Text } from '../Text'
import { AnswerMic } from '../study/AnswerMic'
import { Picker, PickerOption } from '../study/PickerOption'
import { TranscriptBox } from '../study/TranscriptBox'

import { detectSupport, VoiceLabRig } from './voice-lab-rig'
import styles from './VoiceLab.module.css'

let detected: Support | undefined
const noSubscription = () => () => undefined
const clientSupport = (): Support => (detected ??= detectSupport())
const serverSupport = (): null => null

const HOLD_MODES: { mode: HoldMode; label: string }[] = [
  { mode: 'recognize-and-record', label: 'Recognize and record' },
  { mode: 'recognize-only', label: 'Recognize only' },
]

const VOICE_MODES: VoiceMode[] = ['as-today', 'with-fix', 'reference']

const E8_STEPS = [
  'Choose Recognize and record. Press and hold Hold to talk (or hold Space) and say a sentence.',
  'Let go. Check that words appear under You’re saying, then tap Play. Note whether it played and how loud.',
  'Repeat 3 times without reloading this page.',
]

const E11_STEPS = [
  'Choose Recognize only (the app’s own hold). Hold, say a sentence, let go, then tap Play as today.',
  'Hold again, say a sentence, let go, then tap Play with fix. Compare how loud they were.',
  'For the full-volume reference, reload this page and tap Play without using the mic first before any hold.',
]

export function VoiceLab() {
  const [state, dispatch] = useReducer(labReducer, initialLab)
  const support = useSyncExternalStore(noSubscription, clientSupport, serverSupport)
  const [rig] = useState(() => new VoiceLabRig(dispatch))

  useEffect(() => {
    rig.open()

    const holdsSpace = (event: KeyboardEvent) =>
      event.key === ' ' && !event.metaKey && !event.ctrlKey && !event.altKey
    const onKeyDown = (event: KeyboardEvent) => {
      if (!holdsSpace(event)) return
      event.preventDefault()
      if (!event.repeat) {
        rig.unlockVoice()
        rig.holdStart()
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (!holdsSpace(event)) return
      event.preventDefault()
      rig.holdEnd()
    }

    const letGo = () => {
      rig.holdEnd()
    }
    const onHidden = () => {
      if (document.visibilityState === 'hidden') letGo()
    }

    const unlock = () => {
      rig.unlockVoice()
    }
    document.addEventListener('pointerdown', unlock, { capture: true })
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', letGo)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      document.removeEventListener('pointerdown', unlock, { capture: true })
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', letGo)
      document.removeEventListener('visibilitychange', onHidden)
      rig.dispose()
    }
  }, [rig])

  const latest = state.attempts.at(-1)
  const rows = diagnosticRows(state, support)
  const canPlay = state.recordingOf !== null

  return (
    <div className={styles.stack}>
      <Card label="How to test">
        <Text as="h2" variant="body-l-strong">
          How to test
        </Text>
        <Text as="p" variant="body-strong">
          Can it record while it listens?
        </Text>
        <ol className={styles.steps}>
          {E8_STEPS.map((step) => (
            <li key={step}>
              <Text variant="body-l">{step}</Text>
            </li>
          ))}
        </ol>
        <Text as="p" variant="body-strong">
          Is the app’s voice quieter after the mic?
        </Text>
        <ol className={styles.steps}>
          {E11_STEPS.map((step) => (
            <li key={step}>
              <Text variant="body-l">{step}</Text>
            </li>
          ))}
        </ol>
        <Text as="p" variant="body" tone="text-2">
          Open it from the Home Screen app. The first hold may ask for the microphone: allow it,
          then hold again. The clip stays in this tab’s memory only: never sent, never saved.
        </Text>
      </Card>
      <Picker label="What a hold does">
        {HOLD_MODES.map(({ mode, label }) => (
          <PickerOption
            key={mode}
            selected={state.holdMode === mode}
            onClick={() => {
              rig.setHoldMode(mode)
            }}
          >
            {label}
          </PickerOption>
        ))}
      </Picker>
      <TranscriptBox
        label="You’re saying"
        text={latest?.transcript ?? ''}
        mic={
          <AnswerMic
            recording={state.holding}
            onHoldStart={() => {
              rig.holdStart()
            }}
            onHoldEnd={() => {
              rig.holdEnd()
            }}
          />
        }
      />
      <div className={styles.actions}>
        {canPlay ? (
          <>
            <Button
              variant="primary"
              onClick={() => {
                rig.play()
              }}
            >
              Play
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                rig.clear()
              }}
            >
              Clear
            </Button>
          </>
        ) : null}
      </div>
      <Card label="The app’s voice after the mic">
        <Text as="h2" variant="body-l-strong">
          The app’s voice after the mic
        </Text>
        <Text as="p" variant="body" tone="text-2">
          Each button plays the same short line through the app’s own voice player. Only Play with
          fix sets the audio session to playback first.
        </Text>
        <div className={styles.actions}>
          {VOICE_MODES.map((mode) => (
            <Button
              key={mode}
              variant="secondary"
              onClick={() => {
                void rig.playVoice(mode)
              }}
            >
              {VOICE_MODE_LABEL[mode]}
            </Button>
          ))}
        </div>
        {state.voicePlays.length === 0 ? (
          <Text as="p" variant="body" tone="text-muted">
            No plays yet.
          </Text>
        ) : (
          <ul className={styles.attempts}>
            {state.voicePlays.map((play) => (
              <li key={play.id}>
                <Text variant="body-strong">Play {play.id}</Text>{' '}
                <Text variant="body" tone="text-2">
                  {voicePlayLine(play)}
                </Text>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card label="Diagnostics">
        <Text as="h2" variant="body-l-strong">
          Diagnostics
        </Text>
        <dl className={styles.rows}>
          {rows.map((row) => (
            <div key={row.label} className={styles.pair}>
              <Text as="dt" variant="body" tone="text-muted">
                {row.label}
              </Text>
              <Text as="dd" variant="body">
                {row.value}
              </Text>
            </div>
          ))}
        </dl>
      </Card>
      <Card label="Attempts">
        <Text as="h2" variant="body-l-strong">
          Attempts
        </Text>
        {state.attempts.length === 0 ? (
          <Text as="p" variant="body" tone="text-muted">
            No attempts yet.
          </Text>
        ) : (
          <ul className={styles.attempts}>
            {state.attempts.map((attempt) => (
              <li key={attempt.n}>
                <Text variant="body-strong">Attempt {attempt.n}</Text>{' '}
                <Text variant="body" tone="text-2">
                  {attemptSummary(attempt)}
                </Text>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
