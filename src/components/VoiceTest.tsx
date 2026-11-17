'use client'

import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from 'react'
import { z } from 'zod'

import {
  decide,
  errorRate,
  scoreSentence,
  type Path,
  type VoiceTestSentence,
} from '@/lib/speech/keyterms'
import {
  appMode,
  appVoice,
  holdWakeLock,
  primeVoice,
  recognitionConstructor,
  transcriptOf,
  type AppMode,
} from '@/lib/speech/browser'
import { voiceTestDecisionSchema, type VoiceTestDecision } from '@/lib/speech/voice-test-decision'
import type { RunSubmission } from '@/lib/speech/voice-test-run'
import { curly } from '@/lib/text/curly'

import { Button } from './Button'
import { Card } from './Card'
import { IconButton } from './IconButton'
import { CloseIcon, MicIcon } from './icons'
import { Screen } from './Screen'
import { Text } from './Text'
import { AnswerMic } from './study/AnswerMic'
import { Picker, PickerOption } from './study/PickerOption'
import { TranscriptBox } from './study/TranscriptBox'
import styles from './VoiceTest.module.css'

const MAX_RECORD_MS = 120_000

type SentenceRecord = RunSubmission['sentences'][number]

type Status = 'speaking' | 'idle' | 'recording'

type Phase =
  | { name: 'intro' }
  | { name: 'running'; index: number; status: Status }
  | { name: 'blocked' }
  | { name: 'unsupported' }
  | { name: 'results' }

type Saved =
  { state: 'saving' } | { state: 'saved'; decision: VoiceTestDecision | null } | { state: 'failed' }

const savedSchema = z.object({ decision: voiceTestDecisionSchema })

type Live = {
  active: boolean

  holding: boolean
  index: number
  earlier: string
  current: string

  firstHoldAt: number | null
  holdAt: number | null
  heldMs: number
  firstResult: number | null
  autoStops: number

  listenStart: number | null
  holds: number[]
  spokeOk: boolean
  readAloud: boolean
  music: boolean | null
  running: boolean
  onStopped: (() => void)[]
  finish: () => void
}

const noSubscription = () => () => undefined

const RUN_TEXT: Record<Path, string> = {
  keep: 'Safari heard the coaching words well enough here.',
  'keep-with-fix-step': 'Safari missed some coaching words here.',
  switch: 'Safari missed too many coaching words here.',
}

const FIX_STEP = 'The app adds a one-tap fix before checking an answer.'

export const VOICE_TEST_INTRO_SAID = 'Voice test. Hold the mic and read each sentence out loud.'

export function heardLine(silent: number): string {
  if (silent === 0) return 'The mic heard every sentence.'
  return `The mic heard nothing on ${String(silent)} ${silent === 1 ? 'sentence' : 'sentences'}.`
}

function savedText(
  decision: VoiceTestDecision | null,
  completed: boolean,
  total: number,
  other: string,
): string {
  if (!completed) return `Saved. A run counts once you read all ${String(total)} sentences.`
  if (!decision?.decided) return `Saved. Next, run it once in ${other}.`
  const fix = decision.path === 'keep-with-fix-step' ? ` ${FIX_STEP}` : ''
  if (decision.use === 'home-screen') {
    return `Saved. Both runs are in: use Coach Study from your Home Screen.${fix}`
  }
  if (decision.use === 'safari-tab') {
    return `Saved. Both runs are in: use Coach Study in a Safari tab. Everything works there except the two daily reminders.${fix}`
  }
  return 'Saved. Both runs are in. As decided in advance, the app moves to a paid speech service.'
}

function typing(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable="true"]') !== null
  )
}

export function VoiceTest({ sentences }: { sentences: VoiceTestSentence[] }) {
  const [phase, setPhase] = useState<Phase>({ name: 'intro' })

  const mode = useSyncExternalStore<AppMode>(noSubscription, appMode, () => 'safari-tab')
  const [heardText, setHeardText] = useState('')
  const [records, setRecords] = useState<SentenceRecord[]>([])
  const [readAloudWorked, setReadAloudWorked] = useState(false)

  const [music, setMusic] = useState<boolean | null>(null)
  const [completedRun, setCompletedRun] = useState(false)
  const [saved, setSaved] = useState<Saved>({ state: 'saving' })

  const recognition = useRef<SpeechRecognition | null>(null)
  const releaseWake = useRef<() => void>(() => undefined)

  const cue = useRef(0)
  const live = useRef<Live>({
    active: false,
    holding: false,
    index: 0,
    earlier: '',
    current: '',
    firstHoldAt: null,
    holdAt: null,
    heldMs: 0,
    firstResult: null,
    autoStops: 0,
    listenStart: null,
    holds: [],
    spokeOk: false,
    readAloud: false,
    music: null,
    running: false,
    onStopped: [],
    finish: () => undefined,
  })

  useEffect(() => {
    const state = live.current
    return () => {
      state.active = false
      state.holding = false
      recognition.current?.abort()
      releaseWake.current()
    }
  }, [])

  function stopped(): Promise<void> {
    if (!live.current.running) return Promise.resolve()
    return new Promise((resolve) => {
      live.current.onStopped.push(resolve)
      window.setTimeout(resolve, 1500)
    })
  }

  function recordsSoFar(): SentenceRecord[] {
    return records
  }

  function heldSoFar(state: Live): number {
    return state.heldMs + (state.holdAt === null ? 0 : performance.now() - state.holdAt)
  }

  async function runSentence(index: number, all: SentenceRecord[]) {
    const sentence = sentences[index]
    const rec = recognition.current
    if (!sentence || !rec) {
      finishTest(all, true)
      return
    }
    const state = live.current
    Object.assign(state, {
      index,
      earlier: '',
      current: '',
      firstHoldAt: null,
      holdAt: null,
      heldMs: 0,
      firstResult: null,
      autoStops: 0,
      holds: [],
      active: false,
      holding: false,
    })
    setHeardText('')
    setPhase({ name: 'running', index, status: 'speaking' })

    let done = false
    state.finish = () => {
      if (done) return
      done = true
      cue.current += 1
      if (state.holdAt !== null) state.heldMs += performance.now() - state.holdAt
      state.holdAt = null
      state.holding = false
      state.active = false
      rec.stop()
      const transcript = `${state.earlier} ${state.current}`.trim()
      const record: SentenceRecord = {
        id: sentence.id,
        transcript,
        stalled: transcript === '' && state.firstResult === null,
        autoStops: state.autoStops,
        spokeOk: state.spokeOk,
        firstResultMs:
          state.firstResult === null || state.firstHoldAt === null
            ? null
            : Math.min(MAX_RECORD_MS, Math.round(state.firstResult - state.firstHoldAt)),
        listenMs: Math.min(MAX_RECORD_MS, Math.round(state.heldMs)),
        holdsMs: [...state.holds],
      }
      const next = [...all, record]
      setRecords(next)
      if (index + 1 < sentences.length) void runSentence(index + 1, next)
      else finishTest(next, true)
    }

    await stopped()
    const id = ++cue.current
    const said = await appVoice().speak(`Sentence ${String(index + 1)}.`)
    state.spokeOk = said.ok

    if (id === cue.current && !state.holding && state.index === index) {
      setPhase({ name: 'running', index, status: 'idle' })
    }
  }

  function holdStart() {
    const state = live.current
    const rec = recognition.current
    if (phase.name !== 'running' || state.holding || !rec) return
    if (heldSoFar(state) >= MAX_RECORD_MS) return
    state.holding = true
    cue.current += 1
    appVoice().cancel()
    const now = performance.now()
    state.firstHoldAt ??= now
    state.holdAt = now
    state.active = true

    setPhase({ name: 'running', index: state.index, status: 'idle' })

    if (state.running) return
    try {
      rec.start()
    } catch {}
  }

  function holdEnd() {
    const state = live.current
    if (!state.holding) return
    state.holding = false
    if (state.holdAt !== null) state.heldMs += performance.now() - state.holdAt
    state.holdAt = null
    setPhase((now) =>
      now.name === 'running' && now.status === 'recording' ? { ...now, status: 'idle' } : now,
    )

    state.listenStart = null
    recognition.current?.stop()
  }

  function finishTest(all: SentenceRecord[], completed: boolean) {
    live.current.active = false
    live.current.holding = false
    cue.current += 1
    recognition.current?.abort()
    releaseWake.current()
    setRecords(all)
    setCompletedRun(completed)
    setPhase({ name: 'results' })
    void save(all, completed)
  }

  async function save(all: SentenceRecord[], completed: boolean) {
    if (all.length === 0) {
      setSaved({ state: 'failed' })
      return
    }
    setSaved({ state: 'saving' })
    const body: RunSubmission = {
      mode: appMode(),
      completed,
      readAloudWorked: live.current.readAloud,
      musicPlaying: live.current.music,
      sentences: all,
    }
    try {
      const response = await fetch('/api/voice-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        setSaved({ state: 'failed' })
        return
      }
      const answer = savedSchema.safeParse(await response.json().catch(() => null))
      setSaved({ state: 'saved', decision: answer.success ? answer.data.decision : null })
    } catch {
      setSaved({ state: 'failed' })
    }
  }

  function wire(rec: SpeechRecognition) {
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    rec.maxAlternatives = 1
    rec.onstart = () => {
      const state = live.current
      state.running = true
      state.listenStart = performance.now()
      if (state.holding) {
        setPhase((now) =>
          now.name === 'running' && now.index === state.index
            ? { ...now, status: 'recording' }
            : now,
        )
      }
    }
    rec.onresult = (event) => {
      const state = live.current
      if (!state.active) return
      state.firstResult ??= performance.now()
      const { final, interim } = transcriptOf(event)
      state.current = `${final} ${interim}`.trim()
      setHeardText(`${state.earlier} ${state.current}`.trim())
    }
    rec.onend = () => {
      const state = live.current
      state.running = false
      const startedAt = state.listenStart
      state.listenStart = null
      for (const resolve of state.onStopped.splice(0)) resolve()

      state.earlier = `${state.earlier} ${state.current}`.trim()
      state.current = ''
      if (!state.holding) {
        state.active = false
        return
      }

      if (startedAt !== null) {
        state.holds.push(Math.round(performance.now() - startedAt))
        state.autoStops += 1
      }
      try {
        rec.start()
      } catch {}
    }
    rec.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        live.current.active = false
        live.current.holding = false
        releaseWake.current()
        setPhase({ name: 'blocked' })
      }
    }
  }

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (phase.name !== 'running' || event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key === ' ' && !typing(event.target)) {
      event.preventDefault()
      if (!event.repeat) holdStart()
      return
    }
    if (event.key === 'Enter' && !event.repeat && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault()
      live.current.finish()
    }
  })

  const letGo = useEffectEvent((event?: KeyboardEvent) => {
    if (event && phase.name === 'running' && !typing(event.target)) event.preventDefault()
    holdEnd()
  })
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      onKeyDown(event)
    }
    const up = (event: KeyboardEvent) => {
      if (event.key === ' ') letGo(event)
    }
    const away = () => {
      letGo()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', away)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', away)
    }
  }, [])

  function start() {
    const Recognition = recognitionConstructor()
    if (!Recognition) {
      setPhase({ name: 'unsupported' })
      return
    }
    const rec = new Recognition()
    wire(rec)
    recognition.current = rec
    live.current.music = music
    setRecords([])

    primeVoice()
    const intro = appVoice().speak(VOICE_TEST_INTRO_SAID)
    void holdWakeLock().then((release) => {
      releaseWake.current = release
    })
    void intro.then((result) => {
      live.current.readAloud = result.ok
      setReadAloudWorked(result.ok)
      void runSentence(0, [])
    })
  }

  if (phase.name === 'blocked') {
    return (
      <Screen layout="moment">
        <Text as="h1" variant="headline-xl">
          The app can’t hear you.
        </Text>
        <Text as="p" variant="subtitle" tone="text-2">
          Turn the microphone on for Coach Study in your iPad’s Settings, then come back.
        </Text>
        <div className={styles.actions}>
          <Button variant="primary" onClick={start} fullWidth>
            Try again
          </Button>
          <Button variant="secondary" href="/" fullWidth>
            Back to Home
          </Button>
        </div>
      </Screen>
    )
  }

  if (phase.name === 'unsupported') {
    return (
      <Screen layout="moment">
        <Text as="h1" variant="headline-xl">
          This browser can’t listen.
        </Text>
        <Text as="p" variant="subtitle" tone="text-2">
          Open Coach Study in Safari on your iPad, then run the voice test there.
        </Text>
        <Button variant="primary" href="/" fullWidth>
          Back to Home
        </Button>
      </Screen>
    )
  }

  if (phase.name === 'running') {
    const sentence = sentences[phase.index]
    const recording = phase.status === 'recording'
    return (
      <Screen
        layout="moment"
        wide
        headerStart={
          <Text variant="label" tone="text-muted">
            Sentence {phase.index + 1} of {sentences.length}
          </Text>
        }
        headerEnd={
          <IconButton
            label="End the test"
            onClick={() => {
              finishTest(recordsSoFar(), false)
            }}
          >
            <CloseIcon />
          </IconButton>
        }
        footer={
          <Button
            variant="primary"
            onClick={() => {
              live.current.finish()
            }}
          >
            Next
          </Button>
        }
      >
        <Text as="h1" variant="headline-m">
          Read it out loud.
        </Text>
        <Card kind="hero" as="div">
          {}
          <Text as="p" variant="title-l">
            {sentence ? curly(sentence.text) : null}
          </Text>
        </Card>
        <div className={styles.status} aria-live="polite">
          <span className={recording ? styles.listening : styles.waiting}>
            <MicIcon />
          </span>
          <Text variant="title" tone={recording ? 'accent-text' : 'text-muted'}>
            {recording
              ? 'Listening…'
              : phase.status === 'speaking'
                ? 'Get ready…'
                : 'Hold Space or the mic to read it.'}
          </Text>
        </div>
        <TranscriptBox
          label="You’re saying"
          text={heardText}
          mic={<AnswerMic recording={recording} onHoldStart={holdStart} onHoldEnd={holdEnd} />}
        />
      </Screen>
    )
  }

  if (phase.name === 'results') {
    const scores = records.flatMap((record) => {
      const sentence = sentences.find((s) => s.id === record.id)
      return sentence ? [scoreSentence(sentence, record.transcript)] : []
    })
    const totals = errorRate(scores)
    const path = decide(totals.rate)
    const silent = records.filter((r) => r.stalled).length
    const missedTerms = [...new Set(scores.flatMap((s) => s.missed))]
    const other = mode === 'safari-tab' ? 'the Home Screen app' : 'a Safari tab'
    return (
      <Screen layout="moment" wide>
        <Text as="h1" variant="headline-xl">
          Voice test done.
        </Text>
        <div className={styles.result}>
          <Text as="p" variant="figure">
            {totals.missed} of {totals.total}
          </Text>
          <Text as="p" variant="caption-strong" tone="text-muted">
            coaching words missed ({Math.round(totals.rate * 100)}%) in{' '}
            {mode === 'safari-tab' ? 'a Safari tab' : 'the Home Screen app'}
          </Text>
        </div>
        <Text as="p" variant="body-l">
          {RUN_TEXT[path]}
        </Text>
        <Text as="p" variant="body" tone="text-2">
          {readAloudWorked ? 'Read-aloud worked.' : 'Read-aloud didn’t play.'} {heardLine(silent)}{' '}
          {records.length < sentences.length
            ? `You read ${String(records.length)} of ${String(sentences.length)} sentences.`
            : ''}
        </Text>
        {missedTerms.length > 0 ? (
          <Text as="p" variant="caption" tone="text-muted">
            Missed: {curly(missedTerms.join(', '))}
          </Text>
        ) : null}
        <Text as="p" variant="body" tone={saved.state === 'failed' ? 'warn-text' : 'text-muted'}>
          {saved.state === 'saving'
            ? 'Saving…'
            : saved.state === 'saved'
              ? savedText(saved.decision, completedRun, sentences.length, other)
              : 'Couldn’t save. Check your Wi-Fi, then run it again.'}
        </Text>
        <div className={styles.actions}>
          <Button variant="primary" onClick={start} fullWidth>
            Run it again
          </Button>
          <Button variant="secondary" href="/" fullWidth>
            Back to Home
          </Button>
        </div>
      </Screen>
    )
  }

  return (
    <Screen
      layout="moment"
      headerEnd={
        <IconButton label="Back to Home" href="/">
          <CloseIcon />
        </IconButton>
      }
    >
      <Text as="h1" variant="headline-xl">
        Voice test.
      </Text>
      <Text as="p" variant="subtitle" tone="text-2">
        Read {sentences.length} sentences from the manual out loud, holding the mic for each one.
        The app checks which coaching words it hears right.
      </Text>
      <Text as="p" variant="body-l" tone="text-2">
        Do it where you’ll practice, with music on if you practice with music. Run it once in a
        Safari tab and once from your Home Screen.
      </Text>
      <Text as="p" variant="body" tone="text-muted">
        {mode === 'safari-tab' ? 'You’re in a Safari tab.' : 'You’re in the Home Screen app.'}
      </Text>
      <Text as="h2" variant="title" id="music-question">
        Is music playing?
      </Text>
      <Picker labelledBy="music-question">
        <PickerOption
          selected={music === true}
          onClick={() => {
            setMusic(true)
          }}
        >
          Yes
        </PickerOption>
        <PickerOption
          selected={music === false}
          onClick={() => {
            setMusic(false)
          }}
        >
          No
        </PickerOption>
      </Picker>
      {}
      <Button variant="primary" onClick={start} fullWidth>
        Start
      </Button>
    </Screen>
  )
}
