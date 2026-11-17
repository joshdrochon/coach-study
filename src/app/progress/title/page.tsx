import type { Metadata } from 'next'

import { TitleSheet } from '@/components/progress/TitleSheet'

export const metadata: Metadata = { title: 'Set your title' }

export default function TitlePage() {
  return <TitleSheet />
}
