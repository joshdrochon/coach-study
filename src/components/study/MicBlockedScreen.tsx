import { Button } from '../Button'
import { Screen } from '../Screen'
import { Text } from '../Text'

import { Orb } from './Orb'
import styles from './screens.module.css'

export function MicBlockedScreen({ onRetry, onType }: { onRetry: () => void; onType: () => void }) {
  return (
    <Screen layout="moment">
      <Orb state="blocked" />
      <Text as="h1" variant="headline-xl">
        The app can’t hear you.
      </Text>
      <Text as="p" variant="subtitle" tone="text-2">
        Turn the microphone on for Coach Study in your iPad’s Settings, then come back. You can keep
        going by typing.
      </Text>
      <div className={styles.actions}>
        <Button variant="primary" onClick={onRetry} fullWidth>
          Try again
        </Button>
        <Button variant="secondary" onClick={onType} fullWidth>
          Type instead
        </Button>
      </div>
    </Screen>
  )
}
