'use client'

import { useSyncExternalStore } from 'react'

import { profileCopy, type LocalCopy, type ProfileCopy } from '@/lib/progress/localCopy'

const noCopy = () => null

export function useLocalCopy<T>(copy: LocalCopy<T>): T | null {
  return useSyncExternalStore(copy.subscribe, copy.read, noCopy)
}

export function useProfileCopy(): ProfileCopy | null {
  return useLocalCopy(profileCopy)
}
