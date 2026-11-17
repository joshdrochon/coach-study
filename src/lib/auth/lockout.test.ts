import { beforeEach, describe, expect, it } from 'vitest'

import { openTestDb, type Db } from '../db/client'

import { LIMITS, afterFailure, checkLock, clearDevice, lockedUntil, recordFailure } from './lockout'

const T0 = new Date('2026-08-17T08:00:00Z')
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000)

describe('afterFailure (pure)', () => {
  it('locks on the 5th wrong try within 15 minutes, for 15 minutes', () => {
    let state = afterFailure(undefined, LIMITS.device, T0)
    for (let i = 2; i <= 4; i++) state = afterFailure(state, LIMITS.device, minutes(i))
    expect(state.failures).toBe(4)
    expect(lockedUntil(state, minutes(4))).toBeNull()
    state = afterFailure(state, LIMITS.device, minutes(5))
    expect(lockedUntil(state, minutes(5))).toEqual(minutes(20))
    expect(lockedUntil(state, minutes(20))).toBeNull()
  })

  it('starts a new window once the old one has passed', () => {
    const old = afterFailure(undefined, LIMITS.device, T0)
    const later = afterFailure({ ...old, failures: 4 }, LIMITS.device, minutes(16))
    expect(later.failures).toBe(1)
    expect(later.lockedUntil).toBeNull()
  })
})

describe('lockout against the database', () => {
  let db: Db
  beforeEach(async () => {
    db = await openTestDb()
  })

  it('locks one device after 5 wrong tries but not another device', async () => {
    for (let i = 0; i < 5; i++) await recordFailure(db, 'app', '10.0.0.1', minutes(i))
    expect((await checkLock(db, 'app', '10.0.0.1', minutes(5))).locked).toBe(true)
    expect((await checkLock(db, 'app', '10.0.0.2', minutes(5))).locked).toBe(false)
    expect((await checkLock(db, 'app', '10.0.0.1', minutes(20))).locked).toBe(false)
  })

  it('counts tries left on the device', async () => {
    const first = await recordFailure(db, 'app', '10.0.0.3', T0)
    expect(first.deviceTriesLeft).toBe(4)
  })

  it('locks every device after 10 wrong tries from many devices within an hour', async () => {
    for (let i = 0; i < 10; i++) await recordFailure(db, 'app', `10.0.1.${String(i)}`, minutes(i))
    const check = await checkLock(db, 'app', '10.9.9.9', minutes(10))
    expect(check.locked).toBe(true)
  })

  it('keeps app and admin lockouts separate', async () => {
    for (let i = 0; i < 5; i++) await recordFailure(db, 'admin', '10.0.2.1', minutes(i))
    expect((await checkLock(db, 'admin', '10.0.2.1', minutes(5))).locked).toBe(true)
    expect((await checkLock(db, 'app', '10.0.2.1', minutes(5))).locked).toBe(false)
  })

  it('clears a device after a correct passcode', async () => {
    for (let i = 0; i < 3; i++) await recordFailure(db, 'app', '10.0.3.1', minutes(i))
    await clearDevice(db, 'app', '10.0.3.1')
    const next = await recordFailure(db, 'app', '10.0.3.1', minutes(4))
    expect(next.deviceTriesLeft).toBe(4)
  })
})
