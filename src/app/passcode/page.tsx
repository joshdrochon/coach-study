import type { Metadata } from 'next'

import { PasscodeForm } from '@/components/PasscodeForm'
import { Screen } from '@/components/Screen'
import { Text } from '@/components/Text'
import { safeNext } from '@/lib/auth/passcode'

import styles from './page.module.css'

export const metadata: Metadata = { title: 'Enter your passcode' }

export default async function PasscodePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>
}) {
  const { next } = await searchParams
  return (
    <Screen layout="sheet">
      <div className={styles.step}>
        <Text as="p" variant="label" tone="text-muted">
          Step 2 of 3
        </Text>
        <Text as="h1" variant="headline-l">
          Enter your passcode.
        </Text>
        <PasscodeForm
          kind="app"
          label="Passcode"
          numeric
          next={safeNext(typeof next === 'string' ? next : undefined)}
        />
      </div>
    </Screen>
  )
}
