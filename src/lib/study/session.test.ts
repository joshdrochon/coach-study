import { describe, expect, it } from 'vitest'

import type { SoundId } from '../sound/catalog'
import type { Clock, Command, ListenOptions, ListenResult, TimedWord } from '../speech/controller'

import {
  StudyClientError,
  type CardView,
  type FlagAnswer,
  type GradeOutcome,
  type GradeRequest,
  type HomeView,
  type NextRequest,
  type ReviewEvent,
  type StudyClient,
  type Today,
} from './client'
import {
  BREAK_MS,
  chosenBySpeech,
  defaultRatingPolicy,
  formatOf,
  hintFor,
  IDLE_MS,
  promptLine,
  STUDY_STRETCH_MS,
  StudySession,
  type RatingPolicy,
  type SpeechPort,
} from './session'

const SAMPLE_MOVE_A: CardView = {
  itemId: 'term-range',
  category: 'Floor work',
  type: 'recall',
  prompt: 'Sample Move A: what does it need?',
  answer: 'A mat, a strap and the rollers.',
  explanation: 'Sample Move A needs a mat, a strap and the rollers to start.',
  citation: {
    label: 'Sample guide',
    quote: 'A mat, a strap and the Rollers.',
  },
}

const RSG: CardView = {
  itemId: 'voice-rsg-parts',
  category: 'Coaching voice',
  type: 'list',
  prompt: 'The 3 parts of RSG, in order.',
  parts: ['Ready', 'Steady', 'Go'],
  ordered: true,
  answer: 'Ready, steady, go.',
  explanation: 'A starting call: count off, then begin together.',
  citation: { label: 'Sample guide', quote: 'Ready, steady, go' },
}

const SAMPLE_MOVE_A_CHOICES = [
  'a mat, a strap and the rollers.',
  'a mat and a ball.',
  'a mat on its own.',
]
const SAMPLE_MOVE_A_PICK: CardView = {
  ...SAMPLE_MOVE_A,
  choices: SAMPLE_MOVE_A_CHOICES,
  format: 'choices',
}

const HOME: HomeView = {
  daysToPracticeDay: 1,
  daysToFirstClass: 18,
  dueToday: 49,
  weakestMustDo: 'Pace cue',
  title: 'Starter',
  name: 'Coach Alex',
  avatarUrl: '/api/profile/avatar',
}

const RIGHT = {
  ok: true,
  grade: {
    corrections: [],
    result: 'right',
    missing: [],
    inOrder: null,
    spoken: 'Got it.',
    followUp: null,
    source: 'tutor',
    traceId: 'trace-1',
  },
} satisfies GradeOutcome

class FakeClock implements Clock {
  t = Date.parse('2026-08-18T15:00:00.000Z')
  private timers = new Map<number, { at: number; run: () => void }>()
  private nextId = 1
  now = (): number => this.t
  setTimeout = (run: () => void, ms: number): number => {
    const id = this.nextId++
    this.timers.set(id, { at: this.t + ms, run })
    return id
  }
  clearTimeout = (id: number): void => {
    this.timers.delete(id)
  }
  advance(ms: number): void {
    this.t += ms
    for (const [id, timer] of [...this.timers]) {
      if (timer.at <= this.t) {
        this.timers.delete(id)
        timer.run()
      }
    }
  }
}

type PendingListen = { options: ListenOptions; resolve: (result: ListenResult) => void }

class FakeSpeech implements SpeechPort {
  spoken: string[] = []
  listens: ListenOptions[] = []
  stops = 0
  releases = 0
  partial = ''
  session: StudySession | null = null
  clock: FakeClock | null = null

  cues: string[] = []
  said: string[] = []

  holdCues = false
  private heldCue: (() => void) | null = null
  private pending: PendingListen | null = null

  get listening(): boolean {
    return this.pending !== null
  }

  get lastListen(): ListenOptions | undefined {
    return this.listens.at(-1)
  }

  speakGate: Promise<void> | null = null

  speak(text: string): Promise<{ ok: boolean; ms: number }> {
    if (this.pending) throw new Error(`spoke while listening: ${text}`)
    const held = this.heldCue
    if (held && this.speakWaitsForSound) {
      return new Promise((resolve) => {
        this.heldCue = () => {
          held()
          resolve(this.speak(text))
        }
      })
    }
    if (held) throw new Error(`spoke over a sound: ${text}`)
    this.spoken.push(text)
    this.said.push(text)
    const gate = this.speakGate
    return gate ? gate.then(() => ({ ok: true, ms: 5 })) : Promise.resolve({ ok: true, ms: 5 })
  }

  speakWaitsForSound = false

  cue(id: SoundId): Promise<void> {
    if (this.pending) throw new Error(`a sound while listening: ${id}`)
    this.cues.push(id)
    this.said.push(`cue:${id}`)
    if (!this.holdCues) return Promise.resolve()
    return new Promise((resolve) => {
      this.heldCue = resolve
    })
  }

  endCue(): void {
    const held = this.heldCue
    this.heldCue = null
    held?.()
  }

  holdIdle = false
  idles = 0
  private heldIdle: (() => void) | null = null
  idle(): Promise<void> {
    this.idles += 1
    if (!this.holdIdle) return Promise.resolve()
    return new Promise((resolve) => {
      this.heldIdle = resolve
    })
  }

  releaseIdle(): void {
    const held = this.heldIdle
    this.heldIdle = null
    held?.()
  }

  listen(options: ListenOptions): Promise<ListenResult> {
    if (this.pending) throw new Error('listen while already listening')
    this.listens.push(options)
    this.partial = ''
    this.winding = false
    return new Promise((resolve) => {
      this.pending = { options, resolve }

      options.onStart?.(0)
    })
  }

  stop(): void {
    this.stops += 1

    this.endCue()
    if (this.pending) this.end('stopped', this.partial)
  }

  keeps = 0
  stopKeepingSound(): void {
    this.keeps += 1
    if (this.pending) this.end('stopped', this.partial)
  }

  get soundPlaying(): boolean {
    return this.heldCue !== null
  }

  releaseEndsAtOnce = true

  winding = false
  resumes = 0

  release(): void {
    this.releases += 1
    if (this.pending?.options.endOn !== 'release') return
    if (this.releaseEndsAtOnce) this.end('stopped', this.partial)
    else this.winding = true
  }

  resume(): boolean {
    if (!this.winding || this.pending?.options.endOn !== 'release') return false
    this.winding = false
    this.resumes += 1
    return true
  }

  handOver(transcript: string): void {
    this.partial = transcript
    this.session?.heard(transcript)
    this.end('stopped', transcript)
  }

  hold(transcript: string, ms = 0): void {
    const session = this.session
    if (!session) throw new Error('no session attached')
    session.holdStart()
    this.clock?.advance(ms)
    this.partial = transcript
    session.heard(transcript)
    session.holdEnd()
  }

  private answering(): boolean {
    const screen = this.session?.getState().screen
    return this.pending === null && (screen === 'card' || screen === 'report')
  }

  say(transcript: string, lastWordAtMs = 6000): void {
    if (this.answering()) {
      this.hold(transcript, lastWordAtMs)
      if (this.session?.getState().screen === 'card') this.session.submitAnswer()
      return
    }
    const timed: TimedWord[] = transcript
      .split(/\s+/)
      .filter(Boolean)
      .map((text, i, all) => ({ text, atMs: Math.round(((i + 1) / all.length) * lastWordAtMs) }))
    this.end('silence', transcript, timed)
  }

  command(command: Command): void {
    if (this.answering()) {
      this.hold(command)
      return
    }
    this.end('command', command, [], command)
  }

  nothing(): void {
    this.end('max', '')
  }

  cutOff(transcript: string): void {
    this.end('max', transcript)
  }

  fail(error: string): void {
    this.end('error', '', [], undefined, error)
  }

  private end(
    endedBy: ListenResult['endedBy'],
    transcript: string,
    timed: TimedWord[] = [],
    command?: Command,
    error?: string,
  ): void {
    const pending = this.pending
    if (!pending) throw new Error(`nothing is listening (${endedBy})`)
    this.pending = null
    pending.resolve({
      transcript,
      words: timed,
      endedBy,
      command,
      stalled: transcript === '',
      firstResultMs: transcript === '' ? null : 300,
      durationMs: 9000,
      autoRestarts: 0,
      error,
    })
  }
}

class FakeClient implements StudyClient {
  queue: CardView[]
  today: Today
  nextRequests: NextRequest[] = []
  gradeRequests: GradeRequest[] = []
  reviews: ReviewEvent[] = []
  flags: { itemId: string; note: string; answer?: FlagAnswer }[] = []
  grader: (request: GradeRequest) => GradeOutcome = () => RIGHT
  nextFails = 0

  nextError: Error = new Error('offline')

  constructor(cards: CardView[]) {
    this.queue = [...cards]
    this.today = { done: 11, due: 30, newLeft: 8 }
  }

  next(request: NextRequest) {
    this.nextRequests.push(request)
    if (this.nextFails > 0) {
      this.nextFails -= 1
      return Promise.reject(this.nextError)
    }
    const card = this.queue.shift() ?? null
    const today = { ...this.today }
    return Promise.resolve({ card, today })
  }

  holdGrades = false
  private heldGrades: (() => void)[] = []
  releaseGrades(): void {
    const held = this.heldGrades
    this.heldGrades = []
    for (const release of held) release()
  }

  grade(request: GradeRequest) {
    this.gradeRequests.push(request)
    if (this.holdGrades) {
      return new Promise<GradeOutcome>((resolve) => {
        this.heldGrades.push(() => {
          resolve(this.grader(request))
        })
      })
    }
    return Promise.resolve(this.grader(request))
  }

  review(event: ReviewEvent) {
    this.reviews.push(event)

    this.today = { ...this.today, done: this.today.done + 1, due: Math.max(0, this.today.due - 1) }
    return Promise.resolve()
  }

  flag(itemId: string, note: string, answer?: FlagAnswer) {
    this.flags.push(answer ? { itemId, note, answer } : { itemId, note })
    return Promise.resolve()
  }

  home() {
    return Promise.resolve(HOME)
  }

  cachedHome() {
    return null
  }

  flush() {
    return Promise.resolve()
  }

  pendingCount() {
    return 0
  }

  sendTrouble() {
    return false
  }

  onSendChange() {
    return () => undefined
  }

  ready() {
    return Promise.resolve()
  }

  serverEpoch() {
    return Promise.resolve()
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 40; i++) await Promise.resolve()
}

function make(cards: CardView[] = [SAMPLE_MOVE_A, RSG], ratingPolicy?: RatingPolicy) {
  const clock = new FakeClock()
  const speech = new FakeSpeech()
  const client = new FakeClient(cards)
  const lock = { held: 0, requests: 0 }
  let ids = 0
  const session = new StudySession(
    {
      client,
      speech,
      clock,
      ratingPolicy,
      newId: () => `event-${String(++ids)}`,
      wakeLock: () => {
        lock.requests += 1
        lock.held += 1
        let released = false
        return Promise.resolve(() => {
          if (released) return
          released = true
          lock.held -= 1
        })
      },
    },
    { mode: 'start', categories: [] },
  )
  speech.session = session
  speech.clock = clock
  const state = () => session.getState()
  return { session, speech, client, clock, lock, state }
}

async function started(cards?: CardView[], ratingPolicy?: RatingPolicy) {
  const h = make(cards, ratingPolicy)
  void h.session.start()
  await settle()
  return h
}

describe('defaultRatingPolicy: the scheduler’s rule (src/lib/scheduler/rating.ts)', () => {
  it('wrong is Missed it; right is Got it, Easy when fast, Tough when slow', () => {
    expect(defaultRatingPolicy.propose('wrong', 1000, false, 'recall')).toBe(1)
    expect(defaultRatingPolicy.propose('right', 9000, false, 'recall')).toBe(3)
    expect(defaultRatingPolicy.propose('right', 2000, false, 'recall')).toBe(4)
    expect(defaultRatingPolicy.propose('right', 20_000, false, 'recall')).toBe(2)

    expect(defaultRatingPolicy.propose('right', 7000, false, 'list')).toBe(4)
  })
  it('help (a hint the learner asked for, or choices) caps it: right is Tough, partial is Missed it', () => {
    expect(defaultRatingPolicy.propose('partial', 1000, false, 'recall')).toBe(2)
    expect(defaultRatingPolicy.propose('partial', 1000, true, 'recall')).toBe(1)
    expect(defaultRatingPolicy.propose('right', 2000, true, 'recall')).toBe(2)
    expect(defaultRatingPolicy.propose('right', 2000, false, 'recall', 'choices')).toBe(2)
  })
})

describe('hints come from the card itself', () => {
  it('gives a list card’s part count and its opening part', () => {
    expect(hintFor(RSG)).toBe('3 parts, in order. The first is Ready.')
    expect(hintFor({ ...RSG, parts: ['Ready'], ordered: false })).toBe(
      '1 part. The first is Ready.',
    )
  })
  it('gives the opening word of the answer itself otherwise (past a label, when there is one)', () => {
    expect(hintFor(SAMPLE_MOVE_A)).toBe('It starts with “A mat…”')
    expect(hintFor({ ...SAMPLE_MOVE_A, answer: 'The front rail.' })).toBe(
      'It starts with “The front…”',
    )
  })
  it('on a choices card, rules out a wrong choice instead of giving the right one away', () => {
    expect(hintFor(SAMPLE_MOVE_A_PICK)).toBe('It isn’t “a mat and a ball”.')

    expect(hintFor({ ...SAMPLE_MOVE_A, choices: ['Pegs', 'Hooks'], format: 'choices' })).toBe(
      'It starts with “A mat…”',
    )
  })
})

describe('choices (the easier format)', () => {
  it('reads the question, then each choice by number', () => {
    expect(formatOf(SAMPLE_MOVE_A)).toBe('free')
    expect(formatOf(SAMPLE_MOVE_A_PICK)).toBe('choices')
    expect(promptLine(SAMPLE_MOVE_A)).toBe(SAMPLE_MOVE_A.prompt)
    expect(promptLine({ ...SAMPLE_MOVE_A, choices: ['A mat', 'Pegs'] })).toBe(
      `${SAMPLE_MOVE_A.prompt} One: A mat. Two: Pegs.`,
    )
  })

  it('hears a choice by its number', () => {
    const second = SAMPLE_MOVE_A_CHOICES[1]
    expect(chosenBySpeech(SAMPLE_MOVE_A_PICK, 'two')).toBe(second)
    expect(chosenBySpeech(SAMPLE_MOVE_A_PICK, 'number two')).toBe(second)
    expect(chosenBySpeech(SAMPLE_MOVE_A_PICK, 'the second one')).toBe(second)
    expect(chosenBySpeech(SAMPLE_MOVE_A_PICK, 'one')).toBe(SAMPLE_MOVE_A_CHOICES[0])
    expect(chosenBySpeech(SAMPLE_MOVE_A_PICK, 'third')).toBe(SAMPLE_MOVE_A_CHOICES[2])
    expect(chosenBySpeech(SAMPLE_MOVE_A_PICK, 'four')).toBeUndefined()
    expect(chosenBySpeech(SAMPLE_MOVE_A_PICK, 'a mat and hooks')).toBeUndefined()
    expect(chosenBySpeech(SAMPLE_MOVE_A, 'two')).toBeUndefined()
  })

  it('when the choices are numbers, a spoken number is their answer, not a position', () => {
    const lines: CardView = {
      ...SAMPLE_MOVE_A,
      prompt: 'How many apples are in the bowl?',
      answer: '4 apples.',
      choices: ['2 apples.', '6 apples.', '4 apples.'],
      format: 'choices',
    }
    expect(chosenBySpeech(lines, 'four')).toBeUndefined()
    expect(chosenBySpeech(lines, 'two')).toBeUndefined()

    expect(chosenBySpeech(lines, 'the third one')).toBe('4 apples.')
  })

  it('a pick from choices is help: right is Tough at most', () => {
    expect(defaultRatingPolicy.propose('right', 1000, false, 'recall', 'choices')).toBe(2)
    expect(defaultRatingPolicy.propose('right', 1000, false, 'recall', 'free')).toBe(4)
  })

  it('tells the rule when a hint was the scheduler’s, not theirs', async () => {
    const seen: (boolean | undefined)[] = []
    const policy: RatingPolicy = {
      propose: (_result, _ms, hintUsed, _type, _format, hintImposed) => {
        seen.push(hintUsed, hintImposed)
        return 3
      },
    }
    const imposed = await started([{ ...RSG, hintFirst: true }], policy)
    imposed.speech.say('ready steady go')
    await settle()
    expect(seen).toEqual([true, true])
    const asked = await started([{ ...RSG, hintFirst: true }], policy)
    asked.speech.command('hint')
    await settle()
    asked.speech.say('ready steady go')
    await settle()
    expect(seen.slice(2)).toEqual([true, false])
  })

  it('reads the choices, takes a spoken number, and records the format', async () => {
    const { session, speech, client, state } = await started([SAMPLE_MOVE_A_PICK])
    expect(speech.spoken).toEqual([promptLine(SAMPLE_MOVE_A_PICK)])
    speech.say('number one', 1000)
    await settle()
    expect(client.gradeRequests[0]?.answer).toBe(SAMPLE_MOVE_A_CHOICES[0])

    expect(state().outcome?.rating).toBe(2)
    session.next()
    await settle()
    expect(client.reviews[0]).toMatchObject({
      format: 'choices',
      answerText: SAMPLE_MOVE_A_CHOICES[0],
    })
  })

  it('on a choices card a new hold starts over (there is no Clear there)', async () => {
    const { session, speech, client } = await started([SAMPLE_MOVE_A_PICK])
    speech.hold('number three')
    await settle()
    speech.hold('number one')
    await settle()
    expect(session.getState().heard).toBe('number one')
    session.submitAnswer()
    await settle()
    expect(client.gradeRequests[0]?.answer).toBe(SAMPLE_MOVE_A_CHOICES[0])
  })

  it('takes a tapped choice, and a free card’s review has no format', async () => {
    const { session, speech, client } = await started([SAMPLE_MOVE_A_PICK, SAMPLE_MOVE_A])
    session.choose(5)
    session.choose(1)
    await settle()
    expect(client.gradeRequests[0]?.answer).toBe(SAMPLE_MOVE_A_CHOICES[1])
    session.next()
    await settle()
    speech.say('a mat a strap the rollers')
    await settle()
    session.next()
    await settle()
    expect(client.reviews[1]).not.toHaveProperty('format')
  })

  it('gives the hint before the learner answers when the scheduler asks for it', async () => {
    const { session, speech, client, state } = await started([{ ...RSG, hintFirst: true }])
    expect(speech.spoken).toEqual([RSG.prompt, '3 parts, in order. The first is Ready.'])
    expect(state()).toMatchObject({
      hint: '3 parts, in order. The first is Ready.',
      listening: false,
      speaking: false,
    })
    speech.say('ready steady go', 9000)
    await settle()
    expect(client.gradeRequests[0]?.hintUsed).toBe(true)

    expect(state().outcome?.rating).toBe(3)
    session.next()
    await settle()
    expect(client.reviews[0]).toMatchObject({ hintUsed: true, hintImposed: true })
  })

  it('a hint the learner asks for after the app’s own is theirs: no hintImposed on the review', async () => {
    const { session, speech, client } = await started([{ ...RSG, hintFirst: true }, SAMPLE_MOVE_A])
    speech.command('hint')
    await settle()
    speech.say('ready steady go', 9000)
    await settle()
    session.next()
    await settle()
    expect(client.reviews[0]).toMatchObject({ hintUsed: true })
    expect(client.reviews[0]).not.toHaveProperty('hintImposed')
  })
})

describe('StudySession: the baseline check', () => {
  it('records an answer to a card of the check as a baseline answer, the rest as the session’s', async () => {
    const check: CardView = { ...RSG, baseline: true }
    const { session, client, speech, state } = await started([check, SAMPLE_MOVE_A])
    expect(state()).toMatchObject({ screen: 'card', card: check })
    speech.say('ready steady go', 6000)
    await settle()
    session.next()
    await settle()
    expect(state()).toMatchObject({ screen: 'card', card: SAMPLE_MOVE_A })
    speech.say('a mat a strap and the rollers', 6000)
    await settle()
    session.next()
    await settle()
    expect(client.reviews.map((review) => [review.itemId, review.mode])).toEqual([
      [RSG.itemId, 'baseline'],
      [SAMPLE_MOVE_A.itemId, 'start'],
    ])
    expect(client.nextRequests.every((request) => request.mode === 'start')).toBe(true)
    expect(state().screen).toBe('done')
  })
})

describe('StudySession: hold to talk', () => {
  it('reads the card, then waits: nothing listens until the learner holds the mic', async () => {
    const { speech, clock, state } = await started()
    expect(speech.spoken).toEqual([SAMPLE_MOVE_A.prompt])
    expect(state()).toMatchObject({ screen: 'card', speaking: false, listening: false })
    expect(speech.listens).toHaveLength(0)

    clock.advance(10 * 60_000)
    await settle()
    expect(state()).toMatchObject({ screen: 'card', listening: false })
    expect(speech.listens).toHaveLength(0)
  })

  it('records only while held: blue while held, words live, gray on release', async () => {
    const { session, speech, state } = await started()
    session.holdStart()
    await settle()
    expect(state().listening).toBe(true)
    expect(speech.lastListen).toMatchObject({ endOn: 'release', commands: false })
    session.heard('a mat')
    expect(state().heard).toBe('a mat')
    speech.partial = 'a mat'
    session.holdEnd()
    expect(state().listening).toBe(false)
    expect(speech.releases).toBe(1)
    await settle()
    expect(speech.listening).toBe(false)
    expect(state()).toMatchObject({ screen: 'card', heard: 'a mat' })
  })

  it('keeps what the learner said across holds until the learner submits', async () => {
    const { session, speech, client, state } = await started()
    speech.hold('a mat', 3000)
    await settle()
    speech.hold('a strap and the rollers', 3000)
    await settle()
    expect(state().heard).toBe('a mat a strap and the rollers')
    expect(client.gradeRequests).toHaveLength(0)
    session.submitAnswer()
    await settle()
    expect(client.gradeRequests).toEqual([
      {
        itemId: SAMPLE_MOVE_A.itemId,
        answer: 'a mat a strap and the rollers',
        answerMs: 6000,
        hintUsed: false,
        entry: 'voice',
      },
    ])
    expect(state().screen).toBe('result')
  })

  it('Clear wipes what the learner said; the learner records again', async () => {
    const { session, speech, client, state } = await started()
    speech.hold('um let me think')
    await settle()
    session.clearAnswer()
    expect(state().heard).toBe('')
    speech.hold('a mat a strap the rollers')
    await settle()
    session.submitAnswer()
    await settle()
    expect(client.gradeRequests[0]?.answer).toBe('a mat a strap the rollers')
  })

  it('Clear while the learner holds drops that hold’s words too', async () => {
    const { session, speech, state } = await started()
    session.holdStart()
    session.heard('scratch that')
    speech.partial = 'scratch that'
    session.clearAnswer()
    await settle()
    expect(state()).toMatchObject({ heard: '', listening: false })
    session.holdEnd()
    await settle()
    expect(state().heard).toBe('')
  })

  it('Submit right after the learner lets go waits for the recognizer’s last words', async () => {
    const { session, speech, client } = await started()
    speech.releaseEndsAtOnce = false
    session.holdStart()
    session.heard('a mat a strap')
    session.holdEnd()
    session.submitAnswer()
    session.submitAnswer()
    await settle()
    expect(client.gradeRequests).toHaveLength(0)
    speech.handOver('a mat a strap the rollers')
    await settle()
    expect(client.gradeRequests.map((request) => request.answer)).toEqual([
      'a mat a strap the rollers',
    ])
  })

  it('Clear right after the learner lets go sticks: late words never come back', async () => {
    const { session, speech, state } = await started()
    speech.releaseEndsAtOnce = false
    session.holdStart()
    session.heard('sample move a')
    session.holdEnd()
    session.clearAnswer()
    expect(speech.listening).toBe(false)
    session.heard('sample move a')
    await settle()
    expect(state().heard).toBe('')
  })

  it('on a choices card, a hold started while the last one hands over still starts over', async () => {
    const { session, speech, client } = await started([SAMPLE_MOVE_A_PICK])
    speech.releaseEndsAtOnce = false
    session.holdStart()
    session.heard('number two')
    speech.partial = 'number two'
    session.holdEnd()

    session.holdStart()
    await settle()
    session.heard('number one')
    speech.handOver('number one')
    await settle()
    expect(session.getState().heard).toBe('number one')
    session.submitAnswer()
    await settle()
    expect(client.gradeRequests[0]?.answer).toBe(SAMPLE_MOVE_A_CHOICES[0])
  })

  it('a spoken command keeps what the learner said before it', async () => {
    const { speech, state } = await started()
    speech.hold('a mat')
    await settle()
    speech.command('repeat')
    await settle()
    expect(state()).toMatchObject({ screen: 'card', heard: 'a mat' })
  })

  it('pressed again while the last hold hands over: the same listen carries on, words kept', async () => {
    const { session, speech, state, client } = await started()
    speech.releaseEndsAtOnce = false
    session.holdStart()
    session.heard('a mat')
    session.holdEnd()
    expect(state().listening).toBe(false)
    session.holdStart()
    expect(speech.resumes).toBe(1)
    expect(speech.listens).toHaveLength(1)
    expect(state().listening).toBe(true)
    session.heard('a mat a strap')
    session.holdEnd()
    speech.handOver('a mat a strap')
    await settle()
    expect(state().heard).toBe('a mat a strap')
    session.submitAnswer()
    await settle()
    expect(client.gradeRequests[0]?.answer).toBe('a mat a strap')
  })

  it('the orb turns blue when the recognizer starts, not on the press', async () => {
    const { session, speech, state } = await started()
    let start: (() => void) | undefined
    const listen = speech.listen.bind(speech)
    speech.listen = (options) => {
      const delayed = { ...options, onStart: undefined }
      const result = listen(delayed)
      start = () => options.onStart?.(0)
      return result
    }
    session.holdStart()
    expect(state().listening).toBe(false)
    start?.()
    expect(state().listening).toBe(true)
  })

  it('Return while holding lets go first, then waits for the last words', async () => {
    const { session, speech, client } = await started()
    speech.releaseEndsAtOnce = false
    session.holdStart()
    session.heard('a mat upper')
    session.key('enter')
    expect(speech.releases).toBe(1)
    await settle()
    expect(client.gradeRequests).toHaveLength(0)
    speech.handOver('a mat a strap')
    await settle()
    expect(client.gradeRequests[0]?.answer).toBe('a mat a strap')
  })

  it('Send on This looks wrong waits for the last words too', async () => {
    const { session, speech, client } = await started()
    speech.say('a mat')
    await settle()
    session.report()
    session.reportTypeInstead(false)
    speech.releaseEndsAtOnce = false
    session.holdStart()
    session.heard('sample move a works the')
    session.holdEnd()
    void session.sendReport()
    await settle()
    expect(client.flags).toHaveLength(0)
    speech.handOver('sample move a works the group b')
    await settle()
    expect(client.flags.map((flag) => flag.note)).toEqual(['sample move a works the group b'])
  })

  it('five idle minutes: the wake lock goes; nothing moves', async () => {
    const card = await started()
    card.clock.advance(IDLE_MS)
    await settle()
    expect(card.lock.held).toBe(0)
    expect(card.state()).toMatchObject({ screen: 'card', card: SAMPLE_MOVE_A })

    card.session.holdStart()
    await settle()
    expect(card.lock.held).toBe(1)

    const result = await started()
    result.speech.say('a mat')
    await settle()

    expect(result.speech.listening).toBe(false)
    result.clock.advance(IDLE_MS - 1)
    await settle()
    expect(result.lock.held).toBe(1)
    result.clock.advance(1)
    await settle()
    expect(result.lock.held).toBe(0)
    expect(result.speech.listening).toBe(false)
    expect(result.state()).toMatchObject({ screen: 'result', listening: false })
    expect(result.client.reviews).toHaveLength(0)
    result.session.next()
    await settle()
    expect(result.lock.held).toBe(1)
    expect(result.state().card).toEqual(RSG)
  })

  it('Submit with nothing said does nothing; Return submits', async () => {
    const { session, speech, client, state } = await started()
    session.submitAnswer()
    session.key('enter')
    await settle()
    expect(client.gradeRequests).toHaveLength(0)
    expect(state().screen).toBe('card')
    speech.hold('a mat')
    await settle()
    session.key('enter')
    await settle()
    expect(client.gradeRequests[0]?.answer).toBe('a mat')
  })

  it('Submit while still holding sends what is on screen and stops the mic', async () => {
    const { session, speech, client } = await started()
    session.holdStart()
    session.heard('a mat')
    speech.partial = 'a mat'
    session.submitAnswer()

    expect(speech.releases).toBe(1)
    expect(speech.listening).toBe(false)
    await settle()
    expect(client.gradeRequests[0]?.answer).toBe('a mat')
  })

  it('holding while the card is read out stops the voice and records', async () => {
    const h = make()
    let finishSpeaking: (() => void) | undefined
    h.speech.speak = (text: string) => {
      h.speech.spoken.push(text)
      return new Promise((resolve) => {
        finishSpeaking = () => {
          resolve({ ok: false, ms: 1 })
        }
      })
    }
    const stop = h.speech.stop.bind(h.speech)
    h.speech.stop = () => {
      stop()
      finishSpeaking?.()
    }
    void h.session.start()
    await settle()
    expect(h.state()).toMatchObject({ screen: 'card', speaking: true, listening: false })
    h.session.holdStart()
    await settle()
    expect(h.state()).toMatchObject({ speaking: false, listening: true })
    expect(h.speech.listening).toBe(true)
  })

  it('a hold that is just a command runs it: repeat and hint read, then wait again', async () => {
    const { speech, client, state } = await started()
    speech.command('repeat')
    await settle()
    expect(speech.spoken).toEqual([SAMPLE_MOVE_A.prompt, SAMPLE_MOVE_A.prompt])
    expect(state()).toMatchObject({ screen: 'card', heard: '', listening: false })
    speech.command('hint')
    await settle()
    expect(state().hint).toBe('It starts with “A mat…”')
    expect(speech.spoken.at(-1)).toBe('It starts with “A mat…”')
    expect(speech.listening).toBe(false)
    speech.say('a mat a strap the rollers', 1000)
    await settle()
    expect(client.gradeRequests[0]?.hintUsed).toBe(true)

    expect(state().outcome?.rating).toBe(2)
  })

  it('"show source" shows the answer with the source open, under Here’s the answer', async () => {
    const { session, speech, client, state } = await started()
    speech.command('show source')
    await settle()
    expect(client.gradeRequests).toHaveLength(0)
    expect(state()).toMatchObject({
      screen: 'source',
      outcome: { result: 'wrong', word: 'shown', rating: 1, revealed: true },
    })
    expect(speech.spoken.at(-1)).toBe(`Here’s the answer. ${SAMPLE_MOVE_A.answer}`)
    expect(speech.listening).toBe(false)
    session.closeSource()
    expect(state()).toMatchObject({ screen: 'result', outcome: { word: 'shown' } })
  })

  it('Change on a revealed answer: Not quite keeps Again, Got it sets Good', async () => {
    const { session, speech, state } = await started()
    speech.command("i don't know")
    await settle()
    session.openRating()
    session.chooseWord('wrong')
    expect(state()).toMatchObject({ screen: 'result', outcome: { word: 'wrong', rating: 1 } })
    session.openRating()
    session.chooseWord('right')
    expect(state()).toMatchObject({ screen: 'result', outcome: { word: 'right', rating: 3 } })
  })

  it('"skip" moves on with no review and asks the server to leave the card out', async () => {
    const { speech, client, state } = await started()
    speech.command('skip')
    await settle()
    expect(client.reviews).toHaveLength(0)
    expect(client.nextRequests[1]?.exclude).toEqual([SAMPLE_MOVE_A.itemId])
    expect(state().card).toEqual(RSG)
  })

  it('"pause" lets the screen sleep; Back to it reads the card again and waits', async () => {
    const { session, speech, lock, state } = await started()
    speech.command('pause')
    await settle()
    expect(state().screen).toBe('paused')
    expect(lock.held).toBe(0)
    void session.backToIt()
    await settle()
    expect(state()).toMatchObject({ screen: 'card', listening: false, card: SAMPLE_MOVE_A })
    expect(speech.spoken).toEqual([SAMPLE_MOVE_A.prompt, SAMPLE_MOVE_A.prompt])
    expect(lock.held).toBe(1)
  })

  it('a hold with nothing heard keeps the card; nothing is sent', async () => {
    const { speech, client, state } = await started()
    speech.hold('')
    await settle()
    expect(state()).toMatchObject({ screen: 'card', heard: '' })
    expect(client.gradeRequests).toHaveLength(0)
  })

  it('holds do nothing off the card and This looks wrong', async () => {
    const { session, speech, state } = await started()
    speech.say('a mat')
    await settle()
    const listens = speech.listens.length
    session.holdStart()
    session.holdEnd()
    expect(speech.listens).toHaveLength(listens)
    expect(state().screen).toBe('result')
  })
})

describe('StudySession: the result stays until Next', () => {
  it('grades, reads back, and stays put until the learner taps Next', async () => {
    const { session, speech, client, clock, lock, state } = await started()
    expect(lock.held).toBe(1)
    expect(state()).toMatchObject({ progress: { current: 12, total: 49 } })
    speech.say('a mat a strap and the rollers', 6000)
    await settle()
    expect(state()).toMatchObject({
      screen: 'result',
      answer: 'a mat a strap and the rollers',
      outcome: { result: 'right', rating: 3, proposedRating: 3, gradedBy: 'tutor' },
      redo: false,
    })
    expect(speech.spoken.at(-1)).toBe('Got it.')

    expect(speech.listening).toBe(false)
    expect(speech.listens).toHaveLength(1)
    expect(speech.lastListen).toMatchObject({ endOn: 'release' })
    clock.advance(4 * 60_000)
    await settle()
    expect(state()).toMatchObject({ screen: 'result', listening: false })
    expect(speech.listens).toHaveLength(1)
    expect(client.reviews).toHaveLength(0)
    session.next()
    await settle()
    expect(client.reviews).toEqual([
      {
        eventId: 'event-1',
        itemId: SAMPLE_MOVE_A.itemId,
        mode: 'start',
        result: 'right',
        rating: 3,
        proposedRating: 3,
        overridden: false,
        answerText: 'a mat a strap and the rollers',
        answerMs: 6000,
        hintUsed: false,
        gradedBy: 'tutor',
        traceId: 'trace-1',
        reviewedAt: '2026-08-18T15:00:06.000Z',
      },
    ])
    expect(state()).toMatchObject({
      screen: 'card',
      card: RSG,
      progress: { current: 13, total: 49 },
    })
    speech.say('ready steady go', 4000)
    await settle()
    expect(state().outcome?.rating).toBe(4)
    session.key('space')
    await settle()

    expect(state()).toMatchObject({ screen: 'done', summary: { cards: 13 } })
    expect(speech.spoken.at(-1)).toBe('Done for today. Nicely paced.')
    expect(lock.held).toBe(0)
    expect(client.nextRequests).toHaveLength(3)
    expect(client.nextRequests[0]).toEqual({ mode: 'start', categories: [], exclude: [] })
  })

  it('a spoken “next” is never heard on the result: only Next moves on', async () => {
    const { session, speech, client, state } = await started()
    speech.say('a mat a strap the rollers')
    await settle()

    expect(() => {
      speech.say('next')
    }).toThrow('nothing is listening')
    await settle()
    expect(state().screen).toBe('result')
    expect(client.reviews).toHaveLength(0)
    session.next()
    await settle()
    expect(client.reviews).toHaveLength(1)
    expect(state().card).toEqual(RSG)
  })

  it('never listens while it speaks', async () => {
    const { session, speech, state } = await started()
    speech.say('a mat a strap the rollers')
    await settle()
    session.next()
    await settle()
    speech.command('repeat')
    await settle()
    speech.command('hint')
    await settle()
    expect(state().screen).toBe('card')
  })

  it('reads the result once and opens the source by tap; “repeat” and “show source” go unheard', async () => {
    const { session, speech, state } = await started()
    speech.say('a mat a strap the rollers')
    await settle()
    expect(() => {
      speech.command('repeat')
    }).toThrow('nothing is listening')
    expect(speech.spoken.filter((line) => line === 'Got it.')).toHaveLength(1)
    expect(state().screen).toBe('result')
    session.openSource()
    expect(state().screen).toBe('source')
  })

  it('a pause on the result lets the screen sleep; Back to it returns to the result, which never listens', async () => {
    const { session, client, speech, state, lock } = await started()
    speech.say('a mat a strap the rollers')
    await settle()
    session.pause()
    await settle()
    expect(state().screen).toBe('paused')
    expect(lock.held).toBe(0)
    expect(client.reviews).toHaveLength(0)
    void session.backToIt()
    await settle()
    expect(state().screen).toBe('result')
    expect(lock.held).toBe(1)
    expect(speech.listening).toBe(false)
  })

  it('stays on the result when the source closes', async () => {
    const { session, speech, state } = await started()
    speech.say('a mat a strap the rollers')
    await settle()
    session.openSource()
    expect(state().screen).toBe('source')
    session.closeSource()
    await settle()
    expect(state().screen).toBe('result')
    expect(speech.listening).toBe(false)
  })

  it('opens no listen on the result, after a change of rating, or on Sent; Next still works', async () => {
    const { session, speech, state } = await started()
    speech.say('a mat a strap the rollers')
    await settle()
    const listens = speech.listens.length
    session.openRating()
    session.chooseWord('partial')
    await settle()
    expect(state()).toMatchObject({ screen: 'result', listening: false })
    session.report()
    session.reportTypeInstead(false)
    speech.hold('sample move a works the group b')
    await settle()
    void session.sendReport()
    await settle()
    expect(state()).toMatchObject({ screen: 'report-sent', listening: false })

    expect(speech.listens).toHaveLength(listens + 1)
    expect(speech.listening).toBe(false)
    session.next()
    await settle()
    expect(state().card).toEqual(RSG)
  })
})

describe('StudySession: Redo', () => {
  it('asks the same card again; only the first answer counts as a review', async () => {
    const { session, speech, client, state } = await started()
    speech.say('a mat and pegs')
    await settle()
    session.openRating()
    session.chooseWord('partial')
    await settle()
    void session.redo()
    await settle()

    expect(client.reviews).toHaveLength(1)
    expect(client.reviews[0]).toMatchObject({ rating: 2, answerText: 'a mat and pegs' })
    expect(state()).toMatchObject({ screen: 'card', card: SAMPLE_MOVE_A, redo: true, heard: '' })
    expect(speech.spoken.at(-1)).toBe(SAMPLE_MOVE_A.prompt)
    speech.say('a mat a strap the rollers')
    await settle()
    expect(client.gradeRequests).toHaveLength(2)
    expect(state()).toMatchObject({ screen: 'result', redo: true })

    session.openRating()
    expect(state().screen).toBe('result')
    void session.redo()
    await settle()
    speech.command("i don't know")
    await settle()
    session.next()
    await settle()
    expect(client.reviews).toHaveLength(1)
    expect(state()).toMatchObject({ card: RSG, redo: false })
  })

  it('Redo is a tap: nothing hears “redo” on the result', async () => {
    const { session, speech, client, state } = await started()
    speech.say('a mat')
    await settle()
    expect(() => {
      speech.say('redo')
    }).toThrow('nothing is listening')
    expect(state().screen).toBe('result')
    void session.redo()
    await settle()
    expect(state()).toMatchObject({ screen: 'card', card: SAMPLE_MOVE_A, redo: true })
    expect(client.reviews).toHaveLength(1)
  })

  it('a redo checked by hand (grader down) is shown, never saved', async () => {
    const { session, speech, client, state } = await started()
    speech.say('a mat')
    await settle()
    void session.redo()
    await settle()
    client.grader = () => ({ ok: false, reason: 'timeout' })
    speech.say('a mat a strap')
    await settle()
    session.selfRate('right')
    await settle()
    expect(state()).toMatchObject({ screen: 'result', redo: true, outcome: { rating: 3 } })
    session.next()
    await settle()
    expect(client.reviews).toHaveLength(1)
  })
})

describe('StudySession: fallbacks', () => {
  it('grader unreachable: answer and source shown, the learner rates it themselves, and it is saved', async () => {
    const { session, speech, client, state } = await started()
    client.grader = () => ({ ok: false, reason: 'timeout' })
    speech.say('a mat and pegs')
    await settle()
    expect(state()).toMatchObject({ screen: 'self-grade', answer: 'a mat and pegs' })
    session.selfRate('partial')
    await settle()
    expect(state()).toMatchObject({
      screen: 'result',

      outcome: {
        result: 'partial',
        word: 'partial',
        rating: 2,
        proposedRating: 2,
        gradedBy: 'self',
      },
    })
    expect(speech.spoken.at(-1)).toBe('Almost.')
    session.next()
    await settle()
    expect(client.reviews[0]).toMatchObject({
      gradedBy: 'self',
      rating: 2,
      overridden: false,
      traceId: null,
      answerText: 'a mat and pegs',
    })
  })

  it('Voice instead goes back to the card from typing, and the next hold asks for the mic again', async () => {
    const { session, speech, state } = await started()
    session.typeInstead()
    expect(state().screen).toBe('type')
    session.voiceInstead()
    expect(state()).toMatchObject({ screen: 'card', typing: false, listening: false })
    expect(speech.listening).toBe(false)
    speech.hold('a mat')
    await settle()
    expect(state().heard).toBe('a mat')

    session.holdStart()
    speech.fail('microphone-blocked')
    await settle()
    session.useTyping()
    expect(state()).toMatchObject({ screen: 'type', typing: true })
    session.voiceInstead()
    expect(state()).toMatchObject({ screen: 'card', typing: false })

    session.voiceInstead()
    expect(state().screen).toBe('card')
  })

  it('never says or keeps a follow-up question the grader writes', async () => {
    const { speech, client, state } = await started()
    client.grader = () => ({
      ok: true,
      grade: { ...RIGHT.grade, followUp: 'Why does the sample move a work the rollers?' },
    })
    speech.say('a mat a strap the rollers')
    await settle()
    expect(state().screen).toBe('result')
    expect(speech.spoken.at(-1)).toBe('Got it.')
    expect(speech.spoken.join(' ')).not.toContain('Why does')
    expect(state().outcome).not.toHaveProperty('followUp')
  })

  it('says the grader model’s line without em dashes or semicolons', async () => {
    const { speech, client, state } = await started()
    client.grader = () => ({
      ok: true,
      grade: {
        ...RIGHT.grade,
        result: 'partial',
        spoken: 'Almost — you left out the rollers; the sample move a works them too.',
      },
    })
    speech.say('a mat a strap')
    await settle()
    expect(state().screen).toBe('result')
    expect(speech.spoken.at(-1)).toBe(
      'Almost, you left out the rollers. The sample move a works them too.',
    )
  })

  it('microphone blocked: shows how to turn it on, and typing keeps going', async () => {
    const { session, speech, client, clock, state } = await started()
    session.holdStart()
    speech.fail('microphone-blocked')
    await settle()
    expect(state().screen).toBe('mic-blocked')
    session.retryMic()
    await settle()
    expect(state()).toMatchObject({ screen: 'card', listening: false })
    session.holdStart()
    speech.fail('microphone-blocked')
    await settle()
    session.useTyping()
    expect(state()).toMatchObject({ screen: 'type', typing: true })
    session.submitTyped('  a mat, a strap, the rollers ')
    await settle()
    expect(client.gradeRequests[0]?.answer).toBe('a mat, a strap, the rollers')
    expect(state().screen).toBe('result')

    expect(speech.listening).toBe(false)
    clock.advance(60_000)
    await settle()
    expect(state().screen).toBe('result')
    session.next()
    await settle()

    expect(state()).toMatchObject({ screen: 'type', card: RSG, listening: false })
    expect(speech.listening).toBe(false)
  })

  it('any other recognizer error keeps the card and their words: the learner holds again', async () => {
    const { session, speech, state } = await started()
    speech.hold('a mat')
    await settle()
    session.holdStart()
    session.heard('upper')
    speech.fail('network')
    await settle()
    expect(state()).toMatchObject({
      screen: 'card',
      typing: false,
      micIssue: true,
      listening: false,
      heard: 'a mat',
    })
    speech.hold('a strap')
    await settle()
    expect(state()).toMatchObject({ micIssue: false, heard: 'a mat a strap' })
  })

  it('no recognizer at all means typing for the whole session', async () => {
    const { session, speech, state } = await started()
    session.holdStart()
    speech.fail('unsupported')
    await settle()
    expect(state()).toMatchObject({ screen: 'type', typing: true })
  })

  it('no connection: an error screen, and Try again picks up', async () => {
    const h = make()
    h.client.nextFails = 1
    void h.session.start()
    await settle()
    expect(h.state()).toMatchObject({ screen: 'error', signedOut: false })
    h.session.key('space')
    await settle()
    expect(h.state()).toMatchObject({ screen: 'card', card: SAMPLE_MOVE_A })
  })

  it('their session ended: the error says so (the passcode, not the Wi-Fi)', async () => {
    const h = make()
    h.client.nextFails = 1
    h.client.nextError = new StudyClientError('http', 401)
    void h.session.start()
    await settle()
    expect(h.state()).toMatchObject({ screen: 'error', signedOut: true })
    void h.session.retry()
    await settle()
    expect(h.state()).toMatchObject({ screen: 'card', card: SAMPLE_MOVE_A, signedOut: false })
  })
})

describe('StudySession: the learner can change it', () => {
  it('changes the rating with one tap; the review records the override', async () => {
    const { session, speech, client, state } = await started()
    speech.say('a mat a strap the rollers')
    await settle()
    session.openRating()
    expect(state().screen).toBe('rating')
    expect(speech.listening).toBe(false)
    session.chooseWord('partial')
    await settle()
    expect(state()).toMatchObject({
      screen: 'result',
      outcome: { result: 'right', word: 'partial', rating: 2, proposedRating: 3 },
    })
    session.next()
    await settle()
    expect(client.reviews[0]).toMatchObject({ rating: 2, proposedRating: 3, overridden: true })
  })

  it('the same word keeps the app’s rating; its own word brings the app’s rating back', async () => {
    const { session, speech, state } = await started()

    speech.say('a mat a strap the rollers', 1000)
    await settle()
    expect(state().outcome).toMatchObject({ word: 'right', rating: 4, proposedRating: 4 })
    session.openRating()
    session.chooseWord('right')
    await settle()
    expect(state().outcome).toMatchObject({ word: 'right', rating: 4 })
    session.openRating()
    session.chooseWord('wrong')
    await settle()
    expect(state().outcome).toMatchObject({ word: 'wrong', rating: 1 })
    session.openRating()
    session.chooseWord('right')
    await settle()
    expect(state().outcome).toMatchObject({ word: 'right', rating: 4 })
  })

  it('says and shows the same word: Got it, Almost or Not quite', async () => {
    const { speech, client, state } = await started()
    client.grader = () => ({
      ok: true,
      grade: { ...RIGHT.grade, result: 'partial', spoken: 'Almost. Add rollers.' },
    })
    speech.say('a mat a strap', 6000)
    await settle()
    expect(state().outcome).toMatchObject({ word: 'partial' })
    expect(speech.spoken.at(-1)).toBe('Almost. Add rollers.')
  })

  it('once the review is saved and the next card is on its way, Change does nothing', async () => {
    const { session, speech, client, state } = await started()
    speech.say('a mat a strap the rollers')
    await settle()
    client.next = () => new Promise(() => undefined)
    session.next()
    await settle()
    expect(client.reviews).toHaveLength(1)
    expect(state().screen).toBe('result')
    session.openRating()
    expect(state().screen).toBe('result')
  })

  it('Cancel keeps the proposed rating', async () => {
    const { session, speech, state } = await started()
    speech.say('a mat a strap the rollers')
    await settle()
    session.openRating()
    session.key('escape')
    await settle()
    expect(state()).toMatchObject({ screen: 'result', outcome: { rating: 3 } })
  })

  it('Show answer reveals under Here’s the answer; Type instead stops a hold', async () => {
    const { session, speech, state } = await started()
    session.holdStart()
    session.typeInstead()
    expect(state()).toMatchObject({ screen: 'type', listening: false })
    expect(speech.listening).toBe(false)
    session.showAnswer()
    await settle()
    expect(state()).toMatchObject({
      screen: 'result',
      outcome: { revealed: true, word: 'shown', rating: 1 },
    })
    expect(speech.spoken.at(-1)).toBe(`Here’s the answer. ${SAMPLE_MOVE_A.answer}`)
  })

  it('This looks wrong: the learner holds to say it, Clear and Send work, and Sent stays until Next', async () => {
    const { session, speech, client, clock, state } = await started()
    speech.say('a mat a strap the rollers')
    await settle()
    session.report()
    session.reportTypeInstead(false)
    await settle()
    expect(state()).toMatchObject({ screen: 'report', listening: false, heard: '' })
    expect(speech.listening).toBe(false)

    void session.sendReport()
    await settle()
    expect(client.flags).toHaveLength(0)
    speech.hold('wrong words')
    await settle()
    session.clearAnswer()
    expect(state().heard).toBe('')
    speech.hold('my trainer said sample move a works the groupB too')
    await settle()
    expect(speech.listens.at(-1)).toMatchObject({ endOn: 'release', commands: false })
    session.holdStart()
    session.heard('and the pegs')
    speech.partial = 'and the pegs'
    expect(state().heard).toBe('my trainer said sample move a works the groupB too and the pegs')
    void session.sendReport()
    await settle()

    expect(client.flags).toEqual([
      {
        itemId: SAMPLE_MOVE_A.itemId,
        note: 'my trainer said sample move a works the groupB too and the pegs',
        answer: {
          text: 'a mat a strap the rollers',
          reviewedAt: expect.any(String) as unknown,
          result: 'right',
          gradedBy: expect.any(String) as unknown,
          entry: 'voice',
        },
      },
    ])
    expect(state().screen).toBe('report-sent')
    expect(speech.spoken.at(-1)).toBe('Thanks. It’s set aside.')
    clock.advance(60_000)
    await settle()
    expect(state().screen).toBe('report-sent')
    expect(client.reviews).toHaveLength(0)
    session.next()
    await settle()
    expect(client.reviews).toHaveLength(1)
    expect(client.flags[0]?.answer?.reviewedAt).toBe(client.reviews[0]?.reviewedAt)
    expect(client.flags[0]?.answer?.gradedBy).toBe(client.reviews[0]?.gradedBy)
    expect(state().card).toEqual(RSG)
  })

  it('a spoken command on This looks wrong is just words', async () => {
    const { session, speech, state } = await started()
    speech.say('a mat')
    await settle()
    session.report()
    session.reportTypeInstead(false)
    speech.hold('skip')
    await settle()
    expect(state()).toMatchObject({ screen: 'report', heard: 'skip' })
  })

  it('Cancel on This looks wrong goes back to the result', async () => {
    const { session, speech, client, state } = await started()
    speech.say('a mat a strap the rollers')
    await settle()
    session.report()
    session.reportTypeInstead(false)
    await settle()
    session.key('escape')
    await settle()
    expect(state()).toMatchObject({ screen: 'result', note: '' })
    expect(client.flags).toHaveLength(0)
  })
})

describe('StudySession: breaks, the end, and the keyboard', () => {
  it('takes five after 15 minutes of study, lets the screen sleep, then picks up', async () => {
    const { session, speech, clock, lock, state } = await started()
    clock.advance(STUDY_STRETCH_MS)
    speech.say('a mat a strap the rollers')
    await settle()
    expect(state().screen).toBe('result')
    session.next()
    await settle()
    expect(state()).toMatchObject({ screen: 'break', breakEndsAt: clock.t + BREAK_MS })
    expect(speech.spoken.at(-1)).toBe('Take five.')
    expect(lock.held).toBe(0)
    void session.backToIt()
    await settle()
    expect(state()).toMatchObject({ screen: 'card', card: RSG, breakEndsAt: null })
    expect(lock.held).toBe(1)
  })

  it('takes a second break after another 15 minutes of study once the learner is back to it', async () => {
    const { session, speech, clock, state } = await started([
      SAMPLE_MOVE_A,
      RSG,
      { ...SAMPLE_MOVE_A, itemId: 'core-sample move a-again' },
      { ...RSG, itemId: 'core-RSG-again' },
    ])
    clock.advance(STUDY_STRETCH_MS)
    speech.say('a mat a strap the rollers')
    await settle()
    session.next()
    await settle()
    expect(state().screen).toBe('break')
    void session.backToIt()
    await settle()

    clock.advance(STUDY_STRETCH_MS - 60_000)
    speech.say('a mat a strap the rollers')
    await settle()
    session.next()
    await settle()
    expect(state().screen).toBe('card')

    clock.advance(60_000)
    speech.say('a mat a strap the rollers')
    await settle()
    session.next()
    await settle()
    expect(state()).toMatchObject({ screen: 'break', breakEndsAt: clock.t + BREAK_MS })
    expect(speech.spoken.at(-1)).toBe('Take five.')
  })

  it('pauses do not count toward the 15 minutes', async () => {
    const { session, speech, clock, state } = await started()
    clock.advance(10 * 60_000)
    speech.command('pause')
    await settle()
    clock.advance(30 * 60_000)
    void session.backToIt()
    await settle()
    speech.say('a mat a strap the rollers')
    await settle()
    session.next()
    await settle()
    expect(state().screen).toBe('card')
  })

  it('Done for today from the break shows the study time', async () => {
    const { session, speech, clock, state } = await started()
    clock.advance(STUDY_STRETCH_MS + 54_000)
    speech.say('a mat a strap the rollers')
    await settle()
    session.next()
    await settle()
    clock.advance(BREAK_MS)
    void session.end()
    await settle()
    expect(state()).toMatchObject({
      screen: 'done',
      summary: { cards: 12, studyMs: STUDY_STRETCH_MS + 60_000 },
    })
  })

  it('Space and Return on the result move on; Space on the card does nothing by itself', async () => {
    const { session, speech, client, state } = await started()
    session.key('space')
    await settle()
    expect(state()).toMatchObject({ screen: 'card', listening: false })
    expect(speech.listens).toHaveLength(0)
    speech.say('a mat')
    await settle()
    session.key('space')
    await settle()
    expect(client.reviews).toHaveLength(1)
    expect(state().card).toEqual(RSG)
    speech.say('form action')
    await settle()
    session.key('enter')
    await settle()
    expect(state().screen).toBe('done')
  })

  it('Esc ends the session and saves the answer on screen', async () => {
    const { session, speech, client, lock, state } = await started()
    speech.say('a mat a strap the rollers')
    await settle()
    session.key('escape')
    await settle()
    expect(client.reviews).toHaveLength(1)
    expect(state()).toMatchObject({ screen: 'done', summary: { cards: 12 } })
    expect(lock.held).toBe(0)

    session.key('escape')
    expect(state().screen).toBe('done')
  })

  it('Space on the break or a pause goes back to it; Return on This looks wrong sends it', async () => {
    const { session, speech, state, client } = await started()
    speech.command('pause')
    await settle()
    session.key('space')
    await settle()
    expect(state().screen).toBe('card')
    speech.say('a mat a strap the rollers')
    await settle()
    session.report()
    session.reportTypeInstead(false)
    await settle()
    speech.hold('sample move a works the group b')
    await settle()
    session.key('enter')
    await settle()
    expect(client.flags).toHaveLength(1)
    expect(state().screen).toBe('report-sent')
    session.key('space')
    await settle()
    expect(state().card).toEqual(RSG)
  })
})

describe('StudySession: lifecycle', () => {
  it('saves the answer on screen when the page may be going away, once', async () => {
    const { session, speech, client, state } = await started()
    speech.say('a mat a strap the rollers')
    await settle()
    session.save()
    await settle()
    expect(client.reviews).toHaveLength(1)
    expect(state().screen).toBe('result')
    session.next()
    await settle()
    expect(client.reviews).toHaveLength(1)
    expect(state().card).toEqual(RSG)
  })

  it('leaving the page saves the answer on screen and lets the screen sleep', async () => {
    const { session, speech, client, lock } = await started()
    speech.say('a mat a strap the rollers')
    await settle()
    session.dispose()
    await settle()
    expect(client.reviews).toHaveLength(1)
    expect(lock.held).toBe(0)
    expect(speech.listening).toBe(false)

    session.dispose()
    session.visible()
  })

  it('asks for the wake lock again when the page comes back', async () => {
    const { session, lock } = await started()
    expect(lock.requests).toBe(1)
    session.visible()
    await settle()
    expect(lock.requests).toBe(2)
    expect(lock.held).toBe(1)
  })

  it('releases a wake lock that arrives after the session ended', async () => {
    const h = make([])
    let grant: ((release: () => void) => void) | undefined
    let released = 0
    const session = new StudySession(
      {
        client: h.client,
        speech: h.speech,
        clock: h.clock,
        newId: () => 'id',
        wakeLock: () =>
          new Promise((resolve) => {
            grant = resolve
          }),
      },
      { mode: 'focus', categories: ['Floor work'] },
    )
    void session.start()
    await settle()
    expect(session.getState().screen).toBe('done')
    grant?.(() => {
      released += 1
    })
    await settle()
    expect(released).toBe(1)
  })

  it('shows their plan from Home for Done, and notifies subscribers', async () => {
    const h = make()
    let calls = 0
    const unsubscribe = h.session.subscribe(() => {
      calls += 1
    })
    void h.session.start()
    await settle()
    expect(h.state().home).toEqual(HOME)
    expect(calls).toBeGreaterThan(0)
    unsubscribe()
  })

  it('ignores actions that don’t fit the screen', async () => {
    const { session, state } = await started()
    session.chooseWord('partial')
    session.cancelRating()
    session.closeSource()
    session.cancelReport()
    session.selfRate('right')
    session.openRating()
    session.openSource()
    session.report()
    session.reportTypeInstead(false)
    session.submitTyped('x')
    session.next()
    session.holdEnd()
    void session.redo()
    void session.sendReport()
    void session.backToIt()
    void session.retry()
    expect(state()).toMatchObject({ screen: 'card', listening: false })
  })
})

describe('StudySession: their answer and how the learner gave it', () => {
  it('keeps a spoken answer as said, marked spoken', async () => {
    const { speech, state } = await started()
    speech.say('a mat a strap and the rollers')
    await settle()
    expect(state()).toMatchObject({
      screen: 'result',
      answer: 'a mat a strap and the rollers',
      answerEntry: 'voice',
    })
  })

  it('a typed answer is marked typed', async () => {
    const { session, state } = await started()
    session.typeInstead()
    session.submitTyped('a mat a strap and the rollers')
    await settle()
    expect(state()).toMatchObject({ screen: 'result', answerEntry: 'typed' })
  })

  it('a tapped choice, or one picked by voice, is marked a choice', async () => {
    const { session, speech, client, state } = await started([
      SAMPLE_MOVE_A_PICK,
      SAMPLE_MOVE_A_PICK,
    ])
    session.choose(1)
    await settle()
    expect(state()).toMatchObject({ answer: SAMPLE_MOVE_A_CHOICES[1], answerEntry: 'choice' })
    session.next()
    await settle()
    speech.hold('number one')
    await settle()
    session.submitAnswer()
    await settle()
    expect(client.gradeRequests[1]?.answer).toBe(SAMPLE_MOVE_A_CHOICES[0])
    expect(state().answerEntry).toBe('choice')
  })

  it('a revealed answer has no answer of theirs to show', async () => {
    const { session, state } = await started()
    session.showAnswer()
    await settle()
    expect(state()).toMatchObject({ answer: '', outcome: { revealed: true } })
  })
})

describe('StudySession: a note keeps how the learner gave the answer', () => {
  it('a typed answer is flagged as typed, so the re-grade gives it no sound-alike reading', async () => {
    const { session, client, state } = await started()
    session.typeInstead()
    session.submitTyped('a mat a strap the rulers')
    await settle()
    expect(state().screen).toBe('result')
    session.report()
    await settle()
    session.typeReport('it graded my typing wrong')
    void session.sendReport()
    await settle()
    expect(client.flags[0]?.note).toBe('it graded my typing wrong')
    expect(client.flags[0]?.answer).toMatchObject({
      text: 'a mat a strap the rulers',
      entry: 'typed',
    })
  })
})

describe('StudySession: This looks wrong takes a typed note first', () => {
  async function onReport() {
    const h = await started()
    h.session.submitAnswer()
    h.speech.say('a mat a strap the rollers')
    await settle()
    expect(h.state().screen).toBe('result')
    h.session.report()
    await settle()
    return h
  }

  it('opens typing, with no mic: Space does nothing, nothing listens', async () => {
    const { session, speech, state } = await onReport()
    expect(state()).toMatchObject({ screen: 'report', reportTyping: true, reportDraft: '' })
    const listens = speech.listens.length
    session.holdStart()
    await settle()
    expect(speech.listens).toHaveLength(listens)
    expect(state().listening).toBe(false)
  })

  it('a typed note is sent as it stands, with the answer it is about, then Sent', async () => {
    const { session, speech, client, state } = await onReport()

    void session.sendReport()
    await settle()
    expect(client.flags).toHaveLength(0)
    session.typeReport('my trainer said sample move a works the groupB too')
    void session.sendReport()
    await settle()
    expect(client.flags).toHaveLength(1)
    expect(client.flags[0]).toMatchObject({
      itemId: SAMPLE_MOVE_A.itemId,
      note: 'my trainer said sample move a works the groupB too',
      answer: { text: 'a mat a strap the rollers', entry: 'voice' },
    })
    expect(state()).toMatchObject({ screen: 'report-sent', reportDraft: '' })
    expect(speech.spoken.at(-1)).toBe('Thanks. It’s set aside.')
  })

  it('Voice instead brings the mic and keeps what the learner typed; Type instead brings it back', async () => {
    const { session, speech, state } = await onReport()
    session.typeReport('the groupB too')
    session.reportTypeInstead(false)
    expect(state()).toMatchObject({ reportTyping: false, reportDraft: 'the groupB too' })
    speech.hold('and the pegs')
    await settle()
    expect(state().heard).toBe('and the pegs')
    session.reportTypeInstead(true)

    expect(state()).toMatchObject({ reportTyping: true, reportDraft: 'the groupB too' })
    session.reportTypeInstead(false)

    expect(state().heard).toBe('and the pegs')
    speech.hold('as well')
    await settle()
    expect(state().heard).toBe('and the pegs as well')
  })

  it('typing after speaking starts from their words when the learner typed none', async () => {
    const { session, speech, state } = await onReport()
    session.reportTypeInstead(false)
    speech.hold('it heard me wrong')
    await settle()
    session.reportTypeInstead(true)
    expect(state().reportDraft).toBe('it heard me wrong')
  })

  it('Cancel goes back to the result and forgets the note', async () => {
    const { session, state } = await onReport()
    session.typeReport('never mind')
    session.cancelReport()
    expect(state()).toMatchObject({ screen: 'result', reportDraft: '' })
    session.report()
    expect(state()).toMatchObject({ reportTyping: true, reportDraft: '' })
  })
})

describe('StudySession: hear the question again', () => {
  it('reads the question again and changes nothing else: no listen, no grade, their words kept', async () => {
    const { session, speech, client, state } = await started()
    speech.hold('a mat')
    await settle()
    const listens = speech.listens.length
    const spokenBefore = speech.spoken.length
    await session.replay()
    await settle()
    expect(speech.spoken.slice(spokenBefore)).toEqual([promptLine(SAMPLE_MOVE_A)])
    expect(speech.listens).toHaveLength(listens)
    expect(client.gradeRequests).toHaveLength(0)
    expect(state()).toMatchObject({
      screen: 'card',
      heard: 'a mat',
      speaking: false,
      listening: false,
    })

    session.submitAnswer()
    await settle()
    expect(client.gradeRequests[0]?.answer).toBe('a mat')
  })

  it('works while typing', async () => {
    const { session, speech, state } = await started()
    session.typeInstead()
    const before = speech.spoken.length
    await session.replay()
    expect(speech.spoken.slice(before)).toEqual([promptLine(SAMPLE_MOVE_A)])
    expect(state().screen).toBe('type')
  })

  it('does nothing during their hold; while it’s checked the grade still lands; on the result it reads and stays', async () => {
    const { session, speech, client, state } = await started()
    client.holdGrades = true
    session.holdStart()
    const before = speech.spoken.length
    await session.replay()
    expect(speech.spoken.length).toBe(before)
    expect(speech.listening).toBe(true)
    speech.partial = 'a mat'
    session.heard('a mat')
    session.holdEnd()
    await settle()
    session.submitAnswer()
    await settle()
    expect(state().screen).toBe('checking')
    await session.replay()
    expect(speech.spoken.at(-1)).toBe(promptLine(SAMPLE_MOVE_A))
    expect(state().screen).toBe('checking')
    client.releaseGrades()
    await settle()

    expect(state().screen).toBe('result')
    expect(speech.spoken.at(-1)).toBe('Got it.')
    expect(client.gradeRequests).toHaveLength(1)
    await session.replay()
    await settle()
    expect(speech.spoken.at(-1)).toBe(promptLine(SAMPLE_MOVE_A))
    expect(state()).toMatchObject({ screen: 'result', speaking: false })
    expect(client.reviews).toHaveLength(0)
  })

  it('talking over a replay keeps their time running from the first reading, so it never makes their answer look fast', async () => {
    const { session, speech, client, clock, state } = await started()
    clock.advance(4000)
    let open: () => void = () => undefined
    speech.speakGate = new Promise<void>((resolve) => {
      open = resolve
    })
    void session.replay()
    await settle()
    expect(state().speaking).toBe(true)
    clock.advance(1000)

    speech.hold('a mat', 2000)
    open()
    await settle()
    session.submitAnswer()
    await settle()
    expect(client.gradeRequests[0]?.answerMs).toBe(7000)
  })

  it('talking over the first reading still starts their time then', async () => {
    const h = make()
    let open: () => void = () => undefined
    h.speech.speakGate = new Promise<void>((resolve) => {
      open = resolve
    })
    void h.session.start()
    await settle()
    expect(h.session.getState().speaking).toBe(true)
    h.clock.advance(1000)
    h.speech.hold('a mat', 2000)
    open()
    await settle()
    h.session.submitAnswer()
    await settle()
    expect(h.client.gradeRequests[0]?.answerMs).toBe(2000)
  })

  it('Type instead during the reading, 30 s of typing, a replay: the answer takes about 30 s, not 0', async () => {
    const h = make()
    let open: () => void = () => undefined
    h.speech.speakGate = new Promise<void>((resolve) => {
      open = resolve
    })
    void h.session.start()
    await settle()
    h.session.typeInstead()
    h.clock.advance(30_000)
    void h.session.replay()
    await settle()
    open()
    await settle()
    h.session.submitTyped('a mat')
    await settle()
    expect(h.client.gradeRequests[0]?.answerMs).toBe(30_000)
  })

  it('holding over the reading, 20 s of talking, a replay: the answer takes about 20 s', async () => {
    const h = make()
    let open: () => void = () => undefined
    h.speech.speakGate = new Promise<void>((resolve) => {
      open = resolve
    })
    void h.session.start()
    await settle()
    h.clock.advance(1000)
    h.speech.hold('a mat', 20_000)
    void h.session.replay()
    await settle()
    open()
    await settle()
    h.session.submitAnswer()
    await settle()
    expect(h.client.gradeRequests[0]?.answerMs).toBe(20_000)
  })

  it('cutting the first reading short reads it whole, the scheduler’s hint too', async () => {
    const card = { ...RSG, hintFirst: true }
    const h = make([card])
    void h.session.start()
    await Promise.resolve()
    await Promise.resolve()
    await h.session.replay()
    await settle()
    const said = h.speech.spoken
    expect(said.filter((line) => line === promptLine(card)).length).toBeGreaterThanOrEqual(1)
    expect(said.at(-2)).toBe(promptLine(card))
    expect(said.at(-1)).toBe(hintFor(card))
    expect(h.session.getState()).toMatchObject({ screen: 'card', speaking: false })
  })
})

describe('StudySession: sound-alike reading of a spoken answer', () => {
  const heard = {
    ok: true,
    grade: { ...RIGHT.grade, corrections: [{ heard: 'rulers', readAs: 'rollers' }] },
  } satisfies GradeOutcome

  it('a spoken answer is sent as spoken and keeps the words the grader read as sound-alikes', async () => {
    const { speech, client, state } = await started()
    client.grader = () => heard
    speech.say('a mat a strap and the rulers')
    await settle()
    expect(client.gradeRequests[0]).toMatchObject({
      answer: 'a mat a strap and the rulers',
      entry: 'voice',
    })
    expect(state()).toMatchObject({
      screen: 'result',
      answerEntry: 'voice',
      outcome: { corrections: [{ heard: 'rulers', readAs: 'rollers' }] },
    })
  })

  it('a typed answer is sent as typed, and shows no correction even if one came back', async () => {
    const { session, client, state } = await started()
    client.grader = () => heard
    session.typeInstead()
    session.submitTyped('a mat a strap and the rulers')
    await settle()
    expect(client.gradeRequests[0]).toMatchObject({ entry: 'typed' })
    expect(state().outcome?.corrections).toEqual([])
  })

  it('a tapped choice is sent as a choice', async () => {
    const { session, client } = await started([SAMPLE_MOVE_A_PICK])
    session.choose(1)
    await settle()
    expect(client.gradeRequests[0]).toMatchObject({
      answer: SAMPLE_MOVE_A_CHOICES[1],
      entry: 'choice',
    })
  })

  it('their own rating and a revealed answer carry no correction', async () => {
    const { session, client, state } = await started()
    client.grader = () => ({ ok: false, reason: 'upstream' })
    session.typeInstead()
    session.submitTyped('a mat')
    await settle()
    session.selfRate('right')
    await settle()
    expect(state()).toMatchObject({ screen: 'result', outcome: { corrections: [] } })
    session.next()
    await settle()
    session.showAnswer()
    await settle()
    expect(state()).toMatchObject({ outcome: { revealed: true, corrections: [] } })
  })
})

function graded(result: 'right' | 'partial' | 'wrong', spoken: string): GradeOutcome {
  return {
    ok: true,
    grade: {
      result,
      missing: result === 'right' ? [] : ['a strap and the rollers'],
      inOrder: null,
      spoken,
      followUp: null,
      source: 'tutor',
      traceId: 'trace-sound',
      corrections: [],
    },
  }
}

describe('StudySession: sound effects', () => {
  it('right plays before the verdict', async () => {
    const { speech } = await started()
    speech.say('a mat a strap the rollers')
    await settle()
    expect(speech.said.slice(-2)).toEqual(['cue:right', 'Got it.'])
  })

  it('no sound on partial or wrong', async () => {
    for (const [result, line] of [
      ['partial', 'Almost. A mat, yes.'],
      ['wrong', 'Not quite. A mat, with a strap and the rollers.'],
    ] as const) {
      const h = make()
      h.client.grader = () => graded(result, line)
      void h.session.start()
      await settle()
      h.speech.say('pegs')
      await settle()
      expect(h.speech.said.at(-1)).toBe(line)
      expect(h.speech.cues).toEqual([])
    }
  })

  it('no sound on a revealed answer', async () => {
    const said = await started()
    said.speech.command("i don't know")
    await settle()
    expect(said.state().outcome).toMatchObject({ revealed: true })
    expect(said.speech.cues).toEqual([])
    const shown = await started()
    shown.session.showAnswer()
    await settle()
    expect(shown.state().outcome).toMatchObject({ revealed: true })
    expect(shown.speech.cues).toEqual([])
  })

  it('break plays before Take five', async () => {
    const { session, speech, clock, state } = await started()
    clock.advance(STUDY_STRETCH_MS)
    speech.say('a mat a strap the rollers')
    await settle()
    session.next()
    await settle()
    expect(state().screen).toBe('break')
    expect(speech.said.slice(-2)).toEqual(['cue:break', 'Take five.'])
  })

  it('no Take five once the learner is back to it during the break sound', async () => {
    const { session, speech, clock, state } = await started()
    clock.advance(STUDY_STRETCH_MS)
    speech.say('a mat a strap the rollers')
    await settle()
    speech.holdCues = true
    session.next()
    await settle()
    expect(speech.said.at(-1)).toBe('cue:break')
    void session.backToIt()
    await settle()
    expect(state().screen).toBe('card')
    expect(speech.spoken).not.toContain('Take five.')
  })

  it('done plays once', async () => {
    const { session, speech, state } = await started([SAMPLE_MOVE_A])
    speech.say('a mat a strap the rollers')
    await settle()
    session.next()
    await settle()
    expect(state().screen).toBe('done')
    expect(speech.said.slice(-2)).toEqual(['cue:done', 'Done for today. Nicely paced.'])
    void session.end()
    await settle()
    expect(speech.cues.filter((id) => id === 'done')).toHaveLength(1)
  })

  it('every hold says where listen-off would go and asks no listen-on (the controller plays neither)', async () => {
    const { session, speech } = await started()
    speech.hold('a mat')
    expect(speech.lastListen).toMatchObject({ endOn: 'release', cue: { end: true } })
    expect(speech.lastListen?.cue?.start).toBeUndefined()
    session.submitAnswer()
    await settle()
    session.report()
    await settle()
    speech.hold('the source says hooks')
    expect(speech.lastListen).toMatchObject({ endOn: 'release', cue: { end: true } })
    expect(speech.lastListen?.cue?.start).toBeUndefined()
  })

  it('Submit never cuts a sound still in flight', async () => {
    const { session, speech, state } = await started()
    speech.hold('a mat a strap the rollers')
    await settle()

    speech.holdCues = true
    void speech.cue('listen-off')
    const stopsBefore = speech.stops
    session.submitAnswer()
    expect(speech.keeps).toBe(1)
    expect(speech.stops).toBe(stopsBefore)
    expect(speech.soundPlaying).toBe(true)
    expect(state().screen).toBe('checking')

    speech.holdCues = false
    speech.endCue()
    await settle()
    expect(state().screen).toBe('result')
  })

  it('Send on This looks wrong never cuts a sound still in flight', async () => {
    const { session, speech, state } = await started()
    speech.say('a mat a strap the rollers')
    await settle()
    session.report()
    await settle()
    session.typeReport('the source says hooks')
    speech.holdCues = true
    speech.speakWaitsForSound = true
    void speech.cue('listen-off')
    const stopsBefore = speech.stops
    const keepsBefore = speech.keeps
    void session.sendReport()
    expect(speech.keeps).toBe(keepsBefore + 1)
    expect(speech.stops).toBe(stopsBefore)
    expect(speech.soundPlaying).toBe(true)
    expect(state().screen).toBe('report-sent')
    expect(speech.spoken).not.toContain('Thanks. It’s set aside.')

    speech.holdCues = false
    speech.endCue()
    await settle()
    expect(speech.spoken.at(-1)).toBe('Thanks. It’s set aside.')
  })

  it('letting go is theirs: release(), never stop()', async () => {
    const { session, speech } = await started()
    session.holdStart()
    const stopsBefore = speech.stops
    speech.partial = 'a mat'
    session.heard('a mat')
    session.holdEnd()
    expect(speech.releases).toBe(1)
    expect(speech.stops).toBe(stopsBefore)
  })

  it('space skips the right cue', async () => {
    const { session, speech, state } = await started()
    speech.holdCues = true
    speech.say('a mat a strap the rollers')
    await settle()
    expect(speech.said.at(-1)).toBe('cue:right')
    expect(state()).toMatchObject({ screen: 'result', speaking: true })
    session.key('space')
    await settle()
    expect(state()).toMatchObject({ screen: 'card', card: RSG })
    expect(speech.spoken).not.toContain('Got it.')
  })

  it('back to it stops whatever still plays on Take five or Paused', async () => {
    const { session, speech, state } = await started()
    speech.command('pause')
    await settle()
    expect(state().screen).toBe('paused')

    speech.holdCues = true
    void speech.cue('right')
    const stopsBefore = speech.stops
    void session.backToIt()
    await settle()
    expect(speech.stops).toBeGreaterThan(stopsBefore)
    expect(state()).toMatchObject({ screen: 'card', listening: false })
  })

  it('"skip" and "pause" let a sound in flight play out before stopping everything', async () => {
    for (const command of ['skip', 'pause'] as const) {
      const { speech, state } = await started()
      speech.holdIdle = true
      speech.command(command)
      await settle()
      const stopsBefore = speech.stops

      expect(speech.idles, command).toBe(1)
      expect(state().screen, command).toBe('card')
      speech.releaseIdle()
      await settle()
      expect(speech.stops, command).toBeGreaterThan(stopsBefore)
      expect(state().screen, command).toBe(command === 'skip' ? 'card' : 'paused')
      if (command === 'skip') expect(state().card, command).toEqual(RSG)
    }
  })

  it('"hint" and "repeat" don’t wait: the line they speak waits for the sound itself', async () => {
    for (const command of ['hint', 'repeat'] as const) {
      const h = await started()
      h.speech.holdIdle = true
      const spokenBefore = h.speech.spoken.length
      h.speech.command(command)
      await settle()
      expect(h.speech.idles, command).toBe(0)
      expect(h.speech.spoken.length, command).toBeGreaterThan(spokenBefore)
    }
  })
})

describe('StudySession: "pause" and spoken cues', () => {
  it('"pause" stops the recognizer: nothing listens while paused, and a hold there opens none', async () => {
    const { session, speech, state } = await started()
    session.holdStart()
    await settle()
    expect(speech.listening).toBe(true)
    speech.partial = 'pause'
    session.heard('pause')
    session.holdEnd()
    await settle()
    expect(state().screen).toBe('paused')
    expect(speech.listening).toBe(false)
    const listens = speech.listens.length
    session.holdStart()
    session.holdEnd()
    await settle()
    expect(speech.listening).toBe(false)
    expect(speech.listens).toHaveLength(listens)
  })

  it('after "pause" nothing moves on however long the learner waits; Back to it is the same card, and a hold listens on it', async () => {
    const { session, speech, client, clock, state } = await started()
    speech.command('pause')
    await settle()
    const asked = client.nextRequests.length
    clock.advance(30 * 60_000)
    await settle()
    expect(state()).toMatchObject({ screen: 'paused', card: SAMPLE_MOVE_A })
    expect(client.nextRequests).toHaveLength(asked)
    expect(client.gradeRequests).toHaveLength(0)
    expect(client.reviews).toHaveLength(0)
    void session.backToIt()
    await settle()
    expect(state()).toMatchObject({ screen: 'card', card: SAMPLE_MOVE_A })

    session.holdStart()
    await settle()
    expect(speech.listening).toBe(true)
    expect(state()).toMatchObject({ screen: 'card', card: SAMPLE_MOVE_A, listening: true })
  })
})
