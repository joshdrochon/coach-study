'use client'

import { useCallback, useEffect, useState } from 'react'

import type { Loaded } from '@/lib/cache/tab-cache'
import type { ApiResult } from '@/lib/dashboard/http'

export type { Loaded }

export function useLoad<T>(load: () => Promise<ApiResult<T>>): [Loaded<T>, () => void] {
  const [state, setState] = useState<Loaded<T>>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let current = true
    void load().then((result) => {
      if (!current) return
      setState(
        result.ok
          ? { status: 'ready', data: result.data }
          : { status: 'error', error: result.error },
      )
    })
    return () => {
      current = false
    }
  }, [load, attempt])

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    setAttempt((n) => n + 1)
  }, [])

  return [state, retry]
}
