'use client'

// The study screen. Holds the session state machine and renders whichever screen
// it is on; the logic lives in lib/study/session.ts.

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

import type { StudyMode } from '@/lib/study/client'
import {
  INITIAL_STATE,
  type SessionKey,
  type SessionState,
  type StudySession as Session,
} from '@/lib/study/session'

import { LandingGuard } from '../tap-guard'
import { Text } from '../Text'

import { BreakScreen } from './BreakScreen'
import { CardScreen } from './CardScreen'
import { milestoneLine } from './copy'
import { DoneScreen } from './DoneScreen'
import { LoadErrorScreen } from './LoadErrorScreen'
import { MicBlockedScreen } from './MicBlockedScreen'
import { RatingScreen } from './RatingScreen'
import { ReportScreen } from './ReportScreen'
import { ReportSentScreen } from './ReportSentScreen'
import { ResultScreen } from './ResultScreen'
import { SelfGradeScreen } from './SelfGradeScreen'
import { SourceScreen } from './SourceScreen'
import { createBrowserSession, primeSpeech } from './speech'
import styles from './StudySession.module.css'
import { StudyFrame } from './StudyFrame'

class SessionHolder {
  session: Session | null = null
  private unsubscribe: (() => void) | null = null
  private readonly listeners = new Set<() => void>()

  private draft: { itemId: string; text: string } | null = null

  readonly answerShown = new LandingGuard()

  draftFor(itemId: string): string {
    return this.draft?.itemId === itemId ? this.draft.text : ''
  }

  keepDraft(itemId: string, text: string): void {
    this.draft = text === '' ? null : { itemId, text }
  }

  getState = (): SessionState => this.session?.getState() ?? INITIAL_STATE
  getServerState = (): SessionState => INITIAL_STATE

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  attach(session: Session): void {
    this.unsubscribe?.()
    this.session = session
    this.unsubscribe = session.subscribe(this.notify)
    this.notify()
  }

  detach(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.session = null
    this.notify()
  }

  private notify = (): void => {
    for (const listener of this.listeners) listener()
  }
}

const KEYS: Record<string, SessionKey> = { ' ': 'space', Enter: 'enter', Escape: 'escape' }

function ownsKey(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('button, a, input, textarea, select, [contenteditable="true"]') !== null
  )
}

function typing(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable="true"]') !== null
  )
}

const HOLD_SCREENS = new Set(['card', 'report'])

const REPLAY_SCREENS = new Set(['card', 'type', 'checking', 'result', 'self-grade'])

function passcodePath(mode: StudyMode, categories: string): string {
  const study = new URLSearchParams({ mode })
  if (categories !== '') study.set('categories', categories)
  return `/passcode?${new URLSearchParams({ next: `/study?${study.toString()}` }).toString()}`
}

export function StudySession({ mode, categories }: { mode: StudyMode; categories: string[] }) {
  const router = useRouter()
  const [holder] = useState(() => new SessionHolder())
  const chosen = categories.join(',')

  useEffect(() => {
    const session = createBrowserSession({
      mode,
      categories: chosen === '' ? [] : chosen.split(','),
    })
    holder.attach(session)
    void session.start()
    const onVisible = () => {
      if (document.visibilityState === 'visible') session.visible()
    }

    const onLeave = () => {
      session.save()
    }

    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pagehide', onLeave)
    window.addEventListener('pageshow', onShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pagehide', onLeave)
      window.removeEventListener('pageshow', onShow)
      holder.detach()
      session.dispose()
    }
  }, [holder, mode, chosen])

  const backToIt = useCallback(() => {
    if (holder.getState().screen === 'break' && mode === 'start') {
      holder.session?.dispose()
      primeSpeech()
      router.push('/practice')
      return
    }
    void holder.session?.backToIt()
  }, [holder, mode, router])

  useEffect(() => {
    const holdsSpace = (event: KeyboardEvent) =>
      event.key === ' ' &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      HOLD_SCREENS.has(holder.getState().screen) &&
      !(holder.getState().screen === 'report' && holder.getState().reportTyping) &&
      !typing(event.target)
    const onKey = (event: KeyboardEvent) => {
      if (holdsSpace(event)) {
        event.preventDefault()
        if (!event.repeat) holder.session?.holdStart()
        return
      }

      if (
        event.key.toLowerCase() === 'r' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.repeat &&
        REPLAY_SCREENS.has(holder.getState().screen) &&
        !typing(event.target)
      ) {
        event.preventDefault()
        void holder.session?.replay()
        return
      }
      const key = KEYS[event.key]
      if (!key || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return
      if (key !== 'escape' && ownsKey(event.target)) return
      event.preventDefault()
      const { screen } = holder.getState()
      if (screen === 'done') {
        if (key !== 'escape') router.push('/')
        return
      }
      if (screen === 'break' && key !== 'escape') {
        backToIt()
        return
      }
      holder.session?.key(key)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== ' ') return
      if (holdsSpace(event)) event.preventDefault()
      holder.session?.holdEnd()
    }

    const letGo = () => {
      holder.session?.holdEnd()
    }
    const onHidden = () => {
      if (document.visibilityState === 'hidden') letGo()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', letGo)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', letGo)
      document.removeEventListener('visibilitychange', onHidden)
    }
  }, [holder, router, backToIt])

  const state = useSyncExternalStore(holder.subscribe, holder.getState, holder.getServerState)
  return (
    <div className={styles.root} data-screen={state.screen}>
      <Screen
        state={state}
        holder={holder}
        onBackToIt={backToIt}
        passcodeHref={passcodePath(mode, chosen)}
      />
    </div>
  )
}

function Loading({
  progress,
  onEnd,
}: {
  progress: { current: number; total: number } | null
  onEnd: () => void
}) {
  return (
    <StudyFrame layout="moment" onEnd={onEnd} progress={progress} busy>
      <Text as="h1" variant="headline-xl">
        Getting the next card…
      </Text>
    </StudyFrame>
  )
}

function Screen({
  state,
  holder,
  onBackToIt,
  passcodeHref,
}: {
  state: SessionState
  holder: SessionHolder
  onBackToIt: () => void
  passcodeHref: string
}) {
  const act = holder.session
  const end = () => {
    void act?.end()
  }
  const holdStart = () => {
    act?.holdStart()
  }
  const holdEnd = () => {
    act?.holdEnd()
  }
  const clear = () => {
    act?.clearAnswer()
  }
  const next = () => {
    act?.next()
  }
  const { card, outcome, progress } = state
  switch (state.screen) {
    case 'error':
      return (
        <LoadErrorScreen
          onRetry={() => {
            void act?.retry()
          }}
          passcodeHref={state.signedOut ? passcodeHref : null}
        />
      )
    case 'mic-blocked':
      return (
        <MicBlockedScreen
          onRetry={() => {
            act?.retryMic()
          }}
          onType={() => {
            act?.useTyping()
          }}
        />
      )
    case 'paused':
    case 'break':
      return (
        <BreakScreen
          endsAt={state.screen === 'break' ? state.breakEndsAt : null}
          onBack={onBackToIt}
          onDone={end}
        />
      )
    case 'done':
      return (
        <DoneScreen
          cards={state.summary?.cards ?? 0}
          micPractices={state.home?.micPracticesToday ?? null}
          studyMs={state.summary?.studyMs ?? 0}
          milestone={state.home ? milestoneLine(state.home) : null}
        />
      )
    case 'report':
      return (
        <ReportScreen
          typing={state.reportTyping}
          typed={state.reportDraft}
          recording={state.listening}
          heard={state.heard}
          micIssue={state.micIssue}
          onHoldStart={holdStart}
          onHoldEnd={holdEnd}
          onClear={clear}
          onCancel={() => {
            act?.cancelReport()
          }}
          onSend={() => {
            void act?.sendReport()
          }}
          onType={(text) => {
            act?.typeReport(text)
          }}
          onTypeInstead={() => {
            act?.reportTypeInstead(true)
          }}
          onVoiceInstead={() => {
            act?.reportTypeInstead(false)
          }}
        />
      )
    case 'report-sent':
      return <ReportSentScreen onNext={next} />
    default:
      break
  }
  if (!card) return <Loading progress={progress} onEnd={end} />
  const choose = (index: number) => {
    act?.choose(index)
  }
  switch (state.screen) {
    case 'card':
    case 'checking':
    case 'type':
      return (
        <CardScreen
          key={card.itemId}
          card={card}
          progress={progress}
          phase={
            state.screen === 'checking'
              ? 'checking'
              : state.listening
                ? 'recording'
                : state.speaking
                  ? 'reading'
                  : 'idle'
          }
          typing={state.screen === 'type'}
          heard={state.heard}
          answer={state.answer}
          micIssue={state.micIssue}
          onHoldStart={holdStart}
          onHoldEnd={holdEnd}
          onClear={clear}
          onSubmit={() => {
            act?.submitAnswer()
          }}
          onEnd={end}
          onTypeInstead={() => {
            act?.typeInstead()
          }}
          onShowAnswer={() => {
            holder.keepDraft(card.itemId, '')
            holder.answerShown.arm()
            act?.showAnswer()
          }}
          onChoose={choose}
          draft={holder.draftFor(card.itemId)}
          onDraft={(text) => {
            holder.keepDraft(card.itemId, text)
          }}
          onCheck={(answer) => {
            holder.keepDraft(card.itemId, '')
            act?.submitTyped(answer)
          }}
          onVoiceInstead={() => {
            act?.voiceInstead()
          }}
          onReplay={() => {
            void act?.replay()
          }}
        />
      )
    case 'self-grade':
      return (
        <SelfGradeScreen
          card={card}
          progress={progress}
          answer={state.answer}
          entry={state.answerEntry}
          onEnd={end}
          onRate={(word) => {
            act?.selfRate(word)
          }}
          onReplay={() => {
            void act?.replay()
          }}
        />
      )
    default:
      break
  }
  if (!outcome) return <Loading progress={progress} onEnd={end} />
  switch (state.screen) {
    case 'rating':
      return (
        <RatingScreen
          word={outcome.word}
          onChoose={(word) => {
            act?.chooseWord(word)
          }}
          onCancel={() => {
            act?.cancelRating()
          }}
        />
      )
    case 'source':
      return (
        <SourceScreen
          card={card}
          onClose={() => {
            act?.closeSource()
          }}
        />
      )
    case 'result':
      return (
        <ResultScreen
          card={card}
          outcome={outcome}
          answer={state.answer}
          entry={state.answerEntry}
          progress={progress}
          onReplay={() => {
            void act?.replay()
          }}
          redo={state.redo}
          onEnd={end}
          onChange={() => {
            act?.openRating()
          }}
          onSource={() => {
            act?.openSource()
          }}
          onReport={() => {
            act?.report()
          }}
          onRedo={() => {
            if (holder.answerShown.counts()) void act?.redo()
          }}
          onNext={() => {
            if (holder.answerShown.counts()) next()
          }}
        />
      )
    default:
      return <Loading progress={progress} onEnd={end} />
  }
}
