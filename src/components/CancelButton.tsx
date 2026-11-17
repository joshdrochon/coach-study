import { Button } from './Button'
import styles from './CancelButton.module.css'

export function CancelButton({
  onCancel,
  href,
  fullWidth = false,
}: {
  onCancel?: () => void
  href?: string
  fullWidth?: boolean
}) {
  return (
    <span data-back="true" className={styles.back}>
      {href !== undefined ? (
        <Button variant="secondary" href={href} fullWidth={fullWidth}>
          Cancel
        </Button>
      ) : (
        <Button variant="secondary" onClick={onCancel} fullWidth={fullWidth}>
          Cancel
        </Button>
      )}
    </span>
  )
}
