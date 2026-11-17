import { z } from 'zod'

import type { Path } from './keyterms'

export const VOICE_TEST_MODES = ['safari-tab', 'home-screen'] as const
export type VoiceTestMode = (typeof VOICE_TEST_MODES)[number]

const pathSchema = z.enum(['keep', 'keep-with-fix-step', 'switch'])

export const voiceTestDecisionSchema = z.discriminatedUnion('decided', [
  z.object({ decided: z.literal(false), missing: z.array(z.enum(VOICE_TEST_MODES)).min(1) }),
  z.object({
    decided: z.literal(true),

    use: z.enum(VOICE_TEST_MODES).nullable(),
    path: pathSchema,
  }),
])
export type VoiceTestDecision = z.infer<typeof voiceTestDecisionSchema>

export function voiceWorks(path: Path): boolean {
  return path !== 'switch'
}

export function decideVoiceTest(
  safariTab: Path | null,
  homeScreen: Path | null,
): VoiceTestDecision {
  if (safariTab === null || homeScreen === null) {
    const missing: VoiceTestMode[] = []
    if (safariTab === null) missing.push('safari-tab')
    if (homeScreen === null) missing.push('home-screen')
    return { decided: false, missing }
  }
  if (voiceWorks(homeScreen)) return { decided: true, use: 'home-screen', path: homeScreen }
  if (voiceWorks(safariTab)) return { decided: true, use: 'safari-tab', path: safariTab }
  return { decided: true, use: null, path: 'switch' }
}
