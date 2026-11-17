'use client'

import { useEffect } from 'react'

import { appMode } from '@/lib/speech/browser'

export function StandaloneForward({ to }: { to: string }) {
  useEffect(() => {
    if (appMode() === 'home-screen') window.location.replace(to)
  }, [to])
  return null
}
