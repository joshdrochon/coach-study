import type { Metadata } from 'next'

import { AdminFrame } from '@/components/admin/AdminFrame'
import { LearningView } from '@/components/admin/LearningView'
import { todayLabel } from '@/lib/dashboard/format'
import { recallHeading } from '@/lib/progress/milestones'

export const metadata: Metadata = { title: 'Admin · Learning' }
export const dynamic = 'force-dynamic'

export default function AdminLearningPage() {
  const now = new Date()
  return (
    <AdminFrame current="learning" today={todayLabel(now)}>
      <LearningView recallHeading={recallHeading(now)} />
    </AdminFrame>
  )
}
