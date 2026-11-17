import { describe, expect, it, vi } from 'vitest'

import {
  PROGRESS_DAY_ONE_FIXTURE,
  PROGRESS_FIXTURE,
  PROGRESS_WITH_PRACTICES_FIXTURE,
} from '../dashboard/fixtures'
import type { Fetch } from '../dashboard/http'
import { profileChangeSchema } from '../study/profile-change'

import { AVATAR_MAX_BASE64 } from './avatar'
import {
  afterFirstRun,
  afterPasscode,
  fetchProgress,
  fetchWelcomed,
  missedLine,
  saveProfile,
} from './client'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function recorder(response: () => Response) {
  const calls: { url: string; init: RequestInit | undefined }[] = []
  const fetch: Fetch = (url, init) => {
    calls.push({ url, init })
    return Promise.resolve(response())
  }

  const sent = (): unknown => {
    const body = calls[0]?.init?.body
    return typeof body === 'string' ? JSON.parse(body) : undefined
  }
  return { fetch, calls, sent }
}

describe('fetchProgress', () => {
  it('returns their profile, milestones and readiness', async () => {
    const { fetch, calls } = recorder(() => json(PROGRESS_FIXTURE))
    expect(await fetchProgress(fetch)).toEqual({ ok: true, data: PROGRESS_FIXTURE })
    expect(calls[0]?.url).toBe('/api/progress')
  })

  it('accepts day one: nothing studied, milestones at 0', async () => {
    const { fetch } = recorder(() => json(PROGRESS_DAY_ONE_FIXTURE))
    expect(await fetchProgress(fetch)).toEqual({ ok: true, data: PROGRESS_DAY_ONE_FIXTURE })
  })

  it('rejects any name but Coach Alex', async () => {
    const { fetch } = recorder(() => json({ ...PROGRESS_FIXTURE, name: 'Alex' }))
    expect(await fetchProgress(fetch)).toEqual({ ok: false, error: 'invalid' })
  })

  it('rejects a title that is not one of the three', async () => {
    for (const title of ['Grandmaster', 'Wayfarer', 'coach']) {
      const { fetch } = recorder(() => json({ ...PROGRESS_FIXTURE, title }))
      expect(await fetchProgress(fetch)).toEqual({ ok: false, error: 'invalid' })
    }
  })

  it('rejects milestones out of anything but 3 practice sessions and 10 practice classes', async () => {
    const { fetch } = recorder(() =>
      json({ ...PROGRESS_FIXTURE, practiceClasses: { done: 0, of: 12 } }),
    )
    expect(await fetchProgress(fetch)).toEqual({ ok: false, error: 'invalid' })
  })

  it('takes their latest mic practices when the server sends them', async () => {
    const { fetch } = recorder(() => json(PROGRESS_WITH_PRACTICES_FIXTURE))
    expect(await fetchProgress(fetch)).toEqual({ ok: true, data: PROGRESS_WITH_PRACTICES_FIXTURE })
  })

  it('drops a malformed practices list instead of failing the whole screen', async () => {
    const { fetch } = recorder(() =>
      json({ ...PROGRESS_FIXTURE, practices: [{ label: 'Practice 1', passed: 20, of: 19 }] }),
    )
    const result = await fetchProgress(fetch)
    expect(result.ok).toBe(true)
    expect(result.ok && result.data.practices).toBeUndefined()
  })
})

describe('missedLine', () => {
  it('names up to three missed must-dos, then counts the rest', () => {
    expect(missedLine(['pace cue', 'name first'])).toBe('Missed: pace cue, name first')
    expect(missedLine(['name first', 'setup', 'clear finish'])).toBe(
      'Missed: name first, setup, clear finish',
    )
    expect(missedLine(['pace cue', 'name first', 'a', 'b', 'c'])).toBe(
      'Missed: pace cue, name first and 3 more',
    )
    expect(missedLine([])).toBe('Every must-do passed.')
  })
})

describe('saveProfile', () => {
  it('posts the title the learner picked', async () => {
    const { fetch, calls, sent } = recorder(() => json({ ok: true }))
    expect(await saveProfile({ title: 'Mentor' }, fetch)).toEqual({ ok: true, data: true })
    expect(calls[0]?.url).toBe('/api/profile')
    expect(calls[0]?.init?.method).toBe('POST')
    expect(sent()).toEqual({ title: 'Mentor' })
  })

  it('posts their new photo', async () => {
    const { fetch, sent } = recorder(() => json({ ok: true }))
    expect(await saveProfile({ avatarJpegBase64: '/9j/4AAQ' }, fetch)).toEqual({
      ok: true,
      data: true,
    })
    expect(sent()).toEqual({ avatarJpegBase64: '/9j/4AAQ' })
  })

  it('refuses a photo over 300 KB without calling the server', async () => {
    const { fetch, calls } = recorder(() => json({ ok: true }))
    const tooBig = 'A'.repeat(AVATAR_MAX_BASE64 + 1)
    expect(await saveProfile({ avatarJpegBase64: tooBig }, fetch)).toEqual({
      ok: false,
      error: 'invalid',
    })
    expect(calls).toHaveLength(0)
  })

  it('refuses anything the route’s own schema refuses, without calling (one source of truth)', async () => {
    const { fetch, calls } = recorder(() => json({ ok: true }))
    for (const change of [{ avatarJpegBase64: 'not base64!' }, { avatarJpegBase64: '' }, {}]) {
      expect(profileChangeSchema.safeParse(change).success, JSON.stringify(change)).toBe(false)
      expect(await saveProfile(change, fetch), JSON.stringify(change)).toEqual({
        ok: false,
        error: 'invalid',
      })
    }
    expect(calls).toHaveLength(0)
  })

  it('records that the learner has seen the welcome', async () => {
    const { fetch, sent } = recorder(() => json({ ok: true }))
    expect(await saveProfile({ welcomed: true }, fetch)).toEqual({ ok: true, data: true })
    expect(sent()).toEqual({ welcomed: true })
  })

  it('records practice sessions and practice classes within their totals', async () => {
    const { fetch, sent } = recorder(() => json({ ok: true }))
    expect(await saveProfile({ practiceSessionsDone: 2 }, fetch)).toEqual({ ok: true, data: true })
    expect(sent()).toEqual({ practiceSessionsDone: 2 })
    const classes = recorder(() => json({ ok: true }))
    expect(await saveProfile({ practiceClassesDone: 10 }, classes.fetch)).toEqual({
      ok: true,
      data: true,
    })
  })

  it('refuses a milestone past its total, or not a whole number, without calling', async () => {
    for (const change of [
      { practiceSessionsDone: 4 },
      { practiceSessionsDone: -1 },
      { practiceClassesDone: 11 },
      { practiceClassesDone: 1.5 },
    ]) {
      const { fetch, calls } = recorder(() => json({ ok: true }))
      expect(await saveProfile(change, fetch)).toEqual({ ok: false, error: 'invalid' })
      expect(calls).toHaveLength(0)
    }
  })

  it('passes a failed save through as a typed error', async () => {
    const { fetch } = recorder(() => json({ error: 'nope' }, 500))
    expect(await saveProfile({ title: 'Practitioner' }, fetch)).toEqual({
      ok: false,
      error: 'server',
    })
  })
})

describe('fetchWelcomed and afterFirstRun', () => {
  it('goes Home after the first run once the learner has seen the welcome', async () => {
    const { fetch, calls } = recorder(() => json({ welcomed: true }))
    expect(await fetchWelcomed(fetch)).toBe(true)
    expect(calls[0]?.url).toBe('/api/profile')
    expect(afterFirstRun(true)).toBe('/')
  })

  it('shows the welcome the first time, and when it can’t tell', async () => {
    expect(await fetchWelcomed(recorder(() => json({ welcomed: false })).fetch)).toBe(false)
    expect(await fetchWelcomed(recorder(() => json({}, 500)).fetch)).toBe(false)
    expect(await fetchWelcomed(recorder(() => json({ welcomed: 'yes' })).fetch)).toBe(false)
    const offline: Fetch = () => Promise.reject(new TypeError('Load failed'))
    expect(await fetchWelcomed(offline)).toBe(false)
    expect(afterFirstRun(false)).toBe('/welcome')
  })
})

describe('afterPasscode', () => {
  it('goes straight Home from the passcode once the learner has seen the welcome', async () => {
    const { fetch, calls } = recorder(() => json({ welcomed: true }))
    expect(await afterPasscode('/first-run', fetch)).toBe('/')
    expect(calls[0]?.url).toBe('/api/profile')
  })

  it('keeps the microphone step on their first run and when it can’t tell', async () => {
    expect(await afterPasscode('/first-run', recorder(() => json({ welcomed: false })).fetch)).toBe(
      '/first-run',
    )
    expect(await afterPasscode('/first-run', recorder(() => json({}, 500)).fetch)).toBe(
      '/first-run',
    )
    const offline: Fetch = () => Promise.reject(new TypeError('Load failed'))
    expect(await afterPasscode('/first-run', offline)).toBe('/first-run')
  })

  it('waits at most 2.5 s for the answer, then keeps the microphone step', async () => {
    vi.useFakeTimers()
    try {
      const never: Fetch = () => new Promise<Response>(() => undefined)
      const where = afterPasscode('/first-run', never)
      await vi.advanceTimersByTimeAsync(2_500)
      expect(await where).toBe('/first-run')
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves every other page alone and asks nothing', async () => {
    const { fetch, calls } = recorder(() => json({ welcomed: true }))
    expect(await afterPasscode('/study?mode=start', fetch)).toBe('/study?mode=start')
    expect(await afterPasscode('/', fetch)).toBe('/')
    expect(calls).toHaveLength(0)
  })
})
