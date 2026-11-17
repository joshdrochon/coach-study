'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/Button'
import { CancelButton } from '@/components/CancelButton'
import { Card } from '@/components/Card'
import { Screen } from '@/components/Screen'
import { Text } from '@/components/Text'
import { TextArea } from '@/components/TextArea'
import { browserClock, browserSpeech } from '@/components/study/speech'
import { fetchScene, sendPractice, typedRequest, voiceRequest } from '@/lib/practice/client'
import type { PracticeReport, PracticeRequest, SceneView } from '@/lib/practice/contract'
import type { Word } from '@/lib/practice/match'
import { recognitionConstructor } from '@/lib/speech/browser'
import type { SpeechPort } from '@/lib/study/session'

import { FeedbackView } from './FeedbackView'
import styles from './MicPractice.module.css'

type Phase =
  | { name: 'loading' }
  | { name: 'ready'; scene: SceneView }
  | { name: 'coaching'; scene: SceneView; move: number }
  | { name: 'typing'; scene: SceneView }
  | { name: 'sending'; scene: SceneView }
  | { name: 'report'; scene: SceneView; report: PracticeReport }
  | { name: 'failed'; scene: SceneView | null; message: string }

// One practice: pick a scene, coach its moves out loud (tapping on to each move), then send the
// words and taps for grading. Without speech recognition the moves are typed instead.
export function MicPractice() {
  const [phase, setPhase] = useState<Phase>({ name: 'loading' })
  const [heard, setHeard] = useState('')
  const [typed, setTyped] = useState<string[]>([])
  const speech = useRef<SpeechPort | null>(null)
  const words = useRef<Word[]>([])
  const marks = useRef<number[]>([])
  const startedAt = useRef(0)

  // Fetches the next scene; the effect below runs it once, `load` again after a failure.
  const fetchInto = useCallback(() => {
    fetchScene()
      .then((scene) => {
        setPhase({ name: 'ready', scene })
      })
      .catch(() => {
        setPhase({ name: 'failed', scene: null, message: 'The practice could not load.' })
      })
  }, [])

  const load = useCallback(() => {
    setPhase({ name: 'loading' })
    fetchInto()
  }, [fetchInto])

  useEffect(() => {
    fetchInto()
    return () => {
      speech.current?.stop()
    }
  }, [fetchInto])

  const send = useCallback((scene: SceneView, request: PracticeRequest) => {
    setPhase({ name: 'sending', scene })
    sendPractice(request)
      .then((report) => {
        setPhase({ name: 'report', scene, report })
      })
      .catch(() => {
        setPhase({ name: 'failed', scene, message: 'The practice could not be graded.' })
      })
  }, [])

  const start = (scene: SceneView) => {
    if (!recognitionConstructor()) {
      setTyped(scene.moves.map(() => ''))
      setPhase({ name: 'typing', scene })
      return
    }
    words.current = []
    marks.current = [0]
    setHeard('')
    const port = browserSpeech(() => undefined)
    speech.current = port
    setPhase({ name: 'coaching', scene, move: 0 })
    void port.listen({
      endOn: 'tap',
      onStart: (at) => {
        startedAt.current = at
      },
      onHeard: (result) => {
        words.current = result.words.map((word) => ({ text: word.text, atMs: word.atMs }))
        setHeard(result.transcript)
      },
    })
  }

  const elapsed = () => Math.max(0, browserClock.now() - startedAt.current)

  const next = (scene: SceneView, move: number) => {
    marks.current = [...marks.current, elapsed()]
    setPhase({ name: 'coaching', scene, move: move + 1 })
  }

  const done = (scene: SceneView) => {
    const at = elapsed()
    speech.current?.stop()
    send(scene, voiceRequest(scene, words.current, marks.current, at))
  }

  const cancel = <CancelButton href="/" />

  switch (phase.name) {
    case 'loading':
    case 'sending':
      return (
        <Screen layout="moment" headerEnd={cancel}>
          <Text as="p" variant="title" tone="text-2">
            {phase.name === 'loading' ? 'Getting your practice…' : 'Checking your practice…'}
          </Text>
        </Screen>
      )
    case 'failed':
      return (
        <Screen layout="moment" headerEnd={cancel}>
          <Text as="h1" variant="headline-m">
            {phase.message}
          </Text>
          <Button variant="primary" onClick={load}>
            Try again
          </Button>
        </Screen>
      )
    case 'report':
      return <FeedbackView report={phase.report} onAgain={load} />
    case 'ready':
      return (
        <Screen layout="sheet" headerEnd={cancel}>
          <Text as="h1" variant="headline-l">
            {phase.scene.title}
          </Text>
          <MoveList scene={phase.scene} current={null} />
          <Card label="What counts">
            <ul className={styles.list}>
              {phase.scene.checks.map((check) => (
                <li key={check.gateId}>
                  <Text variant="body" tone={check.mustPass ? 'text' : 'text-2'}>
                    {check.label}
                    {check.mustPass ? ' (must do)' : ''}
                  </Text>
                </li>
              ))}
            </ul>
          </Card>
          <Button
            variant="hero"
            onClick={() => {
              start(phase.scene)
            }}
          >
            Start coaching
          </Button>
        </Screen>
      )
    case 'coaching': {
      const last = phase.move >= phase.scene.moves.length - 1
      return (
        <Screen layout="workspace" headerEnd={cancel}>
          <Text as="h1" variant="headline-m">
            {phase.scene.moves[phase.move]?.name ?? ''}
          </Text>
          <MoveList scene={phase.scene} current={phase.move} />
          <Card label="What you said">
            <Text as="p" variant="transcript" tone="text-2" aria-live="polite">
              {heard === '' ? 'Listening…' : heard}
            </Text>
          </Card>
          {last ? (
            <Button
              variant="primary"
              onClick={() => {
                done(phase.scene)
              }}
            >
              Done
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => {
                next(phase.scene, phase.move)
              }}
            >
              Next move
            </Button>
          )}
        </Screen>
      )
    }
    case 'typing':
      return (
        <Screen layout="sheet" headerEnd={cancel}>
          <Text as="h1" variant="headline-m">
            Type what you would say
          </Text>
          {phase.scene.moves.map((move, i) => (
            <TextArea
              key={move.id}
              id={`move-${move.id}`}
              label={move.name}
              rows={3}
              value={typed[i] ?? ''}
              onChange={(event) => {
                const value = event.target.value
                setTyped((all) => all.map((text, k) => (k === i ? value : text)))
              }}
            />
          ))}
          <Button
            variant="primary"
            disabled={typed.every((text) => text.trim() === '')}
            onClick={() => {
              send(phase.scene, typedRequest(phase.scene, typed))
            }}
          >
            Check it
          </Button>
        </Screen>
      )
  }
}

function MoveList({ scene, current }: { scene: SceneView; current: number | null }) {
  return (
    <ol className={styles.moves}>
      {scene.moves.map((move, i) => (
        <li key={move.id} aria-current={i === current ? 'step' : undefined}>
          <Text
            variant={i === current ? 'body-l-strong' : 'body-l'}
            tone={i === current ? 'accent-text' : 'text-2'}
          >
            {move.name}
          </Text>
        </li>
      ))}
    </ol>
  )
}
