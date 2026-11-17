import type { Metadata } from 'next'

import { StudySession } from '@/components/study/StudySession'
import { STUDY_MODES, type StudyMode } from '@/lib/study/client'

export const metadata: Metadata = { title: 'Study' }

type Search = { mode?: string | string[]; categories?: string | string[] }

function one(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : ''
}

export default async function StudyPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams
  const categories = one(search.categories)
    .split(',')
    .map((category) => category.trim())
    .filter(Boolean)
  const asked = one(search.mode)
  let mode: StudyMode = STUDY_MODES.find((known) => known === asked) ?? 'start'
  if (mode === 'focus' && categories.length === 0) mode = 'start'
  return <StudySession mode={mode} categories={mode === 'focus' ? categories : []} />
}
