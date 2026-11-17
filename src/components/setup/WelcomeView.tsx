'use client'

import { useState, type ChangeEvent } from 'react'

import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { Screen } from '@/components/Screen'
import { Text, type TextTone } from '@/components/Text'
import { Avatar } from '@/components/progress/Avatar'
import { EMPTY_LINE } from '@/components/progress/Placeholder'
import { TextLink, textLinkClass } from '@/components/progress/TextLink'
import { TitleLadder } from '@/components/progress/TitleLadder'
import { useLoad } from '@/components/progress/useLoad'
import type { ApiError } from '@/lib/dashboard/http'
import { AvatarError, toAvatarJpeg } from '@/lib/progress/avatar'
import { fetchProgress, saveProfile } from '@/lib/progress/client'

import styles from './WelcomeView.module.css'

type PhotoStatus =
  'idle' | 'saving' | 'saved' | 'unreadable' | 'too-large' | 'offline' | 'failed' | 'signed-out'

type Line = { text: string; tone: TextTone }

const STATUS: Record<PhotoStatus, Line> = {
  idle: { text: '', tone: 'text-muted' },
  saving: { text: 'Saving your photo…', tone: 'text-muted' },
  saved: { text: 'Photo saved.', tone: 'text-muted' },
  unreadable: { text: 'That photo didn’t open. Try another one.', tone: 'warn-text' },
  'too-large': { text: 'That photo is too big. Try another one.', tone: 'warn-text' },
  offline: { text: 'No connection. Check your Wi-Fi, then try again.', tone: 'warn-text' },
  failed: { text: 'That photo didn’t save. Try again in a minute.', tone: 'warn-text' },
  'signed-out': { text: 'Enter your passcode again to change your photo.', tone: 'warn-text' },
}

const NOT_LOADED: Record<ApiError, Line> = {
  network: { text: 'Your photo didn’t load. Check your Wi-Fi.', tone: 'warn-text' },
  server: { text: 'Your photo didn’t load. Try again in a minute.', tone: 'warn-text' },
  invalid: { text: 'Your photo didn’t load. Try again in a minute.', tone: 'warn-text' },
  unauthorized: { text: 'Enter your passcode again to see your photo.', tone: 'warn-text' },
}

const SAVE_FAILED: Record<ApiError, PhotoStatus> = {
  network: 'offline',
  server: 'failed',
  invalid: 'failed',
  unauthorized: 'signed-out',
}

export function WelcomeView() {
  const [loaded] = useLoad(fetchProgress)
  const [photo, setPhoto] = useState<string | null>(null)
  const [status, setStatus] = useState<PhotoStatus>('idle')

  const profile = loaded.status === 'ready' ? loaded.data : null
  const src = photo ?? profile?.avatarUrl ?? null
  const loadFailed = status === 'idle' && loaded.status === 'error' ? loaded.error : null
  const line = loadFailed ? NOT_LOADED[loadFailed] : STATUS[status]
  const signedOut = status === 'signed-out' || loadFailed === 'unauthorized'

  async function change(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''
    if (!file || status === 'saving') return
    setStatus('saving')
    let jpeg: string
    try {
      jpeg = await toAvatarJpeg(file)
    } catch (error) {
      setStatus(error instanceof AvatarError ? error.reason : 'failed')
      return
    }
    const result = await saveProfile({ avatarJpegBase64: jpeg })
    if (!result.ok) {
      setStatus(SAVE_FAILED[result.error])
      return
    }
    setPhoto(`data:image/jpeg;base64,${jpeg}`)
    setStatus('saved')
  }

  return (
    <Screen layout="moment">
      <div className={styles.avatar}>
        <Avatar src={src} size="size-orb" />
      </div>
      <div className={styles.lines}>
        <Text as="h1" variant="headline-xl">
          Welcome, Coach Alex.
        </Text>
        <Text as="p" variant="subtitle" tone="text-2">
          Congratulations on making it this far!
        </Text>
      </div>
      <Card as="div">
        <TitleLadder current={profile?.title ?? null} />
      </Card>
      <div className={styles.actions}>
        {}
        <Button
          variant="primary"
          href="/"
          fullWidth
          onClick={() => void saveProfile({ welcomed: true })}
        >
          Let’s go
        </Button>
        <div className={styles.photo}>
          <label className={textLinkClass} data-component="text-link">
            <Text variant="body-strong">Change photo</Text>
            <input
              type="file"
              accept="image/*"
              className={styles.file}
              disabled={status === 'saving'}
              onChange={(event) => void change(event)}
            />
          </label>
          {}
          <Text as="p" variant="caption" tone={line.tone} role="status">
            {line.text || EMPTY_LINE}
          </Text>
          {signedOut ? (
            <TextLink href="/passcode?next=/welcome">Enter your passcode</TextLink>
          ) : null}
        </div>
      </div>
    </Screen>
  )
}
