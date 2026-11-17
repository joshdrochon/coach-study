import styles from './Bar.module.css'

export function Bar({ value }: { value: number | null }) {
  if (value === null) {
    return <span className={styles.track} data-component="bar" aria-hidden="true" />
  }
  const percent = Math.min(100, Math.max(0, Math.floor(value * 100 + 1e-9)))
  return (
    <span className={styles.track} data-component="bar" aria-hidden="true">
      <span className={`${styles.fill ?? ''} ${styles[`p${String(percent)}`] ?? ''}`} />
    </span>
  )
}
