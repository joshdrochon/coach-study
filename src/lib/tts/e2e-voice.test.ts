import { describe, expect, it } from 'vitest'

import { fakeSpeechScript } from '../../../e2e/fake-speech'
import { TEST_ENV } from '../../../e2e/test-env'

type FakeWindow = {
  fetch: (input: string, init?: RequestInit) => Promise<Response>
}

function installFake(appVoice?: 'network'): { window: FakeWindow; reached: string[] } {
  const reached: string[] = []
  const window: FakeWindow = {
    fetch: (input) => {
      reached.push(input)
      return Promise.resolve(new Response('real network'))
    },
  }
  const navigator = { sendBeacon: () => false }
  const location = { href: 'https://app.test/study', origin: 'https://app.test' }
  const script = fakeSpeechScript({ mode: 'silent', ...(appVoice ? { appVoice } : {}) })

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function('window', 'navigator', 'location', 'document', script) as (
    ...globals: unknown[]
  ) => void
  run(window, navigator, location, {})
  return { window, reached }
}

describe('e2e and the app voice', () => {
  it('test servers have no voice key, so they never call ElevenLabs', () => {
    expect(TEST_ENV.ELEVENLABS_API_KEY).toBe('')
  })

  it('the fake speech module answers /api/tts in the page with the keyless 503', async () => {
    const { window, reached } = installFake()
    const answer = await window.fetch('/api/tts', {
      method: 'POST',
      body: JSON.stringify({ text: 'Take five.' }),
    })
    expect(answer.status).toBe(503)
    expect(await answer.json()).toEqual({ error: 'no-key', fallback: 'system-voice' })
    const replay = await window.fetch(`/api/tts/${'c'.repeat(64)}`)
    expect(replay.status).toBe(503)

    expect(reached).toEqual([])
    await window.fetch('/api/home')
    expect(reached).toEqual(['/api/home'])
  })
})
