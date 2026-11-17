import { RESULT_ORDER, RESULT_WORDS, type HeadingWord } from '@/lib/grader/words'
import type { GradeResult } from '@/lib/study/client'

import { CancelButton } from '../CancelButton'
import { Screen } from '../Screen'
import { Text } from '../Text'

import { Picker, PickerOption } from './PickerOption'

type Props = {
  word: HeadingWord
  onChoose: (word: GradeResult) => void
  onCancel: () => void
}

export function RatingScreen({ word, onChoose, onCancel }: Props) {
  return (
    <Screen layout="sheet">
      <Text as="h1" variant="headline-l" id="rating-title">
        How did it go?
      </Text>
      <Text as="p" variant="body-l" tone="text-muted">
        This changes when you see the card again.
      </Text>
      <Picker labelledBy="rating-title" three>
        {RESULT_ORDER.map((option) => (
          <PickerOption
            key={option}
            selected={option === word}
            current={option === word}
            onClick={() => {
              onChoose(option)
            }}
          >
            {RESULT_WORDS[option]}
          </PickerOption>
        ))}
      </Picker>
      <CancelButton onCancel={onCancel} fullWidth />
    </Screen>
  )
}
