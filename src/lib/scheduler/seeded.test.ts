import { describe, expect, it } from 'vitest'

import {
  compareText,
  hash32,
  seededKey,
  seededOrder,
  seededRandom,
  seededRank,
  weightedPick,
} from './seeded'

describe('hash32', () => {
  it('is FNV-1a', () => {
    expect(hash32('')).toBe(0x811c9dc5)
    expect(hash32('a')).toBe(0xe40c292c)
    expect(hash32('sample move a')).not.toBe(hash32('sample move a '))
  })
})

describe('seededRandom', () => {
  it('repeats for a seed, differs across seeds, and stays in [0, 1)', () => {
    const draw = (seed: string): number[] => {
      const random = seededRandom(seed)
      return Array.from({ length: 1000 }, () => random())
    }
    const values = draw('session-1')
    expect(draw('session-1')).toEqual(values)
    expect(draw('session-2')).not.toEqual(values)
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true)
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    expect(mean).toBeGreaterThan(0.45)
    expect(mean).toBeLessThan(0.55)
  })
})

describe('seededRank', () => {
  it('is stable for a seed and key, and changes with the seed', () => {
    expect(seededRank('s', 'item')).toBe(seededRank('s', 'item'))
    expect(seededRank('s', 'item')).not.toBe(seededRank('t', 'item'))

    expect(seededRank('ab', 'c')).not.toBe(seededRank('a', 'bc'))
  })
})

describe('seededKey and seededOrder', () => {
  it('sort by the seeded rank, then by the key itself', () => {
    expect(seededKey('s', 'item')).toBe(
      `${seededRank('s', 'item').toString(16).padStart(8, '0')}:item`,
    )
    const items = ['a', 'b', 'c', 'd', 'e', 'f']
    const once = seededOrder(items, (item) => item, 'seed-1')
    expect(seededOrder(items.toReversed(), (item) => item, 'seed-1')).toEqual(once)
    expect(once.toSorted()).toEqual(items)
    const orders = new Set(
      ['seed-1', 'seed-2', 'seed-3', 'seed-4'].map((seed) =>
        seededOrder(items, (item) => item, seed).join(''),
      ),
    )
    expect(orders.size).toBeGreaterThan(1)
  })
})

describe('weightedPick', () => {
  it('picks in proportion to the weights', () => {
    const items: [string, ...string[]] = ['light', 'heavy']
    const weight = (item: string): number => (item === 'heavy' ? 3 : 1)
    expect(weightedPick(items, weight, 0)).toBe('light')
    expect(weightedPick(items, weight, 0.24)).toBe('light')
    expect(weightedPick(items, weight, 0.26)).toBe('heavy')
    expect(weightedPick(items, weight, 0.999)).toBe('heavy')
    const random = seededRandom('weights')
    const heavy = Array.from({ length: 4000 }, () => weightedPick(items, weight, random())).filter(
      (item) => item === 'heavy',
    ).length
    expect(heavy / 4000).toBeGreaterThan(0.72)
    expect(heavy / 4000).toBeLessThan(0.78)
  })

  it('returns the only item', () => {
    expect(weightedPick(['only'], () => 1, 0.5)).toBe('only')
  })
})

describe('compareText', () => {
  it('orders by code point, the same on every machine', () => {
    expect(['b', 'a', 'B', 'a-2', 'a-10'].toSorted(compareText)).toEqual([
      'B',
      'a',
      'a-10',
      'a-2',
      'b',
    ])
    expect(compareText('x', 'x')).toBe(0)
  })
})
