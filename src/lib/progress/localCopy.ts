import { z } from 'zod'

import { TITLES } from './titles'

export const PROFILE_KEY = 'coach-study:profile:v1'
export const PROGRESS_KEY = 'coach-study:progress:v1'

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export type LocalCopy<T> = {
  read: () => T | null
  write: (value: T) => void
  subscribe: (listener: () => void) => () => void
}

export function localCopy<T>(
  key: string,
  schema: z.ZodType<T>,
  storage: () => Storage | null = browserStorage,
): LocalCopy<T> {
  const listeners = new Set<() => void>()
  let lastRaw: string | null | undefined
  let lastValue: T | null = null
  const read = (): T | null => {
    const store = storage()
    if (!store) return null
    let raw: string | null
    try {
      raw = store.getItem(key)
    } catch {
      return null
    }
    if (raw === lastRaw) return lastValue
    lastRaw = raw
    try {
      const parsed = schema.safeParse(raw === null ? null : JSON.parse(raw))
      lastValue = parsed.success ? parsed.data : null
    } catch {
      lastValue = null
    }
    return lastValue
  }
  return {
    read,
    write(value) {
      const store = storage()
      if (!store) return
      try {
        store.setItem(key, JSON.stringify(value))
      } catch {
        return
      }
      for (const listener of listeners) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      const onStorage = (event: StorageEvent) => {
        if (event.key === key || event.key === null) listener()
      }
      if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
      return () => {
        listeners.delete(listener)
        if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
      }
    },
  }
}

const profileCopySchema = z.object({
  title: z.enum(TITLES),
  avatarUrl: z.string().min(1).optional(),
})
export type ProfileCopy = z.infer<typeof profileCopySchema>

export const profileCopy = localCopy(PROFILE_KEY, profileCopySchema)

export function rememberProfile(change: { title?: string; avatarUrl?: string }): void {
  const current = profileCopy.read()
  const title = TITLES.find((each) => each === change.title) ?? current?.title
  if (!title) return
  const avatarUrl = change.avatarUrl ?? current?.avatarUrl
  if (current?.title === title && current.avatarUrl === avatarUrl) return
  profileCopy.write(avatarUrl === undefined ? { title } : { title, avatarUrl })
}
