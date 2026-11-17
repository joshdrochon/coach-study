import type { z } from 'zod'

import { noteWrite } from '../cache/tab-cache'

export type ApiError = 'unauthorized' | 'network' | 'server' | 'invalid'
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError }

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

const TIMEOUT_MS = 10_000

function timeoutSignal(): AbortSignal | undefined {
  return typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(TIMEOUT_MS) : undefined
}

async function call<T>(
  url: string,
  init: RequestInit,
  schema: z.ZodType<T>,
  fetchImpl: Fetch,
): Promise<ApiResult<T>> {
  let response: Response
  try {
    response = await fetchImpl(url, { ...init, cache: 'no-store', signal: timeoutSignal() })
  } catch {
    return { ok: false, error: 'network' }
  }
  if (response.status === 401) return { ok: false, error: 'unauthorized' }
  if (!response.ok) return { ok: false, error: 'server' }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { ok: false, error: 'invalid' }
  }
  const parsed = schema.safeParse(body)
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: 'invalid' }
}

export function getJson<T>(
  url: string,
  schema: z.ZodType<T>,
  fetchImpl: Fetch = fetch,
): Promise<ApiResult<T>> {
  return call(url, { headers: { Accept: 'application/json' } }, schema, fetchImpl)
}

function sendJson<T>(
  method: 'POST' | 'DELETE',
  url: string,
  body: unknown,
  schema: z.ZodType<T>,
  fetchImpl: Fetch,
): Promise<ApiResult<T>> {
  return call(
    url,
    {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    schema,
    fetchImpl,
  ).finally(() => {
    noteWrite(url)
  })
}

export function postJson<T>(
  url: string,
  body: unknown,
  schema: z.ZodType<T>,
  fetchImpl: Fetch = fetch,
): Promise<ApiResult<T>> {
  return sendJson('POST', url, body, schema, fetchImpl)
}

export function deleteJson<T>(
  url: string,
  body: unknown,
  schema: z.ZodType<T>,
  fetchImpl: Fetch = fetch,
): Promise<ApiResult<T>> {
  return sendJson('DELETE', url, body, schema, fetchImpl)
}
