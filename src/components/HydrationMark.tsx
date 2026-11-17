'use client'

import { useEffect } from 'react'

export function HydrationMark() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = 'true'
  }, [])
  return null
}
