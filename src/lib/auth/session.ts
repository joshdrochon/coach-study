// Signed session cookies (HMAC), one kind for the learner and one for the admin.

export type SessionKind = 'app' | 'admin'

export const SESSION_COOKIE: Record<SessionKind, string> = { app: 'cs_app', admin: 'cs_admin' }

export const SESSION_TTL_SECONDS: Record<SessionKind, number> = {
  app: 30 * 24 * 60 * 60,
  admin: 12 * 60 * 60,
}

type Payload = { v: 1; k: SessionKind; iat: number; exp: number }

const encoder = new TextEncoder()

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export async function signSession(
  kind: SessionKind,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const payload: Payload = {
    v: 1,
    k: kind,
    iat: nowSeconds,
    exp: nowSeconds + SESSION_TTL_SECONDS[kind],
  }
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)))
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body))
  return `${body}.${toBase64Url(new Uint8Array(signature))}`
}

function isPayload(value: unknown): value is Payload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'v' in value &&
    value.v === 1 &&
    'k' in value &&
    (value.k === 'app' || value.k === 'admin') &&
    'iat' in value &&
    typeof value.iat === 'number' &&
    'exp' in value &&
    typeof value.exp === 'number'
  )
}

export async function verifySession(
  token: string | undefined,
  kind: SessionKind,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!token) return false
  const [body, signature, extra] = token.split('.')
  if (!body || !signature || extra !== undefined) return false
  let valid: boolean
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      fromBase64Url(signature),
      encoder.encode(body),
    )
  } catch {
    return false
  }
  if (!valid) return false
  let payload: unknown
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body)))
  } catch {
    return false
  }
  return isPayload(payload) && payload.k === kind && payload.exp > nowSeconds
}
