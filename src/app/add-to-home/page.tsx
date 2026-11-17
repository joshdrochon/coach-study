import type { Metadata } from 'next'

import { Button } from '@/components/Button'
import { Text } from '@/components/Text'
import { AddToHomeSteps } from '@/components/setup/AddToHomeSteps'
import { SetupStep } from '@/components/setup/SetupStep'
import { StandaloneForward } from '@/components/setup/StandaloneForward'

export const metadata: Metadata = { title: { absolute: 'Put Coach Study on your Home Screen' } }

const NEXT = '/first-run'

export default function AddToHomePage() {
  return (
    <SetupStep step={1} title="Put Coach Study on your Home Screen." safariOnly>
      <StandaloneForward to={NEXT} />
      <Text as="p" variant="subtitle" tone="text-2">
        It opens like an app, keeps your place, and can remind you to practice.
      </Text>
      <AddToHomeSteps />
      <Button variant="primary" href={NEXT}>
        I’ve added it
      </Button>
    </SetupStep>
  )
}
