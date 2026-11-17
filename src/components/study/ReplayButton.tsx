import { IconButton } from '../IconButton'

import { SpeakerIcon } from './icons'
import styles from './screens.module.css'

export const REPLAY_LABEL = 'Hear the question again'

export function ReplayButton({ onReplay }: { onReplay: () => void }) {
  return (
    <div data-replay="true" className={styles.replay}>
      <IconButton label={REPLAY_LABEL} labelAs="text" onClick={onReplay}>
        <SpeakerIcon />
      </IconButton>
    </div>
  )
}
