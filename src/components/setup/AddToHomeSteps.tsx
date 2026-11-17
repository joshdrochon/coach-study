import { Text } from '@/components/Text'

import styles from './AddToHomeSteps.module.css'

const STEPS = [
  'Tap Share in Safari, the square with an arrow (or tap ••• first if you don’t see it)',
  'Tap Add to Home Screen, then Add',
  'Open Coach Study from your Home Screen',
] as const

export function AddToHomeSteps() {
  return (
    <ol className={styles.steps}>
      {STEPS.map((step, index) => (
        <li key={step} className={styles.item}>
          <span className={styles.number} aria-hidden="true">
            <Text variant="body-l-strong">{index + 1}</Text>
          </span>
          <Text variant="body-l">{step}</Text>
        </li>
      ))}
    </ol>
  )
}
