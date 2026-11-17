import { describe, expect, it } from 'vitest'

import { clientIp, passcodeMatches, safeNext } from './passcode'

describe('passcodeMatches', () => {
  it('accepts only the exact passcode', () => {
    expect(passcodeMatches('7391', '7391')).toBe(true)
    expect(passcodeMatches('7392', '7391')).toBe(false)
    expect(passcodeMatches('73910', '7391')).toBe(false)
    expect(passcodeMatches('', '7391')).toBe(false)
  })
})

describe('clientIp', () => {
  it('takes the first forwarded address', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe(
      '203.0.113.7',
    )
  })
  it('falls back to x-real-ip, then unknown', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2')
    expect(clientIp(new Headers({ 'x-forwarded-for': ' ' }))).toBe('unknown')
  })
})

describe('safeNext', () => {
  it('keeps same-origin paths', () => {
    expect(safeNext('/voice-test?x=1')).toBe('/voice-test?x=1')
  })
  it('refuses open redirects', () => {
    expect(safeNext('https://evil.example')).toBe('/')
    expect(safeNext('//evil.example')).toBe('/')
    expect(safeNext('/\\evil.example')).toBe('/')
    expect(safeNext(null)).toBe('/')
  })
})
