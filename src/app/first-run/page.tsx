import type { Metadata } from 'next'

import { MicStep } from '@/components/setup/MicStep'

export const metadata: Metadata = { title: 'Let the app hear you' }

export default function FirstRunPage() {
  return <MicStep />
}
