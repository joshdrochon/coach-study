// Deterministic randomness: a string seed gives a stable shuffle, so the same day
// produces the same card order on every device.

export function hash32(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function seededRandom(seed: string): () => number {
  let state = hash32(seed)
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

export function seededRank(seed: string, key: string): number {
  return hash32(`${seed}\u0000${key}`)
}

export function seededKey(seed: string, key: string): string {
  return `${seededRank(seed, key).toString(16).padStart(8, '0')}:${key}`
}

export function seededOrder<T>(items: readonly T[], key: (item: T) => string, seed: string): T[] {
  return items
    .map((item) => ({ item, sortKey: seededKey(seed, key(item)) }))
    .toSorted((a, b) => compareText(a.sortKey, b.sortKey))
    .map(({ item }) => item)
}

export function weightedPick<T>(
  items: readonly [T, ...T[]],
  weight: (item: T) => number,
  random: number,
): T {
  const total = items.reduce((sum, item) => sum + weight(item), 0)
  let threshold = random * total
  let chosen = items[0]
  for (const item of items) {
    chosen = item
    threshold -= weight(item)
    if (threshold < 0) break
  }
  return chosen
}

export function compareText(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}
