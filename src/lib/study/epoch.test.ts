import { beforeEach, describe, expect, it } from 'vitest'

import {
  acceptsWrite,
  decideEpoch,
  EPOCH_HEADER,
  EPOCH_KEY,
  epochHeaders,
  forgetMemoryEpoch,
  onStaleEpoch,
  parseEpoch,
  reportStaleEpoch,
  resetEpochOf,
  RESET_STATUS,
  savedEpoch,
  saveEpoch,
  type EpochStorage,
} from './epoch'

function memoryStorage(): EpochStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
  }
}

beforeEach(() => {
  forgetMemoryEpoch()
})

describe('parseEpoch', () => {
  it('reads a whole number and nothing else', () => {
    expect(parseEpoch('0')).toBe(0)
    expect(parseEpoch(' 3 ')).toBe(3)
    for (const value of [null, undefined, '', '-1', '1.5', '01', 'one', '1e3', '9999999999']) {
      expect(parseEpoch(value)).toBeNull()
    }
  })
})

describe('acceptsWrite (the server)', () => {
  it('takes a write with its own number only', () => {
    expect(acceptsWrite(0, '0')).toBe(true)
    expect(acceptsWrite(2, '2')).toBe(true)
    expect(acceptsWrite(1, '0')).toBe(false)
    expect(acceptsWrite(1, '2')).toBe(false)
  })

  it('takes a write without a number (an app from before this deploy) only until the first wipe', () => {
    expect(acceptsWrite(0, null)).toBe(true)
    expect(acceptsWrite(1, null)).toBe(false)
    expect(acceptsWrite(1, 'garbage')).toBe(false)
  })
})

describe('decideEpoch (the iPad)', () => {
  it('does nothing when the numbers match', () => {
    expect(decideEpoch(0, 0)).toBe('same')
    expect(decideEpoch(4, 4)).toBe('same')
  })

  it('first time, before any wipe: saves the number, clears nothing', () => {
    expect(decideEpoch(null, 0)).toBe('adopt')
  })

  it('resets when they differ, and when it never saved one but the server was wiped since', () => {
    expect(decideEpoch(0, 1)).toBe('reset')
    expect(decideEpoch(null, 1)).toBe('reset')

    expect(decideEpoch(2, 1)).toBe('reset')
  })
})

describe('the saved number', () => {
  it('is kept in storage and sent as the header (0 before one is saved)', () => {
    const storage = memoryStorage()
    expect(savedEpoch(storage)).toBeNull()
    expect(epochHeaders(storage)).toEqual({ [EPOCH_HEADER]: '0' })
    expect(saveEpoch(3, storage)).toBe(true)
    expect(storage.data.get(EPOCH_KEY)).toBe('3')
    expect(savedEpoch(storage)).toBe(3)
    expect(epochHeaders(storage)).toEqual({ [EPOCH_HEADER]: '3' })
  })

  it('holds in memory for the page when storage can’t be written', () => {
    const broken: EpochStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(saveEpoch(2, broken)).toBe(false)
    expect(savedEpoch(broken)).toBe(2)
    expect(saveEpoch(5, null)).toBe(false)
    expect(savedEpoch(null)).toBe(5)
  })
})

describe('resetEpochOf', () => {
  it('reads the server’s number from a 409 reset, and nothing else', async () => {
    const reset = Response.json({ error: 'reset', epoch: 2 }, { status: RESET_STATUS })
    expect(await resetEpochOf(reset)).toBe(2)

    expect(await reset.json()).toEqual({ error: 'reset', epoch: 2 })
    expect(await resetEpochOf(Response.json({ error: 'duplicate' }, { status: 409 }))).toBeNull()
    expect(await resetEpochOf(Response.json({ error: 'reset', epoch: 2 }))).toBeNull()
    expect(await resetEpochOf(new Response('nope', { status: 409 }))).toBeNull()
  })

  it('is reported to the page’s listeners, and settles once they have', async () => {
    const heard: number[] = []
    const stop = onStaleEpoch(async (epoch) => {
      await Promise.resolve()
      heard.push(epoch)
    })
    await reportStaleEpoch(4)
    expect(heard).toEqual([4])
    stop()
    await reportStaleEpoch(5)
    expect(heard).toEqual([4])
  })
})
