import { describe, expect, it } from 'vitest'

import { decide, type Path } from './keyterms'
import { decideVoiceTest, voiceTestDecisionSchema } from './voice-test-decision'

describe('decideVoiceTest', () => {
  it('decides nothing until both modes have a full run', () => {
    expect(decideVoiceTest(null, null)).toEqual({
      decided: false,
      missing: ['safari-tab', 'home-screen'],
    })
    expect(decideVoiceTest('keep', null)).toEqual({ decided: false, missing: ['home-screen'] })

    expect(decideVoiceTest(null, 'keep')).toEqual({ decided: false, missing: ['safari-tab'] })
  })

  it('uses a Safari tab when voice works there but not in the Home Screen app', () => {
    expect(decideVoiceTest('keep', 'switch')).toEqual({
      decided: true,
      use: 'safari-tab',
      path: 'keep',
    })
    expect(decideVoiceTest('keep-with-fix-step', 'switch')).toEqual({
      decided: true,
      use: 'safari-tab',
      path: 'keep-with-fix-step',
    })
  })

  it('uses the Home Screen app, on its own path, whenever voice works there', () => {
    const paths: Path[] = ['keep', 'keep-with-fix-step', 'switch']
    for (const safari of paths) {
      expect(decideVoiceTest(safari, 'keep')).toEqual({
        decided: true,
        use: 'home-screen',
        path: 'keep',
      })
      expect(decideVoiceTest(safari, 'keep-with-fix-step')).toEqual({
        decided: true,
        use: 'home-screen',
        path: 'keep-with-fix-step',
      })
    }
  })

  it('switches to a paid speech service only when voice works in neither mode', () => {
    expect(decideVoiceTest('switch', 'switch')).toEqual({
      decided: true,
      use: null,
      path: 'switch',
    })
  })

  it('reads "works" off the committed thresholds: 20% still works, just over 20% does not', () => {
    expect(decideVoiceTest(decide(0.05), decide(0.2))).toMatchObject({ use: 'home-screen' })
    expect(decideVoiceTest(decide(0.2), decide(0.201))).toMatchObject({
      use: 'safari-tab',
      path: 'keep-with-fix-step',
    })
  })

  it('round-trips through the schema their screen parses the saved answer with', () => {
    for (const decision of [
      decideVoiceTest(null, 'keep'),
      decideVoiceTest('keep', 'switch'),
      decideVoiceTest('switch', 'switch'),
    ]) {
      expect(voiceTestDecisionSchema.parse(JSON.parse(JSON.stringify(decision)))).toEqual(decision)
    }
    expect(voiceTestDecisionSchema.safeParse({ decided: true, use: 'desktop' }).success).toBe(false)
  })
})
