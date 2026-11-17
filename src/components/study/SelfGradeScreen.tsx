import type { AnswerEntry } from '@/lib/study/entry'
import { RESULT_ORDER, RESULT_WORDS } from '@/lib/grader/words'
import type { CardView, GradeResult } from '@/lib/study/client'
import { curly } from '@/lib/text/curly'

import { Card } from '../Card'
import { CitationText } from '../CitationText'
import { Text } from '../Text'

import { Bracketed } from './Bracketed'
import { ENTRY_LABELS, quoted, sameWords } from './copy'
import { Picker, PickerOption } from './PickerOption'
import styles from './screens.module.css'
import { ReplayButton } from './ReplayButton'
import { StudyFrame } from './StudyFrame'

type Props = {
  card: CardView
  progress: { current: number; total: number } | null
  answer: string

  entry: AnswerEntry
  onEnd: () => void

  onRate: (word: GradeResult) => void

  onReplay: () => void
}

export function SelfGradeScreen({ card, progress, answer, entry, onEnd, onRate, onReplay }: Props) {
  const source = card.exercise ? `${card.citation.label} · ${card.exercise}` : card.citation.label

  const answerToo = !sameWords(card.citation.quote, card.answer)
  return (
    <StudyFrame
      layout="workspace"
      category={card.category}
      onEnd={onEnd}
      progress={progress}
      headerTools={<ReplayButton onReplay={onReplay} />}
    >
      <Card kind="warn" label="Grader unavailable">
        <div className={styles.stack8}>
          <Text as="h1" variant="headline-m">
            Check it yourself
          </Text>
          <Text as="p" variant="body-l" tone="warn-text-muted">
            The grader can’t be reached. Compare with the manual and pick how it went. Your answers
            are saved.
          </Text>
        </div>
      </Card>
      <div className={styles.twoColumns}>
        <Card>
          <Text as="h2" variant="label" tone="text-muted">
            {ENTRY_LABELS[entry]}
          </Text>
          <Text as="p" variant="subtitle" tone="text-2" className={styles.quote}>
            {answer === '' ? 'Nothing heard.' : quoted(curly(answer))}
          </Text>
          {answerToo ? (
            <>
              <Text as="h2" variant="label" tone="text-muted">
                Answer
              </Text>
              <Text as="p" variant="subtitle">
                <Bracketed text={card.answer} />
              </Text>
            </>
          ) : null}
          <Text as="h2" variant="label" tone="text-muted">
            {source}
          </Text>
          <Text as="p" variant="subtitle" className={styles.quote}>
            <CitationText text={card.citation.quote} />
          </Text>
        </Card>
        <Card>
          <Text as="h2" variant="label" tone="text-muted" id="self-grade-title">
            How did it go?
          </Text>
          <Picker labelledBy="self-grade-title" three>
            {RESULT_ORDER.map((word) => (
              <PickerOption
                key={word}
                onClick={() => {
                  onRate(word)
                }}
              >
                {RESULT_WORDS[word]}
              </PickerOption>
            ))}
          </Picker>
        </Card>
      </div>
    </StudyFrame>
  )
}
