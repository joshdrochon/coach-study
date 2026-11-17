import { Bracketed } from './Bracketed'
import { Picker, PickerOption } from './PickerOption'
import styles from './screens.module.css'

export function Choices({
  choices,
  onChoose,
}: {
  choices: string[]
  onChoose: (index: number) => void
}) {
  return (
    <div className={styles.choices}>
      <Picker label="Choices" single>
        {choices.map((choice, index) => (
          <PickerOption
            key={choice}
            start
            onClick={() => {
              onChoose(index)
            }}
          >
            <Bracketed text={`${String(index + 1)}. ${choice}`} />
          </PickerOption>
        ))}
      </Picker>
    </div>
  )
}
