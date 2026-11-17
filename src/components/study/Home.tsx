'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

import { cached, type Loaded } from '@/lib/cache/tab-cache'
import { rememberProfile } from '@/lib/progress/localCopy'
import { StudyClientError, type HomeView } from '@/lib/study/client'
import { progressLineEnabled } from '@/lib/study/flags'
import { SIZE_PX } from '@/styles/tokens'

import { Button } from '../Button'
import { Card } from '../Card'
import { Live } from '../progress/Live'
import { RailScreen } from '../progress/RailScreen'
import { useProfileCopy } from '../progress/useLocalCopy'
import { Text } from '../Text'

import { dateLabel, homeHero, planLine, WAITING_LINE } from './copy'
import styles from './Home.module.css'
import { browserClient, primeSpeech } from './speech'
import { TextLink } from './TextLink'

type Status = 'pending' | 'loading' | 'ready' | 'failed' | 'signed-out'

type HomeData = { view: HomeView | null; standIn: HomeView | null; status: Status }

const PENDING: HomeData = { view: null, standIn: null, status: 'pending' }

const homeData = cached<HomeView>('home', async () => {
  const client = browserClient()
  try {
    const view = await client.home()
    rememberProfile(view)
    return { ok: true, data: view }
  } catch (error) {
    const signedOut = error instanceof StudyClientError && error.status === 401
    return { ok: false, error: signedOut ? 'unauthorized' : 'network' }
  }
})

function homeSnapshots(): () => HomeData {
  let shown: { from: Loaded<HomeView>; data: HomeData } | null = null
  return () => {
    const loaded = homeData.get()
    if (shown?.from === loaded) return shown.data
    let data: HomeData
    if (loaded.status === 'ready') {
      data = { view: loaded.data, standIn: null, status: 'ready' }
    } else {
      const standIn = browserClient().cachedHome()
      if (loaded.status === 'loading') data = { view: null, standIn, status: 'loading' }
      else if (standIn) data = { view: standIn, standIn, status: 'ready' }
      else {
        const status = loaded.error === 'unauthorized' ? 'signed-out' : 'failed'
        data = { view: null, standIn: null, status }
      }
    }
    shown = { from: loaded, data }
    return data
  }
}
const pendingSnapshot = () => PENDING

function refreshHome() {
  void browserClient().flush()
  void homeData.revalidate()
}

function retryHome() {
  void browserClient().flush()
  homeData.retry()
}

const noSubscription = () => () => undefined
const today = () => dateLabel(new Date())
const noDate = () => ''

const watchSending = (listener: () => void) => browserClient().onSendChange(listener)
const sendTrouble = () => browserClient().sendTrouble()
const noTrouble = () => false

export function Home() {
  const router = useRouter()

  const [homeSnapshot] = useState(homeSnapshots)
  const { view, standIn, status } = useSyncExternalStore(
    homeData.subscribe,
    homeSnapshot,
    pendingSnapshot,
  )
  const copy = useProfileCopy()

  const failed = status === 'failed' || status === 'signed-out'
  const title = failed ? null : (view?.title ?? copy?.title ?? null)
  const avatarUrl = failed ? null : (view?.avatarUrl ?? copy?.avatarUrl ?? null)
  const date = useSyncExternalStore(noSubscription, today, noDate)
  const waiting = useSyncExternalStore(watchSending, sendTrouble, noTrouble)

  useEffect(refreshHome, [])

  const start = useCallback(() => {
    primeSpeech()
    router.push('/study?mode=start')
  }, [router])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== ' ' || event.repeat || event.metaKey || event.ctrlKey || event.altKey)
        return
      if (event.target instanceof Element && event.target.closest('a, button, input, textarea'))
        return
      event.preventDefault()
      start()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [start])

  return (
    <RailScreen current="home">
      <header className={styles.header}>
        <Text variant="label" tone="text-muted">
          {date}
        </Text>
        {}
        {avatarUrl && title ? (
          <Link href="/progress" className={styles.profile} data-component="profile-link">
            <Image
              src={avatarUrl}
              alt=""
              width={SIZE_PX['size-control']}
              height={SIZE_PX['size-control']}
              unoptimized
              className={styles.avatar}
            />
            <span className={styles.profileText}>
              <Text variant="body-l-strong">Coach Alex</Text>
              <Text variant="caption" tone="text-muted">
                {title}
              </Text>
            </span>
          </Link>
        ) : null}
      </header>
      <div className={styles.hero} aria-busy={status === 'pending' || status === 'loading'}>
        {}
        <HomeHero
          view={view}
          standIn={standIn}
          status={status === 'pending' ? 'loading' : status}
          waiting={waiting}
          onStart={start}
          onRetry={retryHome}
        />
      </div>
    </RailScreen>
  )
}

const HEADLINE_STAND_IN = 'Getting today’s plan…'
const LINE_STAND_IN = 'Current goal: a good grasp of all the material.'
const todayLine = (home: HomeView) =>
  planLine(home.baseline, progressLineEnabled() ? undefined : home.dueToday)

function HomeHero({
  view,
  standIn,
  status,
  waiting,
  onStart,
  onRetry,
}: {
  view: HomeView | null
  standIn: HomeView | null
  status: Status
  waiting: boolean
  onStart: () => void
  onRetry: () => void
}) {
  if (status === 'signed-out') {
    return (
      <div className={styles.intro}>
        <Text as="h1" variant="headline-xl">
          Can’t load today’s plan.
        </Text>
        <Text as="p" variant="subtitle" tone="text-2">
          Your passcode is needed again.
        </Text>
        <div className={styles.action}>
          <Button variant="primary" href="/passcode?next=%2F">
            Enter your passcode
          </Button>
        </div>
      </div>
    )
  }
  const hero = view ? homeHero(view) : null
  const loading = status === 'loading' && !view

  const last = standIn ? homeHero(standIn) : null
  const weakest = view ? view.weakestMustDo : loading ? (standIn?.weakestMustDo ?? null) : null
  return (
    <>
      <div className={styles.intro}>
        <Text as="h1" variant="headline-xl" aria-label={loading ? HEADLINE_STAND_IN : undefined}>
          {hero ? (
            <Live value={hero.headline} standIn={hero.headline} headline />
          ) : status === 'failed' ? (
            'Can’t load today’s plan.'
          ) : (
            <Live value={null} standIn={last?.headline ?? HEADLINE_STAND_IN} headline />
          )}
        </Text>
        {hero?.line ? (
          <Text as="p" variant="subtitle" tone="text-2" data-anchor="home-line">
            <Live value={hero.line} standIn={hero.line} />
          </Text>
        ) : loading && (last ? last.line : true) ? (
          <Text as="p" variant="subtitle" tone="text-2" data-anchor="home-line">
            <Live value={null} standIn={last?.line ?? LINE_STAND_IN} />
          </Text>
        ) : null}
        {status === 'failed' && !view ? (
          <>
            <Text as="p" variant="subtitle" tone="text-2">
              Check your Wi-Fi, then try again.
            </Text>
            <div className={styles.action}>
              <Button variant="secondary" onClick={onRetry}>
                Try again
              </Button>
            </div>
          </>
        ) : null}
      </div>
      <Card kind="hero">
        <div className={styles.today}>
          <div className={styles.todayText}>
            <Text as="div" variant="label" tone="text-muted">
              Today
            </Text>
            <Text as="p" variant="title-l">
              {view ? (
                <Live value={todayLine(view)} standIn={todayLine(view)} />
              ) : loading ? (
                <Live value={null} standIn={standIn ? todayLine(standIn) : planLine()} />
              ) : (
                planLine()
              )}
            </Text>
            {weakest ? (
              <Text as="p" variant="body-l" tone="text-2">
                <Live
                  value={view ? `Weakest must-do: ${weakest}` : null}
                  standIn={`Weakest must-do: ${weakest}`}
                />
              </Text>
            ) : null}
          </div>
          <Button variant="hero" onClick={onStart} fullWidth>
            Start
          </Button>
        </div>
      </Card>
      <div className={styles.footer}>
        <TextLink href="/choose">Choose what to practice</TextLink>
        <WaitingLine shown={waiting} />
      </div>
    </>
  )
}

function WaitingLine({ shown }: { shown: boolean }) {
  return (
    <Text
      as="p"
      variant="body"
      tone="text-muted"
      role="status"
      className={styles.waiting}
      data-anchor="home-waiting"
    >
      <span className={styles.reserve} aria-hidden="true">
        {WAITING_LINE}
      </span>
      {shown ? <span className={styles.shown}>{WAITING_LINE}</span> : null}
    </Text>
  )
}
