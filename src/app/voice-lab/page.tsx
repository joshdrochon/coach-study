import type { Metadata } from 'next'

import { Screen } from '@/components/Screen'
import { Text } from '@/components/Text'
import { VoiceLab } from '@/components/voice-lab/VoiceLab'

export const metadata: Metadata = { title: 'Voice lab' }
export const dynamic = 'force-dynamic'

export default function VoiceLabPage() {
  return (
    <Screen layout="workspace">
      <Text as="h1" variant="headline-l">
        Voice lab
      </Text>
      <VoiceLab />
    </Screen>
  )
}
