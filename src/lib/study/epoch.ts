// Reset numbers ('epochs'). A write is accepted only from a client on the current
// epoch, so stale devices can't write into a wiped history.

export const EPOCH_HEADER = 'x-data-epoch'

export const RESET_STATUS = 409
export const RESET_ERROR = 'reset'

export const EPOCH_KEY = 'coach-study:epoch:v1'

const EPOCH_PATTERN = /^(0|[1-9][0-9]{0,8})$/

export function parseEpoch(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const text = value.trim()
  return EPOCH_PATTERN.test(text) ? Number(text) : null
}

export function acceptsWrite(server: number, sent: string | null | undefined): boolean {
  const epoch = parseEpoch(sent)
  return epoch === null ? server === 0 : epoch === server
}

export type EpochDecision = 'same' | 'adopt' | 'reset'

// A device that never saw an epoch adopts 0 silently; any other mismatch is a reset.
export function decideEpoch(saved: number | null, server: number): EpochDecision {
  if (saved === server) return 'same'
  if (saved === null && server === 0) return 'adopt'
  return 'reset'
}

export type EpochStorage = Pick<Storage, 'getItem' | 'setItem'>

let memoryEpoch: number | null = null

export function browserEpochStorage(): EpochStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function savedEpoch(storage: EpochStorage | null = browserEpochStorage()): number | null {
  if (storage) {
    try {
      const saved = parseEpoch(storage.getItem(EPOCH_KEY))
      if (saved !== null) return saved
    } catch {}
  }
  return memoryEpoch
}

export function saveEpoch(
  epoch: number,
  storage: EpochStorage | null = browserEpochStorage(),
): boolean {
  let saved = false
  if (storage) {
    try {
      storage.setItem(EPOCH_KEY, String(epoch))
      saved = parseEpoch(storage.getItem(EPOCH_KEY)) === epoch
    } catch {
      saved = false
    }
  }
  memoryEpoch = saved ? null : epoch
  return saved
}

export function epochHeaders(
  storage: EpochStorage | null = browserEpochStorage(),
): Record<string, string> {
  return { [EPOCH_HEADER]: String(savedEpoch(storage) ?? 0) }
}

export async function resetEpochOf(response: Response): Promise<number | null> {
  if (response.status !== RESET_STATUS) return null
  try {
    const body: unknown = await response.clone().json()
    if (typeof body !== 'object' || body === null) return null
    if (!('error' in body) || body.error !== RESET_ERROR || !('epoch' in body)) return null
    return typeof body.epoch === 'number' ? parseEpoch(String(body.epoch)) : null
  } catch {
    return null
  }
}

type StaleListener = (epoch: number) => Promise<void> | void
const staleListeners = new Set<StaleListener>()

export function onStaleEpoch(listener: StaleListener): () => void {
  staleListeners.add(listener)
  return () => {
    staleListeners.delete(listener)
  }
}

export async function reportStaleEpoch(epoch: number): Promise<void> {
  await Promise.all([...staleListeners].map(async (listener) => listener(epoch)))
}

export function forgetMemoryEpoch(): void {
  memoryEpoch = null
}
