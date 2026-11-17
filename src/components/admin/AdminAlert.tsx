import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { Text } from '@/components/Text'
import type { ApiError } from '@/lib/dashboard/http'

import styles from './panels.module.css'

const MESSAGE: Record<ApiError, string> = {
  unauthorized: 'Your admin session ended. Enter the admin passcode again.',
  network: 'No connection. Check the Wi-Fi, then try again.',
  server: 'The data route failed. Try again in a minute.',
  invalid: 'The data route sent a shape this page can’t read. Check the API contract.',
}

export function AdminAlert({
  error,
  retry,
  next,
}: {
  error: ApiError
  retry: () => void

  next: string
}) {
  return (
    <Card>
      <div className={styles.alert}>
        <Text as="p" variant="body-l" role="alert">
          {MESSAGE[error]}
        </Text>
        {error === 'unauthorized' ? (
          <Button variant="secondary" href={`/admin/passcode?next=${encodeURIComponent(next)}`}>
            Enter the admin passcode
          </Button>
        ) : (
          <Button variant="secondary" onClick={retry}>
            Try again
          </Button>
        )}
      </div>
    </Card>
  )
}
