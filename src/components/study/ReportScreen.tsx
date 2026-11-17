import { Fragment, useState } from 'react'

import { Button } from '../Button'
import { CancelButton } from '../CancelButton'
import { Text } from '../Text'

import { AnswerMic } from './AnswerMic'
import { Orb } from './Orb'
import styles from './screens.module.css'
import { StudyFrame } from './StudyFrame'
import { TranscriptBox } from './TranscriptBox'
import { TYPE_FORM_ID, TypedAnswer } from './TypedAnswer'

export const REPORT_SUBTITLE = 'Hold the mic and say it.'
export const REPORT_TYPE_SUBTITLE = 'Type it here.'

export const REPORT_EMPTY = 'Type what looks wrong first.'

type Props = {
  typing: boolean

  typed: string

  recording: boolean

  heard: string

  micIssue: boolean
  onHoldStart: () => void
  onHoldEnd: () => void
  onCancel: () => void
  onClear: () => void
  onSend: () => void
  onType: (text: string) => void
  onTypeInstead: () => void
  onVoiceInstead: () => void
}

export function ReportScreen({
  typing,
  typed,
  recording,
  heard,
  micIssue,
  onHoldStart,
  onHoldEnd,
  onCancel,
  onClear,
  onSend,
  onType,
  onTypeInstead,
  onVoiceInstead,
}: Props) {
  const [error, setError] = useState<string | undefined>()
  const said = heard.trim() !== ''
  const hasTyped = typed.trim() !== ''
  return (
    <StudyFrame
      layout="moment"
      footerEnd={
        typing ? (
          <Fragment key={hasTyped ? 'typed' : 'typing'}>
            <CancelButton onCancel={onCancel} />
            <Button
              variant="secondary"
              onClick={() => {
                setError(undefined)
                onVoiceInstead()
              }}
            >
              Voice instead
            </Button>
            {hasTyped ? (
              <Button variant="primary" type="submit" form={TYPE_FORM_ID}>
                Send
              </Button>
            ) : null}
          </Fragment>
        ) : said ? (
          <Fragment key="said">
            <Button variant="secondary" onClick={onClear}>
              Clear
            </Button>
            <Button variant="primary" onClick={onSend}>
              Send
            </Button>
          </Fragment>
        ) : (
          <Fragment key="empty">
            <Button variant="secondary" onClick={onTypeInstead}>
              Type instead
            </Button>
            <CancelButton onCancel={onCancel} />
          </Fragment>
        )
      }
    >
      <div className={styles.headlineGroup}>
        <Text as="h1" variant="headline-xl">
          What looks wrong?
        </Text>
        <Text as="p" variant="subtitle" tone="text-2">
          {typing ? REPORT_TYPE_SUBTITLE : REPORT_SUBTITLE}
        </Text>
      </div>
      {typing ? (
        <TypedAnswer
          label="Your note"
          value={typed}
          error={error}
          onChange={(text) => {
            setError(undefined)
            onType(text)
          }}
          onSubmit={() => {
            if (!hasTyped) setError(REPORT_EMPTY)
            else onSend()
          }}
        />
      ) : (
        <>
          <Orb
            state={recording ? 'listening' : 'waiting'}
            label={
              recording
                ? 'Listening…'
                : micIssue
                  ? 'The mic stopped. Hold to try again.'
                  : 'Hold Space or the mic to talk.'
            }
          />
          <TranscriptBox
            label="You’re saying"
            text={heard}
            lines={2}
            mic={
              <AnswerMic recording={recording} onHoldStart={onHoldStart} onHoldEnd={onHoldEnd} />
            }
          />
        </>
      )}
    </StudyFrame>
  )
}
