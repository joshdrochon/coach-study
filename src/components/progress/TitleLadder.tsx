import { Text } from '@/components/Text'
import { TITLES, type CoachTitle } from '@/lib/progress/titles'

import styles from './TitleLadder.module.css'

export function TitleLadder({ current }: { current: CoachTitle | null }) {
  return (
    <div className={styles.frame}>
      <ol aria-label="Coach titles" className={styles.ladder} data-component="title-ladder">
        {TITLES.map((title) => {
          const isCurrent = title === current
          return (
            <li key={title} className={styles.rung} aria-current={isCurrent ? 'step' : undefined}>
              <span
                className={`${styles.dot ?? ''} ${isCurrent ? (styles.current ?? '') : ''}`}
                aria-hidden="true"
              />
              <Text variant="body-strong" tone={isCurrent ? 'text' : 'text-muted'}>
                {title}
              </Text>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
