import { LastWordsTogether } from '../Text'

import styles from './Live.module.css'

export function Live({
  value,
  standIn,
  headline = false,
}: {
  value: string | null
  standIn: string
  headline?: boolean
}) {
  const words = (text: string) => (headline ? <LastWordsTogether text={text} /> : text)
  if (value === null) {
    return (
      <span className={styles.skeleton} data-skeleton="true" aria-hidden="true">
        <span className={styles.hidden}>{words(standIn)}</span>
      </span>
    )
  }

  if (headline) {
    return (
      <span>
        <span>{words(value)}</span>
      </span>
    )
  }
  return <span>{value}</span>
}
