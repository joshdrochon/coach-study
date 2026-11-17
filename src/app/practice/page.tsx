import type { Metadata } from 'next'

import { MicPractice } from '@/components/practice/MicPractice'

export const metadata: Metadata = { title: 'Mic practice' }

export default function PracticePage() {
  return <MicPractice />
}
