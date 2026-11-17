import type { Metadata } from 'next'

import { PasscodeForm } from '@/components/PasscodeForm'
import { Screen } from '@/components/Screen'
import { Text } from '@/components/Text'
import { safeNext } from '@/lib/auth/passcode'

export const metadata: Metadata = { title: 'Admin passcode' }

export default async function AdminPasscodePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>
}) {
  const { next } = await searchParams
  return (
    <Screen layout="sheet">
      <Text as="p" variant="label" tone="text-muted">
        Admin
      </Text>
      <Text as="h1" variant="headline-l">
        Enter the admin passcode.
      </Text>
      <PasscodeForm
        kind="admin"
        label="Admin passcode"
        numeric={false}
        next={safeNext(typeof next === 'string' ? next : undefined, '/admin/system')}
      />
    </Screen>
  )
}
