'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@/components/Button'
import { CancelButton } from '@/components/CancelButton'
import { Screen } from '@/components/Screen'
import { Text } from '@/components/Text'
import type { ApiError } from '@/lib/dashboard/http'
import { fetchProgress, saveProfile } from '@/lib/progress/client'
import { isPromotion, TITLES, type CoachTitle } from '@/lib/progress/titles'
import { CUE_LOAD_MS } from '@/lib/sound/timing'
import { appVoice, preloadSounds, primeVoice } from '@/lib/speech/browser'

import { Avatar } from './Avatar'
import { Placeholder } from './Placeholder'
import styles from './TitleSheet.module.css'
import { useLoad } from './useLoad'

type Saving =
  { state: 'idle' } | { state: 'saving'; title: CoachTitle } | { state: 'failed'; error: ApiError }

const SIGNED_OUT = 'Enter your passcode again to change your title.'

const LOAD_ERROR: Record<ApiError, string> = {
  network: 'No connection. Check your Wi-Fi, then try again.',
  server: 'Your title didn’t load. Try again in a minute.',
  invalid: 'Your title didn’t load. Try again in a minute.',
  unauthorized: SIGNED_OUT,
}

const SAVE_ERROR: Record<ApiError, string> = {
  network: 'That didn’t save. Check your Wi-Fi, then try again.',
  server: 'That didn’t save. Try again in a minute.',
  invalid: 'That didn’t save. Try again in a minute.',
  unauthorized: SIGNED_OUT,
}

export function TitleSheet() {
  const router = useRouter()
  const [loaded, retry] = useLoad(fetchProgress)
  const [saving, setSaving] = useState<Saving>({ state: 'idle' })
  const [promoted, setPromoted] = useState<CoachTitle | null>(null)

  const profile = loaded.status === 'ready' ? loaded.data : null
  const error =
    loaded.status === 'error'
      ? { text: LOAD_ERROR[loaded.error], kind: loaded.error }
      : saving.state === 'failed'
        ? { text: SAVE_ERROR[saving.error], kind: saving.error }
        : null

  async function choose(title: CoachTitle) {
    if (!profile || saving.state === 'saving') return
    if (title === profile.title) {
      router.push('/progress')
      return
    }

    const promotion = isPromotion(profile.title, title)
    if (promotion) {
      primeVoice()
      preloadSounds()
    }
    setSaving({ state: 'saving', title })
    const result = await saveProfile({ title })
    if (!result.ok) {
      setSaving({ state: 'failed', error: result.error })
      return
    }
    if (promotion) {
      setPromoted(title)

      void appVoice().cue('promoted', CUE_LOAD_MS)
    } else router.push('/progress')
  }

  if (promoted && profile) {
    return (
      <Screen layout="moment">
        <div className={styles.avatar}>
          <Avatar src={profile.avatarUrl} size="size-orb" />
        </div>
        <div className={styles.lines}>
          <Text as="h1" variant="headline-xl">
            You’re a {promoted}.
          </Text>
          <Text as="p" variant="subtitle" tone="text-2">
            Congratulations, Coach Alex!
          </Text>
        </div>
        <Button variant="primary" href="/progress" fullWidth>
          Back to Progress
        </Button>
      </Screen>
    )
  }

  const selected = saving.state === 'saving' ? saving.title : profile?.title

  return (
    <Screen layout="sheet" wide={loaded.status !== 'error'}>
      <Text as="h1" variant="headline-l">
        Set your title.
      </Text>
      <Text as="p" variant="body-l" tone="text-muted">
        Change it when you’re promoted.
      </Text>
      {loaded.status === 'error' ? null : (
        <div role="group" aria-label="Your title" className={styles.picker} data-picker="true">
          {TITLES.map((title) =>
            profile ? (
              <button
                key={title}
                type="button"
                className={`${styles.option ?? ''} ${title === selected ? (styles.selected ?? '') : ''}`}
                data-component={title === selected ? 'picker-option-selected' : 'picker-option'}
                aria-current={title === profile.title ? 'true' : undefined}
                disabled={saving.state === 'saving'}
                onClick={() => void choose(title)}
              >
                <Text variant="button">{title}</Text>
              </button>
            ) : (
              <span key={title} className={styles.option}>
                <Placeholder variant="button" width="half" />
              </span>
            ),
          )}
        </div>
      )}
      {error ? (
        <Text as="p" variant="body-l" tone="warn-text" role="alert">
          {error.text}
        </Text>
      ) : null}
      {error?.kind === 'unauthorized' ? (
        <Button variant="primary" href="/passcode?next=/progress/title" fullWidth>
          Enter your passcode
        </Button>
      ) : loaded.status === 'error' ? (
        <Button variant="primary" onClick={retry} fullWidth>
          Try again
        </Button>
      ) : null}
      <CancelButton href="/progress" fullWidth />
    </Screen>
  )
}
