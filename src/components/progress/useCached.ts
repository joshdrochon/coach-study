'use client'

import { useEffect, useSyncExternalStore } from 'react'

import { LOADING, type Cached, type Loaded } from '@/lib/cache/tab-cache'

const loading = <T>(): Loaded<T> => LOADING

export function useCached<T>(cache: Cached<T>): [Loaded<T>, () => void] {
  const state = useSyncExternalStore(cache.subscribe, cache.get, loading<T>)
  useEffect(() => {
    void cache.revalidate()
  }, [cache])
  return [state, cache.retry]
}
