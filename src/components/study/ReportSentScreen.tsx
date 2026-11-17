import { Button } from '../Button'
import { Text } from '../Text'

import { Orb } from './Orb'
import styles from './screens.module.css'
import { StudyFrame } from './StudyFrame'

export function ReportSentScreen({ onNext }: { onNext: () => void }) {
  return (
    <StudyFrame
      layout="moment"
      footerEnd={
        <Button variant="primary" onClick={onNext}>
          Next
        </Button>
      }
    >
      <div className={styles.headlineGroup}>
        <Text as="h1" variant="headline-xl">
          Thanks. It’s set aside.
        </Text>
        <Text as="p" variant="subtitle" tone="text-2">
          This card is checked against the manual before you see it again.
        </Text>
      </div>
      <Orb state="sent" label="Sent." />
    </StudyFrame>
  )
}
