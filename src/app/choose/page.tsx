import type { Metadata } from 'next'

import { categoryChoices } from '@/components/study/categories'
import { Choose } from '@/components/study/Choose'
import { loadBank } from '@/lib/content/bank'

export const metadata: Metadata = { title: 'Choose what to practice' }

export default function ChoosePage() {
  const bank = loadBank()
  return <Choose categories={categoryChoices(bank.items, bank.passages)} />
}
