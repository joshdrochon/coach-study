import { Button } from '../Button'
import { Screen } from '../Screen'
import { Text } from '../Text'

import styles from './screens.module.css'

export function LoadErrorScreen({
  onRetry,
  passcodeHref,
}: {
  onRetry: () => void
  passcodeHref: string | null
}) {
  if (passcodeHref !== null) {
    return (
      <Screen layout="moment">
        <Text as="h1" variant="headline-xl">
          Can’t load the next card.
        </Text>
        <Text as="p" variant="subtitle" tone="text-2">
          Your passcode is needed again. Your answers are saved.
        </Text>
        <div className={styles.actions}>
          <Button variant="primary" href={passcodeHref} fullWidth>
            Enter your passcode
          </Button>
        </div>
      </Screen>
    )
  }
  return (
    <Screen layout="moment">
      <Text as="h1" variant="headline-xl">
        Can’t load the next card.
      </Text>
      <Text as="p" variant="subtitle" tone="text-2">
        Check your Wi-Fi, then try again. Your answers are saved.
      </Text>
      <div className={styles.actions}>
        <Button variant="primary" onClick={onRetry} fullWidth>
          Try again
        </Button>
        <Button variant="secondary" href="/" fullWidth>
          Back to Home
        </Button>
      </div>
    </Screen>
  )
}
