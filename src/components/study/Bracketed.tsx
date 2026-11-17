import { curly } from '@/lib/text/curly'

import { LiftedBrackets } from '../LiftedBrackets'

import styles from './screens.module.css'

export function Bracketed({ text }: { text: string }) {
  const parts = curly(text).split(/(\[[^\]]*\][.,;:!?)”’]*)/)
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <span key={index} className={styles.keepWhole}>
            <LiftedBrackets text={part} />
          </span>
        ) : (
          part
        ),
      )}
    </>
  )
}
