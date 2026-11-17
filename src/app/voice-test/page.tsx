import type { Metadata } from 'next'

import { Screen } from '@/components/Screen'
import { Text } from '@/components/Text'
import { VoiceTest } from '@/components/VoiceTest'
import { loadVoiceTestSentences } from '@/lib/content/voice-test'

export const metadata: Metadata = { title: 'Voice test' }
export const dynamic = 'force-dynamic'

export default function VoiceTestPage() {
  let sentences
  try {
    sentences = loadVoiceTestSentences()
  } catch {
    return (
      <Screen layout="moment">
        <Text as="h1" variant="headline-xl">
          Not ready yet.
        </Text>
        <Text as="p" variant="subtitle" tone="text-2">
          The voice test sentences aren’t loaded. Try again later.
        </Text>
      </Screen>
    )
  }
  return <VoiceTest sentences={sentences} />
}
