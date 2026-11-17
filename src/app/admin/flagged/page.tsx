import type { Metadata } from 'next'

import { AdminFrame } from '@/components/admin/AdminFrame'
import { FlaggedView } from '@/components/admin/FlaggedView'
import { todayLabel } from '@/lib/dashboard/format'

export const metadata: Metadata = { title: 'Admin · Flagged cards' }
export const dynamic = 'force-dynamic'

export default function AdminFlaggedPage() {
  return (
    <AdminFrame current="system" subPage today={todayLabel(new Date())}>
      <FlaggedView />
    </AdminFrame>
  )
}
