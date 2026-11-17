'use client'

import { Fragment, useState } from 'react'

import type { CardView } from '@/lib/study/client'

import { Button } from '../Button'
import { Text } from '../Text'

import { AnswerMic } from './AnswerMic'
import { Choices } from './Choices'
import { Orb } from './Orb'
import { Question } from './Question'
import { ReplayButton } from './ReplayButton'
import { StudyFrame } from './StudyFrame'
import { TranscriptBox } from './TranscriptBox'
import { TYPE_FORM_ID, TypedAnswer } from './TypedAnswer'

export type CardPhase = 'reading' | 'idle' | 'recording' | 'checking'

type Props = {
  card: CardView
  progress: { current: number; total: number } | null
  phase: CardPhase

  typing: boolean

  heard: string
  answer: string

  micIssue: boolean
  onEnd: () => void
  onTypeInstead: () => void
  onShowAnswer: () => void
  onChoose: (index: number) => void
  onHoldStart: () => void
  onHoldEnd: () => void
  onClear: () => void
  onSubmit: () => void

  draft: string
  onDraft: (text: string) => void
  onCheck: (answer: string) => void
  onVoiceInstead: () => void

  onReplay: () => void
}

export { REPLAY_LABEL } from './ReplayButton'

export function orbLabel(phase: CardPhase, micIssue: boolean, choices = false): string {
  if (phase === 'checking') return 'Checking…'
  if (phase === 'recording') return 'Listening…'
  if (phase === 'reading') return 'Get ready…'
  if (micIssue) return 'The mic stopped. Hold to try again.'
  return choices ? 'Tap a choice, or hold the mic to talk.' : 'Hold Space or the mic to talk.'
}

export const HINT_LINE = 'Stuck? Hold the mic and say “hint.”'

export function CardScreen({
  card,
  progress,
  phase,
  heard,
  answer,
  micIssue,
  onEnd,
  onTypeInstead,
  onShowAnswer,
  onChoose,
  onHoldStart,
  onHoldEnd,
  onClear,
  onSubmit,
  typing,
  draft,
  onDraft,
  onCheck,
  onVoiceInstead,
  onReplay,
}: Props) {
  const [typed, setTyped] = useState(draft)
  const [typeError, setTypeError] = useState<string | undefined>()
  const checking = phase === 'checking'
  const choices = card.choices ?? []
  const said = heard.trim() !== ''

  const typingNow = typing && !checking
  const hasTyped = choices.length === 0 && typed.trim() !== ''

  function submitTyped() {
    if (typed.trim() === '') setTypeError('Type your answer first.')
    else onCheck(typed)
  }

  return (
    <StudyFrame
      layout="moment"
      dense={choices.length > 0}
      category={card.category}
      onEnd={onEnd}
      progress={progress}
      headerTools={<ReplayButton onReplay={onReplay} />}
      footerStart={
        checking || typingNow ? undefined : (
          <Text as="p" variant="body-l" tone="text-muted">
            {HINT_LINE}
          </Text>
        )
      }
      footerEnd={
        checking ? undefined : typingNow ? (
          <Fragment key={hasTyped ? 'typed' : 'typing'}>
            <Button
              variant="secondary"
              onClick={() => {
                setTypeError(undefined)
                onVoiceInstead()
              }}
            >
              Voice instead
            </Button>
            {hasTyped ? (
              <Button variant="primary" type="submit" form={TYPE_FORM_ID}>
                Submit
              </Button>
            ) : (
              <Button variant="secondary" onClick={onShowAnswer}>
                Show answer
              </Button>
            )}
          </Fragment>
        ) : said ? (
          <Fragment key="said">
            {choices.length > 0 ? null : (
              <Button variant="secondary" onClick={onClear}>
                Clear
              </Button>
            )}
            <Button variant="primary" onClick={onSubmit}>
              Submit
            </Button>
          </Fragment>
        ) : (
          <Fragment key="empty">
            {choices.length > 0 ? null : (
              <Button variant="secondary" onClick={onTypeInstead}>
                Type instead
              </Button>
            )}
            <Button variant="secondary" onClick={onShowAnswer}>
              Show answer
            </Button>
          </Fragment>
        )
      }
    >
      <Question prompt={card.prompt} />
      {choices.length > 0 ? <Choices choices={choices} onChoose={onChoose} /> : null}
      {typingNow ? (
        choices.length > 0 ? null : (
          <TypedAnswer
            value={typed}
            error={typeError}
            onChange={(text) => {
              setTyped(text)
              onDraft(text)
              setTypeError(undefined)
            }}
            onSubmit={submitTyped}
          />
        )
      ) : (
        <VoiceAnswer
          phase={phase}
          heard={heard}
          answer={answer}
          micIssue={micIssue}
          choices={choices.length > 0}
          onHoldStart={onHoldStart}
          onHoldEnd={onHoldEnd}
        />
      )}
    </StudyFrame>
  )
}

function VoiceAnswer({
  phase,
  heard,
  answer,
  micIssue,
  choices,
  onHoldStart,
  onHoldEnd,
}: {
  phase: CardPhase
  heard: string
  answer: string
  micIssue: boolean
  choices: boolean
  onHoldStart: () => void
  onHoldEnd: () => void
}) {
  const checking = phase === 'checking'
  return (
    <>
      <Orb
        state={checking ? 'checking' : phase === 'recording' ? 'listening' : 'waiting'}
        label={orbLabel(phase, micIssue, choices)}
        compact
      />
      {checking ? (
        <TranscriptBox label="You said" text={answer} lines={2} />
      ) : (
        <TranscriptBox
          label="You’re saying"
          text={heard}
          lines={2}
          mic={
            <AnswerMic
              recording={phase === 'recording'}
              onHoldStart={onHoldStart}
              onHoldEnd={onHoldEnd}
            />
          }
        />
      )}
    </>
  )
}
