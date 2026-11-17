import { describe, expect, it } from 'vitest'

import { fetchLearning, fetchSystem } from './client'
import {
  LEARNING_EMPTY_FIXTURE,
  LEARNING_FIXTURE,
  SYSTEM_EMPTY_FIXTURE,
  SYSTEM_FIXTURE,
} from './fixtures'
import { getJson, postJson, type Fetch } from './http'

type Call = { url: string; init: RequestInit | undefined }

function stub(respond: () => Response | Promise<Response>): { fetch: Fetch; calls: Call[] } {
  const calls: Call[] = []
  return {
    calls,
    fetch: (url, init) => {
      calls.push({ url, init })
      return Promise.resolve(respond())
    },
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('fetchSystem', () => {
  it('calls the System route and returns the checked data', async () => {
    const { fetch, calls } = stub(() => json(SYSTEM_FIXTURE))
    expect(await fetchSystem(fetch)).toEqual({ ok: true, data: SYSTEM_FIXTURE })
    expect(calls[0]?.url).toBe('/api/admin/system')
    expect(calls[0]?.init?.cache).toBe('no-store')
  })

  it('accepts a day with nothing measured yet (nulls and empty lists)', async () => {
    const { fetch } = stub(() => json(SYSTEM_EMPTY_FIXTURE))
    expect(await fetchSystem(fetch)).toEqual({ ok: true, data: SYSTEM_EMPTY_FIXTURE })
  })

  it('rejects a percent sent as 0-100 instead of a ratio', async () => {
    const body = structuredClone(SYSTEM_FIXTURE)
    if (body.evalGate) body.evalGate.heldOutAgreement = 96.1
    const { fetch } = stub(() => json(body))
    expect(await fetchSystem(fetch)).toEqual({ ok: false, error: 'invalid' })
  })

  it('keeps the tab when the eval run recorded only some categories', async () => {
    const body = structuredClone(SYSTEM_FIXTURE)
    if (body.evalGate) body.evalGate.categories = { schema_valid: 1 }
    const { fetch } = stub(() => json(body))
    const result = await fetchSystem(fetch)
    expect(result.ok && result.data.evalGate?.categories).toEqual({ schema_valid: 1 })
  })

  it('rejects an unknown dispute status', async () => {
    const body = { ...SYSTEM_FIXTURE, disputes: [{ title: 'x', status: 'Open', note: '' }] }
    const { fetch } = stub(() => json(body))
    expect(await fetchSystem(fetch)).toEqual({ ok: false, error: 'invalid' })
  })
})

describe('fetchLearning', () => {
  it('calls the Learning route and returns the checked data', async () => {
    const { fetch, calls } = stub(() => json(LEARNING_FIXTURE))
    expect(await fetchLearning(fetch)).toEqual({ ok: true, data: LEARNING_FIXTURE })
    expect(calls[0]?.url).toBe('/api/admin/learning')
  })

  it('accepts no data yet', async () => {
    const { fetch } = stub(() => json(LEARNING_EMPTY_FIXTURE))
    expect(await fetchLearning(fetch)).toEqual({ ok: true, data: LEARNING_EMPTY_FIXTURE })
  })

  it('rejects a practice that passed more must-dos than it had', async () => {
    const body = { ...LEARNING_FIXTURE, practices: [{ label: 'Practice 1', passed: 20, of: 19 }] }
    const { fetch } = stub(() => json(body))
    expect(await fetchLearning(fetch)).toEqual({ ok: false, error: 'invalid' })
  })
})

describe('typed errors', () => {
  it('reports an ended session as unauthorized', async () => {
    const { fetch } = stub(() => json({ error: 'unauthorized' }, 401))
    expect(await fetchSystem(fetch)).toEqual({ ok: false, error: 'unauthorized' })
  })

  it('reports a server failure', async () => {
    const { fetch } = stub(() => json({ error: 'boom' }, 500))
    expect(await fetchLearning(fetch)).toEqual({ ok: false, error: 'server' })
  })

  it('reports no connection', async () => {
    const fetch: Fetch = () => Promise.reject(new TypeError('Failed to fetch'))
    expect(await fetchSystem(fetch)).toEqual({ ok: false, error: 'network' })
  })

  it('reports a body that is not JSON', async () => {
    const { fetch } = stub(() => new Response('<html>', { status: 200 }))
    expect(await fetchSystem(fetch)).toEqual({ ok: false, error: 'invalid' })
  })
})

describe('getJson and postJson', () => {
  it('sends JSON with the right method and headers', async () => {
    const { fetch, calls } = stub(() => json({ ok: true }))
    const { z } = await import('zod')
    const result = await postJson('/api/x', { a: 1 }, z.object({ ok: z.literal(true) }), fetch)
    expect(result).toEqual({ ok: true, data: { ok: true } })
    expect(calls[0]?.init?.method).toBe('POST')
    expect(calls[0]?.init?.body).toBe('{"a":1}')
    expect(new Headers(calls[0]?.init?.headers).get('Content-Type')).toBe('application/json')
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('still calls on a browser without AbortSignal.timeout, just without the time limit', async () => {
    const original = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout')
    Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true })
    try {
      const { fetch, calls } = stub(() => json(SYSTEM_FIXTURE))
      expect(await fetchSystem(fetch)).toEqual({ ok: true, data: SYSTEM_FIXTURE })
      expect(calls[0]?.init?.signal).toBeUndefined()
    } finally {
      if (original) Object.defineProperty(AbortSignal, 'timeout', original)
    }
  })

  it('asks for JSON on a GET', async () => {
    const { fetch, calls } = stub(() => json([1, 2]))
    const { z } = await import('zod')
    expect(await getJson('/api/y', z.array(z.number()), fetch)).toEqual({ ok: true, data: [1, 2] })
    expect(calls[0]?.init?.method).toBeUndefined()
    expect(new Headers(calls[0]?.init?.headers).get('Accept')).toBe('application/json')
  })
})
