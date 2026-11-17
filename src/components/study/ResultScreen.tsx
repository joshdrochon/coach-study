import Image from 'next/image'
import { Fragment } from 'react'

import { heardParts, type Correction } from '@/lib/grader/heard'

import type { CardView } from '@/lib/study/client'
import type { AnswerEntry } from '@/lib/study/entry'
import { HEADING_WORDS, isRevealWord } from '@/lib/grader/words'
import type { Outcome } from '@/lib/study/session'
import { curly } from '@/lib/text/curly'
import { plainPunctuation } from '@/lib/text/punctuation'

import { Button } from '../Button'
import { Card } from '../Card'
import { CheckIcon } from '../icons'
import { Text } from '../Text'

import { Bracketed } from './Bracketed'
import { answerRows, ENTRY_LABELS, seeAgain } from './copy'
import styles from './screens.module.css'
import { ReplayButton } from './ReplayButton'
import { StudyFrame } from './StudyFrame'
import { TextLink } from './TextLink'

export const REDO_LINE = 'Practice round: your first answer is the one saved.'

export function missingLine(outcome: Pick<Outcome, 'missing' | 'gradedBy'>): string {
  const line = outcome.missing.join(', ')
  return outcome.gradedBy === 'tutor' ? plainPunctuation(line) : line
}

export function LearnerAnswer({
  answer,
  entry,
  corrections,
}: {
  answer: string
  entry: AnswerEntry
  corrections: readonly Correction[]
}) {
  const parts = heardParts(answer, entry === 'voice' ? corrections : [])
  return (
    <div className={styles.why}>
      <Text as="h2" variant="label" tone="text-muted">
        {ENTRY_LABELS[entry]}
      </Text>
      <Text as="p" variant="subtitle" tone="text-2" data-learner-words="">
        {parts.map((part, i) =>
          part.heard === undefined ? (
            <Fragment key={i}>{curly(part.text)}</Fragment>
          ) : (
            <Fragment key={i}>
              <span className={styles.readAs}>{curly(part.text)}</span>{' '}
              <Text variant="caption" tone="text-muted">
                {`heard “${curly(part.heard)}”`}
              </Text>
            </Fragment>
          ),
        )}
      </Text>
    </div>
  )
}

type Props = {
  card: CardView
  outcome: Outcome

  answer: string
  entry: AnswerEntry
  progress: { current: number; total: number } | null

  redo: boolean
  onEnd: () => void
  onChange: () => void
  onSource: () => void
  onReport: () => void
  onRedo: () => void
  onNext: () => void

  onReplay: () => void
}

export function ResultScreen({
  card,
  outcome,
  answer,
  entry,
  progress,
  redo,
  onEnd,
  onChange,
  onSource,
  onReport,
  onRedo,
  onNext,
  onReplay,
}: Props) {
  const revealed = isRevealWord(outcome.word)
  const missed = outcome.word === 'wrong'
  const panel = revealed ? 'hero' : missed ? 'warn' : 'accent'
  const dueTone = revealed ? 'text-2' : missed ? 'warn-text-muted' : 'accent-text-strong'
  const due = card.dueInMs?.[outcome.rating - 1]

  const why = outcome.result !== 'right'
  return (
    <StudyFrame
      layout="workspace"
      category={card.category}
      onEnd={onEnd}
      progress={progress}
      headerTools={<ReplayButton onReplay={onReplay} />}
      footerStart={
        redo ? (
          <Text as="p" variant="body-l" tone="text-muted">
            {REDO_LINE}
          </Text>
        ) : undefined
      }
      footerEnd={
        <>
          <TextLink flag onClick={onReport}>
            This looks wrong
          </TextLink>
          <Button variant="secondary" onClick={onRedo}>
            Redo
          </Button>
          <Button variant="primary" onClick={onNext}>
            Next
          </Button>
        </>
      }
    >
      <Card kind={panel} label="Result">
        <div className={styles.bannerRow}>
          <div className={styles.verdict}>
            {missed || revealed ? null : (
              <span className={styles.disc}>
                <CheckIcon size="l" />
              </span>
            )}
            <div className={styles.verdictText}>
              <Text as="h1" variant="headline-m">
                {HEADING_WORDS[outcome.word]}
              </Text>
              {}
              <Text
                as="p"
                variant="body-l"
                tone={dueTone}
                aria-hidden={due === undefined ? true : undefined}
                data-due-line=""
              >
                {due === undefined ? ' ' : seeAgain(due)}
              </Text>
            </div>
          </div>
          {redo ? null : <TextLink onClick={onChange}>Change</TextLink>}
        </div>
      </Card>
      <Card label="Answer">
        <div className={card.photo ? styles.answerGrid : undefined}>
          <div className={styles.answerText}>
            {answer.trim() === '' ? null : (
              <LearnerAnswer answer={answer} entry={entry} corrections={outcome.corrections} />
            )}
            <Text as="h2" variant="label" tone="text-muted">
              Answer
            </Text>
            <div className={styles.rows}>
              {answerRows(card.answer).map((row) => (
                <div key={`${row.label ?? ''}${row.value}`} className={styles.row}>
                  {row.label === null ? null : (
                    <Text variant="body" tone="text-muted">
                      {row.label}
                    </Text>
                  )}
                  <Text variant="title-l">
                    <Bracketed text={row.value} />
                  </Text>
                </div>
              ))}
            </div>
            {why ? (
              <div className={styles.why}>
                <Text as="h2" variant="label" tone="text-muted">
                  Why
                </Text>
                {outcome.result !== 'right' && outcome.missing.length > 0 ? (
                  <Text as="p" variant="body-l-strong" tone="warn-text">
                    Missing: <Bracketed text={missingLine(outcome)} />
                  </Text>
                ) : null}
                <Text as="p" variant="body-l" tone="text-2">
                  <Bracketed text={card.explanation} />
                </Text>
              </div>
            ) : null}
            <TextLink citation edge="start" onClick={onSource}>
              {card.citation.label}
            </TextLink>
          </div>
          {card.photo ? (
            <div className={styles.photo}>
              <Image
                src={card.photo.src}
                alt={card.photo.alt}
                fill
                unoptimized
                sizes="(min-width: 1180px) 50vw, 100vw"
                className={styles.photoImage}
              />
            </div>
          ) : null}
        </div>
      </Card>
    </StudyFrame>
  )
}
