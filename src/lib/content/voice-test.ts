import 'server-only'

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { voiceTestSchema, type VoiceTestSentence } from '../speech/keyterms'

export function loadVoiceTestSentences(): VoiceTestSentence[] {
  const file = path.join(process.cwd(), 'content', 'voice-test.json')
  return voiceTestSchema.parse(JSON.parse(readFileSync(file, 'utf8'))).sentences
}
