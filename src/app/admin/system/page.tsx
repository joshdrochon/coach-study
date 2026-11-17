import type { Metadata } from 'next'

import { AdminFrame } from '@/components/admin/AdminFrame'
import { SystemView } from '@/components/admin/SystemView'
import { TextLink } from '@/components/progress/TextLink'
import { todayLabel } from '@/lib/dashboard/format'

export const metadata: Metadata = { title: 'Admin · System' }
export const dynamic = 'force-dynamic'

export default function AdminSystemPage() {
  return (
    <AdminFrame
      current="system"
      today={todayLabel(new Date())}
      aside={
        <>
          <TextLink href="/admin/voice-test">Voice test results</TextLink>
          <TextLink href="/admin/sounds">Sounds</TextLink>
          <TextLink href="/admin/flagged">Flagged cards</TextLink>
        </>
      }
    >
      <SystemView />
    </AdminFrame>
  )
}
