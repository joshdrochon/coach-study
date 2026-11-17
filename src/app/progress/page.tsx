import type { Metadata } from 'next'

import { ProgressView } from '@/components/progress/ProgressView'
import { RailScreen } from '@/components/progress/RailScreen'

export const metadata: Metadata = { title: 'Progress' }

export default function ProgressPage() {
  return (
    <RailScreen current="progress">
      <ProgressView />
    </RailScreen>
  )
}
