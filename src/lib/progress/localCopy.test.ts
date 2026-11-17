import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { localCopy } from './localCopy'

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => {
      data.clear()
    },
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => {
      data.delete(key)
    },
    setItem: (key, value) => {
      data.set(key, value)
    },
  }
}

describe('localCopy', () => {
  const schema = z.object({ title: z.string() })

  it('reads back what was written, the same object until it changes, and tells listeners', () => {
    const storage = memoryStorage()
    const copy = localCopy('coach-study:test:v1', schema, () => storage)
    expect(copy.read()).toBeNull()
    let told = 0
    const stop = copy.subscribe(() => {
      told += 1
    })
    copy.write({ title: 'Practitioner' })
    const first = copy.read()
    expect(first).toEqual({ title: 'Practitioner' })
    expect(copy.read()).toBe(first)
    expect(told).toBe(1)
    stop()
    copy.write({ title: 'Mentor' })
    expect(told).toBe(1)
    expect(copy.read()).toEqual({ title: 'Mentor' })
  })

  it('treats a malformed or cleared copy as none, and works without storage', () => {
    const storage = memoryStorage()
    const copy = localCopy('coach-study:test:v1', schema, () => storage)
    storage.setItem('coach-study:test:v1', '{not json')
    expect(copy.read()).toBeNull()
    storage.setItem('coach-study:test:v1', JSON.stringify({ title: 3 }))
    expect(copy.read()).toBeNull()
    storage.clear()
    expect(copy.read()).toBeNull()
    const none = localCopy('coach-study:test:v1', schema, () => null)
    none.write({ title: 'Practitioner' })
    expect(none.read()).toBeNull()
  })
})
