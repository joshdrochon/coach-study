// The study session state machine: asks a card, listens, grades, rates and moves on.
// It talks to speech, the server and storage only through injected ports.

import { Rating as Fsrs, type Grade } from 'ts-fsrs'

import { proposeRating } from '../scheduler/rating'
import type { RatingInput } from '../scheduler/types'
import type { SoundId } from '../sound/catalog'
import {
  asCommand,
  words,
  type Clock,
  type Command,
  type ListenOptions,
  type ListenResult,
} from '../speech/controller'
import { RESULT_WORDS, revealLine, type HeadingWord, type RevealWord } from '../grader/words'
import { plainPunctuation } from '../text/punctuation'

import type { Correction } from '../grader/heard'

import type { AnswerEntry } from './entry'

import {
  StudyClientError,
  type CardFormat,
  type CardView,
  type FlagAnswer,
  type GradeResult,
  type GradedBy,
  type HomeView,
  type ItemType,
  type Rating,
  type SessionMode,
  type StudyClient,
  type StudyMode,
  type Today,
} from './client'

export const WORD_RATING: Record<GradeResult, Rating> = { right: 3, partial: 2, wrong: 1 }

export type RatingPolicy = {
  propose(
    result: GradeResult,
    answerMs: number,
    hintUsed: boolean,
    itemType: ItemType,
    format?: CardFormat,
    hintImposed?: boolean,
  ): Rating
}

const FROM_FSRS: Record<Grade, Rating> = {
  [Fsrs.Again]: 1,
  [Fsrs.Hard]: 2,
  [Fsrs.Good]: 3,
  [Fsrs.Easy]: 4,
}

export const defaultRatingPolicy: RatingPolicy = {
  propose(result, answerMs, hintUsed, itemType, format = 'free', hintImposed = false) {
    const answer: RatingInput = {
      correct: result,
      answerMs: Math.max(0, answerMs),
      hintUsed,
      itemType,
      format,
      hintImposed,
    }
    return FROM_FSRS[proposeRating(answer)]
  },
}

export function formatOf(card: CardView): CardFormat {
  return card.choices && card.choices.length > 0 ? 'choices' : 'free'
}

const NUMBER_NAMES = ['One', 'Two', 'Three', 'Four']
const ORDINALS = ['first', 'second', 'third', 'fourth']
const FILLER = new Set(['the', 'number', 'option', 'choice', 'answer', 'it', 'is', "it's"])

export function promptLine(card: CardView): string {
  const choices = card.choices ?? []
  if (choices.length === 0) return card.prompt
  const numbered = choices.map(
    (choice, i) => `${NUMBER_NAMES[i] ?? String(i + 1)}: ${choice.replace(/[.!?]?$/, '.')}`,
  )
  return [card.prompt, ...numbered].join(' ')
}

export function chosenBySpeech(card: CardView, transcript: string): string | undefined {
  const choices = card.choices ?? []
  const said = words(transcript).filter((word) => !FILLER.has(word))

  if (said.length === 2 && said[1] === '1' && ORDINALS.includes(said[0] ?? '')) said.pop()
  if (said.length !== 1) return undefined
  const [word = ''] = said
  if (ORDINALS.includes(word)) return choices[ORDINALS.indexOf(word)]
  if (!/^[1-4]$/.test(word)) return undefined
  const numbersInChoices = choices.some((choice) => words(choice).some((w) => /^\d+$/.test(w)))
  return numbersInChoices ? undefined : choices[Number(word) - 1]
}

export const STUDY_STRETCH_MS = 15 * 60_000
export const BREAK_MS = 5 * 60_000
export const REPORT_MAX_MS = 60_000

export const IDLE_MS = 5 * 60_000
export const MAX_ANSWER_CHARS = 2000

const SHORT_WORDS = new Set(['a', 'an', 'the', 'to', 'in', 'on', 'at', 'of', 'no', 'it', 'is'])

export function hintFor(card: CardView): string {
  const first = card.parts?.[0]
  if (card.parts && first !== undefined) {
    const n = card.parts.length
    const order = card.ordered ? ', in order' : ''
    return `${String(n)} ${n === 1 ? 'part' : 'parts'}${order}. The first is ${first}.`
  }
  const choices = card.choices ?? []
  if (choices.length > 0) {
    const answer = words(card.answer).join(' ')
    const right = choices.find((choice) => words(choice).join(' ') === answer)
    const wrong = choices.find((choice) => choice !== right)
    if (right && wrong) return `It isn’t “${wrong.replace(/[.!?]$/, '')}”.`
  }

  const opening = card.answer
    .trim()
    .replace(/^[A-Z][A-Za-z ]{0,24}:\s+/, '')
    .split(/\s+/)
  const take = SHORT_WORDS.has((opening[0] ?? '').toLowerCase()) ? 2 : 1
  const start = opening
    .slice(0, take)
    .join(' ')
    .replace(/[.,;:!?]+$/, '')
  return `It starts with “${start}…”`
}

function joinText(a: string, b: string): string {
  return `${a} ${b}`.trim()
}

export type SessionScreen =
  | 'loading'
  | 'card'
  | 'type'
  | 'checking'
  | 'result'
  | 'rating'
  | 'source'
  | 'self-grade'
  | 'mic-blocked'
  | 'paused'
  | 'break'
  | 'report'
  | 'report-sent'
  | 'done'
  | 'error'

export type Outcome = {
  result: GradeResult

  word: HeadingWord
  rating: Rating
  proposedRating: Rating

  spoken: string
  missing: string[]
  gradedBy: GradedBy
  traceId: string | null

  revealed: boolean

  corrections: Correction[]
}

export type SessionState = {
  screen: SessionScreen
  speaking: boolean
  listening: boolean
  card: CardView | null
  progress: { current: number; total: number } | null

  heard: string

  answer: string
  answerEntry: AnswerEntry
  hint: string | null
  outcome: Outcome | null

  redo: boolean

  micIssue: boolean

  note: string

  reportTyping: boolean
  reportDraft: string

  typing: boolean
  breakEndsAt: number | null
  summary: { cards: number; studyMs: number } | null
  home: HomeView | null

  signedOut: boolean
}

export const INITIAL_STATE: SessionState = {
  screen: 'loading',
  speaking: false,
  listening: false,
  card: null,
  progress: null,
  heard: '',
  answer: '',
  answerEntry: 'voice',
  hint: null,
  outcome: null,
  redo: false,
  micIssue: false,
  note: '',
  reportTyping: true,
  reportDraft: '',
  typing: false,
  breakEndsAt: null,
  summary: null,
  home: null,
  signedOut: false,
}

export type SpeechPort = {
  speak(text: string): Promise<{ ok: boolean; ms: number }>
  listen(options: ListenOptions): Promise<ListenResult>

  release(): void

  resume(): boolean

  cue(id: SoundId): Promise<void>

  idle(): Promise<void>

  stop(): void

  stopKeepingSound(): void
}

export type SessionDeps = {
  client: StudyClient
  speech: SpeechPort
  clock: Clock

  wakeLock: () => Promise<() => void>
  ratingPolicy?: RatingPolicy
  newId: () => string
}

export type SessionOptions = { mode: StudyMode; categories: string[] }

export type SessionKey = 'space' | 'enter' | 'escape'

type Pending = {
  card: CardView

  mode: SessionMode
  answerText: string
  answerMs: number
  hintUsed: boolean
  hintImposed: boolean
  reviewedAt: number

  entry: AnswerEntry
}

export class StudySession {
  private state: SessionState = INITIAL_STATE
  private readonly listeners = new Set<() => void>()
  private readonly policy: RatingPolicy
  private token = 0
  private active = false
  private release: (() => void) | null = null
  private wantLock = false
  private locking = false
  private today: Today | null = null

  private cardMode: SessionMode = 'start'
  private sinceFetch = 0
  private skipped: string[] = []
  private pending: Pending | null = null
  private answerStartedAt = 0

  private hintAsked = false
  private hintGivenFirst = false
  private get hintUsed(): boolean {
    return this.hintAsked || this.hintGivenFirst
  }

  private get hintImposed(): boolean {
    return this.hintGivenFirst && !this.hintAsked
  }

  private holding = false

  private openHold: Promise<void> | null = null
  private submitting = false
  private holdSeq = 0
  private dropUpTo = 0
  private kept = ''
  private live = ''
  private lastHeardAt = 0

  private idleTimer: number | undefined
  private idled = false

  private redoing = false

  private cardRead = false

  private answerBegun = false

  private doneCued = false
  private stretchStartedAt = 0
  private stretchPausedMs = 0
  private pausedAt: number | null = null
  private pausedFrom: SessionScreen | null = null
  private studiedMs = 0

  constructor(
    private readonly deps: SessionDeps,
    private readonly options: SessionOptions,
  ) {
    this.policy = deps.ratingPolicy ?? defaultRatingPolicy
  }

  getState = (): SessionState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async start(): Promise<void> {
    this.active = true
    this.today = null
    this.sinceFetch = 0
    this.skipped = []
    this.pending = null
    this.studiedMs = 0
    this.pausedAt = null
    this.doneCued = false
    this.beginStretch()
    this.set({ ...INITIAL_STATE, home: this.deps.client.cachedHome() })
    void this.holdLock()
    void this.deps.client
      .home()
      .then((home) => {
        if (this.active) this.set({ home })
      })
      .catch(() => undefined)
    await this.loadNext(true)
  }

  save(): void {
    void this.commit()
  }

  dispose(): void {
    if (!this.active) return
    void this.commit()
    this.active = false
    this.bump()
    this.deps.speech.stop()
    this.dropLock()
    this.stopIdleClock()
  }

  visible(): void {
    if (!this.wantLock || !this.active) return
    const stale = this.release
    this.release = null
    stale?.()
    void this.holdLock()
  }

  heard(text: string): void {
    const { screen } = this.state

    if ((screen !== 'card' && screen !== 'report') || this.holdSeq <= this.dropUpTo) return
    this.live = text
    if (text !== '') this.lastHeardAt = this.now()
    this.set({ heard: joinText(this.kept, text) })
  }

  key(key: SessionKey): void {
    this.wake()
    const { screen } = this.state
    if (key === 'escape') {
      if (screen === 'rating') this.cancelRating()
      else if (screen === 'source') this.closeSource()
      else if (screen === 'report') this.cancelReport()
      else if (screen !== 'done') void this.end()
      return
    }
    switch (screen) {
      case 'card':
        if (key === 'enter') this.submitAnswer()
        return
      case 'report':
        if (key === 'enter') void this.sendReport()
        return
      case 'result':
      case 'report-sent':
        void this.advance()
        return
      case 'break':
      case 'paused':
        void this.backToIt()
        return
      case 'mic-blocked':
        this.retryMic()
        return
      case 'error':
        void this.retry()
        return
      default:
        return
    }
  }

  holdStart(): void {
    const { screen, card, speaking } = this.state
    if ((screen !== 'card' && screen !== 'report') || !card || this.holding) return

    if (screen === 'report' && this.state.reportTyping) return
    this.wake()
    const choices = screen === 'card' && formatOf(card) === 'choices'

    if (!choices && this.openHold && this.holdSeq > this.dropUpTo && this.deps.speech.resume()) {
      this.holding = true
      this.set({ listening: true, micIssue: false })
      return
    }
    this.holding = true

    if (choices) {
      this.dropUpTo = this.holdSeq
      this.kept = ''
    }
    const id = ++this.holdSeq
    if (speaking) {
      this.bump()

      if (!this.cardRead) {
        this.answerStartedAt = this.now()
        this.answerBegun = true
      }
    }
    this.deps.speech.stop()
    this.live = ''

    this.set({ speaking: false, micIssue: false, heard: this.kept })
    const recorded = this.recordHold(id, screen, card)
    this.openHold = recorded
    void recorded.finally(() => {
      if (this.openHold === recorded) this.openHold = null
    })
  }

  holdEnd(): void {
    if (!this.holding) return
    this.wake()
    this.holding = false
    this.set({ listening: false })
    this.deps.speech.release()
  }

  clearAnswer(): void {
    this.wake()
    const { screen } = this.state
    if (screen !== 'card' && screen !== 'report') return
    this.dropHolds()
    this.set({ heard: '', listening: false, micIssue: false })
  }

  submitAnswer(): void {
    this.wake()
    if (this.submitting || this.state.screen !== 'card') return

    if (this.holding) this.holdEnd()
    const open = this.openHold
    if (open) {
      this.submitting = true
      void open.then(() => {
        this.submitting = false
        this.submitAnswer()
      })
      return
    }

    const { card, heard } = this.getState()
    const said = heard.trim()
    if (!card || said === '') return
    const finishedAt = this.lastHeardAt >= this.answerStartedAt ? this.lastHeardAt : this.now()
    this.dropHolds()
    const t = this.bump()

    this.deps.speech.stopKeepingSound()
    const chosen = chosenBySpeech(card, said)
    void this.grade(
      chosen ?? said,
      finishedAt - this.answerStartedAt,
      t,
      chosen ? 'choice' : 'voice',
    )
  }

  typeInstead(): void {
    this.wake()
    if (!this.state.card) return
    this.bump()
    this.dropHolds()
    this.deps.speech.stop()

    if (!this.cardRead && !this.answerBegun) {
      this.answerStartedAt = this.now()
      this.answerBegun = true
    }
    this.set({ screen: 'type', speaking: false, listening: false })
  }

  voiceInstead(): void {
    this.wake()
    if (this.state.screen !== 'type' || !this.state.card) return
    this.bump()
    this.dropHolds()
    this.deps.speech.stop()
    this.set({ screen: 'card', typing: false, speaking: false, listening: false, micIssue: false })
  }

  useTyping(): void {
    this.set({ typing: true })
    this.typeInstead()
  }

  retryMic(): void {
    this.wake()
    if (!this.state.card) return
    this.bump()
    this.dropHolds()
    this.set({ screen: 'card', typing: false, listening: false, micIssue: false })
  }

  submitTyped(answer: string): void {
    this.wake()
    if (this.state.screen !== 'type' || !this.state.card) return
    const t = this.bump()
    this.deps.speech.stop()
    void this.grade(answer.trim(), this.now() - this.answerStartedAt, t, 'typed')
  }

  choose(index: number): void {
    this.wake()
    const { screen, card } = this.state
    const choice = card?.choices?.[index]
    if ((screen !== 'card' && screen !== 'type') || choice === undefined) return
    const t = this.bump()
    this.dropHolds()
    this.deps.speech.stop()
    void this.grade(choice, this.now() - this.answerStartedAt, t, 'choice')
  }

  showAnswer(): void {
    this.wake()
    if (this.state.screen !== 'card' && this.state.screen !== 'type') return
    const t = this.bump()
    this.dropHolds()
    this.deps.speech.stop()
    void this.reveal(t, 'result', 'shown')
  }

  async replay(): Promise<void> {
    this.wake()
    const { screen, card } = this.state
    if (!card || this.holding) return
    if (screen === 'checking') {
      this.deps.speech.stop()
      await this.deps.speech.speak(promptLine(card))
      return
    }
    if (screen === 'result' || screen === 'self-grade') {
      const t = this.bump()
      this.deps.speech.stop()
      this.set({ speaking: true })
      await this.deps.speech.speak(promptLine(card))
      if (!this.alive(t)) return
      this.set({ speaking: false })
      this.awaitNext()
      return
    }
    if (screen !== 'card' && screen !== 'type') return
    const open = this.openHold
    if (open) {
      await open

      if (this.state.screen !== screen || this.state.card !== card || this.openHold !== null) return
    }
    const t = this.bump()
    this.deps.speech.stop()
    this.set({ speaking: true })
    if (!this.cardRead) {
      await this.readCard(card, card.hintFirst === true ? hintFor(card) : null, t)
      return
    }
    await this.deps.speech.speak(promptLine(card))
    if (this.alive(t)) this.set({ speaking: false })
  }

  next(): void {
    this.wake()
    const { screen } = this.state
    if (screen === 'result' || screen === 'report-sent') void this.advance()
  }

  async redo(): Promise<void> {
    this.wake()
    const { screen, card } = this.state
    if (screen !== 'result' || !card) return
    const t = this.bump()
    this.deps.speech.stop()
    await this.commit()
    if (!this.alive(t)) return
    this.redoing = true
    await this.present(card, t)
  }

  openRating(): void {
    this.wake()
    if (this.state.screen !== 'result' || !this.state.outcome || !this.pending) return
    this.bump()
    this.deps.speech.stop()
    this.set({ screen: 'rating', speaking: false, listening: false })
  }

  chooseWord(word: GradeResult): void {
    this.wake()
    const { screen, outcome } = this.state
    if (screen !== 'rating' || !outcome) return
    const rating =
      word === outcome.word
        ? outcome.rating
        : word === outcome.result
          ? outcome.proposedRating
          : WORD_RATING[word]
    this.backToResult({ ...outcome, word, rating })
  }

  cancelRating(): void {
    this.wake()
    if (this.state.screen === 'rating') this.backToResult()
  }

  selfRate(word: GradeResult): void {
    this.wake()
    if (this.state.screen !== 'self-grade' || (!this.pending && !this.redoing)) return
    const t = this.bump()
    const rating = WORD_RATING[word]
    this.set({
      screen: 'result',
      outcome: {
        result: word,
        word,
        rating,
        proposedRating: rating,
        spoken: `${RESULT_WORDS[word]}.`,
        missing: [],
        gradedBy: 'self',
        traceId: null,
        revealed: false,
        corrections: [],
      },
    })
    void this.speakOutcome(t)
  }

  openSource(): void {
    this.wake()
    if (this.state.screen !== 'result' || !this.state.outcome) return
    this.bump()
    this.deps.speech.stop()
    this.set({ screen: 'source', speaking: false, listening: false })
  }

  closeSource(): void {
    this.wake()
    if (this.state.screen === 'source') this.backToResult()
  }

  report(): void {
    this.wake()
    if (this.state.screen !== 'result' || !this.state.card) return
    this.bump()
    this.dropHolds()
    this.deps.speech.stop()
    this.set({
      screen: 'report',
      note: '',
      heard: '',
      reportTyping: true,
      reportDraft: '',
      speaking: false,
      listening: false,
      micIssue: false,
    })
  }

  typeReport(text: string): void {
    if (this.state.screen !== 'report') return
    this.wake()
    this.set({ reportDraft: text })
  }

  reportTypeInstead(typing: boolean): void {
    this.wake()
    if (this.state.screen !== 'report' || this.state.reportTyping === typing) return
    this.dropHolds()
    this.deps.speech.stop()

    this.kept = this.state.heard
    this.set({
      reportTyping: typing,
      reportDraft:
        typing && this.state.reportDraft === '' ? this.state.heard : this.state.reportDraft,
      listening: false,
      micIssue: false,
    })
  }

  async sendReport(): Promise<void> {
    this.wake()
    if (this.submitting || this.state.screen !== 'report') return

    if (this.state.reportTyping) {
      const typed = this.state.reportDraft.trim().slice(0, MAX_ANSWER_CHARS)
      const { card } = this.state
      if (!card || typed === '') return
      await this.sendNote(card.itemId, typed)
      return
    }

    if (this.holding) this.holdEnd()
    const open = this.openHold
    if (open) {
      this.submitting = true
      await open
      this.submitting = false
      await this.sendReport()
      return
    }

    const { card, heard } = this.getState()
    const note = heard.trim()
    if (!card || note === '') return
    await this.sendNote(card.itemId, note)
  }

  private async sendNote(itemId: string, note: string): Promise<void> {
    const t = this.bump()
    this.dropHolds()

    this.deps.speech.stopKeepingSound()
    void this.deps.client.flag(itemId, note, this.flaggedAnswer())
    this.set({
      screen: 'report-sent',
      note,
      heard: '',
      reportDraft: '',
      listening: false,
      speaking: true,
    })
    await this.deps.speech.speak('Thanks. It’s set aside.')
    if (!this.alive(t)) return
    this.set({ speaking: false })
    this.awaitNext()
  }

  private flaggedAnswer(): FlagAnswer | undefined {
    const pending = this.pending
    const outcome = this.state.outcome
    if (!pending || !outcome || pending.card.itemId !== this.state.card?.itemId) return undefined
    return {
      text: pending.answerText,
      reviewedAt: new Date(pending.reviewedAt).toISOString(),
      result: outcome.result,
      gradedBy: outcome.gradedBy,
      entry: pending.entry,
    }
  }

  cancelReport(): void {
    this.wake()
    if (this.state.screen !== 'report') return
    this.dropHolds()
    this.set({ note: '', heard: '', reportDraft: '' })
    this.backToResult()
  }

  async backToIt(): Promise<void> {
    const { screen } = this.state
    if (screen !== 'break' && screen !== 'paused') return

    this.deps.speech.stop()
    const now = this.now()
    if (screen === 'break') {
      this.beginStretch()
    } else if (this.pausedAt !== null) {
      this.stretchPausedMs += now - this.pausedAt
    }
    this.pausedAt = null
    const from = this.pausedFrom
    this.pausedFrom = null
    this.set({ breakEndsAt: null })
    void this.holdLock()
    const t = this.bump()
    if (
      screen === 'paused' &&
      this.state.outcome &&
      (from === 'result' || from === 'report-sent')
    ) {
      this.set({ screen: from })
      this.awaitNext()
      return
    }
    if (screen === 'paused' && this.state.card && (from === 'card' || from === 'type')) {
      await this.present(this.state.card, t)
      return
    }
    await this.loadNext(true)
  }

  async retry(): Promise<void> {
    if (this.state.screen === 'error') await this.loadNext(true)
  }

  pause(): void {
    const { screen } = this.state
    if (screen === 'paused' || screen === 'done' || screen === 'break') return
    this.bump()
    this.dropHolds()
    this.deps.speech.stop()
    this.pausedAt = this.now()
    this.pausedFrom = screen
    this.dropLock()
    this.set({ screen: 'paused', speaking: false, listening: false })
  }

  async end(): Promise<void> {
    if (this.state.screen === 'done') return
    const t = this.bump()
    this.dropHolds()
    this.deps.speech.stop()
    await this.commit()
    if (this.alive(t)) this.finish()
  }

  private async loadNext(showLoading: boolean): Promise<void> {
    const t = this.bump()
    this.deps.speech.stop()
    this.redoing = false
    if (showLoading || this.state.screen === 'error') {
      this.set({ screen: 'loading', speaking: false, listening: false, signedOut: false })
    }
    let next
    try {
      next = await this.deps.client.next({
        mode: this.options.mode,
        categories: this.options.categories,
        exclude: this.skipped,
      })
    } catch (error) {
      const signedOut = error instanceof StudyClientError && error.status === 401
      if (this.alive(t)) this.set({ screen: 'error', speaking: false, listening: false, signedOut })
      return
    }
    if (!this.alive(t)) return
    this.today = next.today
    this.sinceFetch = 0
    if (!next.card) {
      this.finish()
      return
    }
    this.cardMode = next.card.baseline === true ? 'baseline' : this.options.mode
    await this.present(next.card, t)
  }

  private async present(card: CardView, t: number): Promise<void> {
    this.pending = null
    this.hintAsked = false
    this.hintGivenFirst = card.hintFirst === true
    this.dropHolds()
    this.lastHeardAt = 0
    const hint = card.hintFirst === true ? hintFor(card) : null
    this.set({
      screen: this.state.typing ? 'type' : 'card',
      card,
      progress: this.progress(),
      heard: '',
      answer: '',
      hint,
      outcome: null,
      note: '',
      redo: this.redoing,
      micIssue: false,
      speaking: true,
      listening: false,
    })
    this.answerStartedAt = this.now()
    this.cardRead = false
    this.answerBegun = false
    await this.readCard(card, hint, t)
  }

  private async readCard(card: CardView, hint: string | null, t: number): Promise<void> {
    await this.deps.speech.speak(promptLine(card))
    if (!this.alive(t)) return
    if (hint !== null) {
      await this.deps.speech.speak(hint)
      if (!this.alive(t)) return
    }
    this.cardRead = true

    if (!this.answerBegun) this.answerStartedAt = this.now()
    this.set({ speaking: false })
    this.armIdle()
  }

  private async recordHold(id: number, screen: SessionScreen, card: CardView): Promise<void> {
    const heard = await this.deps.speech.listen({
      endOn: 'release',
      commands: false,
      cue: { end: true },
      onStart: () => {
        if (id === this.holdSeq && this.holding) this.set({ listening: true })
      },
      ...(screen === 'report' ? { maxMs: REPORT_MAX_MS } : {}),
    })
    if (id === this.holdSeq) {
      this.holding = false
      if (this.state.listening) this.set({ listening: false })
    }
    if (
      !this.active ||
      id <= this.dropUpTo ||
      this.state.screen !== screen ||
      this.state.card !== card
    ) {
      return
    }
    if (heard.endedBy === 'error') this.recognizerFailed(heard.error, screen)
    const said = heard.transcript.trim()
    const command = screen === 'card' ? asCommand(said) : undefined
    if (command) {
      if (id === this.holdSeq) this.live = ''
      this.set({ heard: joinText(this.kept, this.live) })
      const t = this.bump()

      if (command === 'skip' || command === 'pause') {
        await this.deps.speech.idle()
        if (!this.alive(t)) return
      }
      await this.command(command, t)
      return
    }
    if (this.state.screen !== screen) return
    this.kept = joinText(this.kept, said)
    if (id === this.holdSeq) this.live = ''
    this.set({ heard: joinText(this.kept, this.live) })
  }

  private dropHolds(): void {
    const open = this.holding || this.openHold !== null
    this.dropUpTo = this.holdSeq
    this.kept = ''
    this.live = ''
    this.holding = false

    if (open) this.deps.speech.stop()
  }

  private recognizerFailed(error: string | undefined, screen: SessionScreen): void {
    if (screen === 'card' && error === 'microphone-blocked') {
      this.set({ screen: 'mic-blocked', listening: false, speaking: false })
      return
    }

    if (screen === 'card' && error === 'unsupported') {
      this.set({ screen: 'type', listening: false, speaking: false, typing: true })
      return
    }

    this.set({ listening: false, micIssue: true })
  }

  private async command(command: Command, t: number): Promise<void> {
    const card = this.state.card
    if (!card) return
    switch (command) {
      case 'repeat':
        this.set({ speaking: true })
        await this.deps.speech.speak(promptLine(card))
        if (this.alive(t)) this.set({ speaking: false })
        return
      case 'hint': {
        const hint = hintFor(card)
        this.hintAsked = true
        this.set({ hint, speaking: true })
        await this.deps.speech.speak(hint)
        if (this.alive(t)) this.set({ speaking: false })
        return
      }
      case "i don't know":
        await this.reveal(t, 'result', 'okay')
        return
      case 'show source':
        await this.reveal(t, 'source', 'shown')
        return
      case 'skip':
        await this.skip()
        return
      case 'pause':
        this.pause()
        return
    }
  }

  private async reveal(t: number, screen: 'result' | 'source', word: RevealWord): Promise<void> {
    const card = this.state.card
    if (!card) return
    const answerMs = this.now() - this.answerStartedAt
    const proposed = this.policy.propose(
      'wrong',
      answerMs,
      this.hintUsed,
      card.type,
      formatOf(card),
      this.hintImposed,
    )
    this.pending = this.redoing
      ? null
      : {
          card,
          mode: this.cardMode,
          answerText: '',
          answerMs,
          hintUsed: this.hintUsed,
          hintImposed: this.hintImposed,
          reviewedAt: this.now(),
          entry: 'voice',
        }
    this.set({
      screen,
      answer: '',
      listening: false,
      outcome: {
        result: 'wrong',
        word,
        rating: proposed,
        proposedRating: proposed,
        spoken: revealLine(word, card.answer),
        missing: [],
        gradedBy: 'code',
        traceId: null,
        revealed: true,
        corrections: [],
      },
    })
    await this.speakOutcome(t)
  }

  private async grade(
    said: string,
    answerMs: number,
    t: number,
    entry: AnswerEntry,
  ): Promise<void> {
    const card = this.state.card
    if (!card) return
    const answer = said.slice(0, MAX_ANSWER_CHARS)
    this.set({
      screen: 'checking',
      answer,
      answerEntry: entry,
      heard: '',
      speaking: false,
      listening: false,
    })
    const graded = await this.deps.client.grade({
      itemId: card.itemId,
      answer,
      answerMs: Math.round(answerMs),
      hintUsed: this.hintUsed,
      entry,
    })
    if (!this.alive(t)) return

    this.pending = this.redoing
      ? null
      : {
          card,
          mode: this.cardMode,
          answerText: answer,
          answerMs,
          hintUsed: this.hintUsed,
          hintImposed: this.hintImposed,
          reviewedAt: this.now(),
          entry,
        }
    if (!graded.ok) {
      this.set({ screen: 'self-grade', outcome: null })
      return
    }
    const { grade } = graded
    const proposed = this.policy.propose(
      grade.result,
      answerMs,
      this.hintUsed,
      card.type,
      formatOf(card),
      this.hintImposed,
    )
    this.set({
      screen: 'result',
      outcome: {
        result: grade.result,
        word: grade.result,
        rating: proposed,
        proposedRating: proposed,
        spoken: grade.spoken,
        missing: grade.missing,
        gradedBy: grade.source,
        traceId: grade.traceId,
        revealed: false,

        corrections: entry === 'voice' ? grade.corrections : [],
      },
    })

    if (grade.result === 'right') {
      this.set({ speaking: true })
      await this.deps.speech.cue('right')
      if (!this.alive(t)) return
    }
    await this.speakOutcome(t)
  }

  private async speakOutcome(t: number): Promise<void> {
    const outcome = this.state.outcome
    if (!outcome) return
    this.set({ speaking: true })

    await this.deps.speech.speak(
      outcome.gradedBy === 'tutor' ? plainPunctuation(outcome.spoken) : outcome.spoken,
    )
    if (!this.alive(t)) return
    this.set({ speaking: false })
    this.awaitNext()
  }

  private awaitNext(): void {
    const from = this.state.screen
    if (from !== 'result' && from !== 'report-sent') return
    this.armIdle()
  }

  private backToResult(outcome?: Outcome): void {
    this.bump()
    this.deps.speech.stop()
    this.set({
      screen: 'result',
      outcome: outcome ?? this.state.outcome,
      speaking: false,
      listening: false,
    })
    this.awaitNext()
  }

  private async advance(): Promise<void> {
    const t = this.bump()
    this.deps.speech.stop()
    await this.commit()
    if (!this.alive(t)) return
    if (this.breakDue()) {
      this.takeBreak()
      return
    }
    await this.loadNext(false)
  }

  private async skip(): Promise<void> {
    const card = this.state.card
    if (card && !this.skipped.includes(card.itemId)) this.skipped = [...this.skipped, card.itemId]
    this.pending = null
    if (this.breakDue()) {
      this.bump()
      this.takeBreak()
      return
    }
    await this.loadNext(false)
  }

  private async commit(): Promise<void> {
    const pending = this.pending
    const outcome = this.state.outcome
    this.pending = null
    if (!pending || !outcome) return
    this.sinceFetch += 1
    await this.deps.client.review({
      eventId: this.deps.newId(),
      itemId: pending.card.itemId,
      mode: pending.mode,
      result: outcome.result,
      rating: outcome.rating,
      proposedRating: outcome.proposedRating,
      overridden: outcome.rating !== outcome.proposedRating,
      answerText: pending.answerText,
      answerMs: Math.max(0, Math.round(pending.answerMs)),
      hintUsed: pending.hintUsed,
      gradedBy: outcome.gradedBy,
      traceId: outcome.traceId,
      reviewedAt: new Date(pending.reviewedAt).toISOString(),

      ...(formatOf(pending.card) === 'choices' ? { format: 'choices' as const } : {}),
      ...(pending.hintImposed ? { hintImposed: true } : {}),
    })
  }

  private takeBreak(): void {
    this.studiedMs += this.stretchMs()
    this.dropLock()
    this.set({
      screen: 'break',
      breakEndsAt: this.now() + BREAK_MS,
      speaking: false,
      listening: false,
    })

    const t = this.token
    void this.deps.speech.cue('break').then(() => {
      if (this.alive(t) && this.state.screen === 'break') void this.deps.speech.speak('Take five.')
    })
  }

  private finish(): void {
    const t = this.bump()
    this.deps.speech.stop()
    const fromBreak = this.state.screen === 'break'
    const studyMs = this.studiedMs + (fromBreak ? 0 : this.stretchMs())
    this.dropLock()
    this.set({
      screen: 'done',
      summary: { cards: (this.today?.done ?? 0) + this.sinceFetch, studyMs },
      speaking: false,
      listening: false,
      breakEndsAt: null,
    })

    const chime = this.doneCued ? Promise.resolve() : this.deps.speech.cue('done')
    this.doneCued = true
    void chime.then(() => {
      if (this.alive(t)) void this.deps.speech.speak('Done for today. Nicely paced.')
    })
  }

  private progress(): SessionState['progress'] {
    const today = this.today
    if (!today) return null
    const total = today.done + today.due + today.newLeft
    return total > 0 ? { current: Math.min(today.done + 1, total), total } : null
  }

  private beginStretch(): void {
    this.stretchStartedAt = this.now()
    this.stretchPausedMs = 0
  }

  private stretchMs(): number {
    const now = this.now()
    const paused = this.stretchPausedMs + (this.pausedAt === null ? 0 : now - this.pausedAt)
    return Math.max(0, now - this.stretchStartedAt - paused)
  }

  private breakDue(): boolean {
    return this.stretchMs() >= STUDY_STRETCH_MS
  }

  private async holdLock(): Promise<void> {
    this.wantLock = true
    if (this.release || this.locking) return
    this.locking = true
    const release = await this.deps.wakeLock()
    this.locking = false

    if (this.keepsLock()) this.release = release
    else release()
  }

  private keepsLock(): boolean {
    return this.wantLock && this.active
  }

  private dropLock(): void {
    this.wantLock = false
    const release = this.release
    this.release = null
    release?.()
  }

  private armIdle(): void {
    this.stopIdleClock()
    this.idleTimer = this.deps.clock.setTimeout(() => {
      this.idleTimer = undefined
      this.goIdle()
    }, IDLE_MS)
  }

  private stopIdleClock(): void {
    if (this.idleTimer !== undefined) this.deps.clock.clearTimeout(this.idleTimer)
    this.idleTimer = undefined
  }

  private wake(): void {
    if (!this.active) return
    this.armIdle()
    if (this.idled) {
      this.idled = false
      void this.holdLock()
    }
  }

  private goIdle(): void {
    const { screen } = this.state
    if (!this.active) return
    if (this.holding) {
      this.armIdle()
      return
    }
    if (screen !== 'card' && screen !== 'result' && screen !== 'report-sent') return
    this.idled = true
    this.dropLock()
  }

  private now(): number {
    return this.deps.clock.now()
  }

  private bump(): number {
    this.token += 1
    return this.token
  }

  private alive(t: number): boolean {
    return this.active && t === this.token
  }

  private set(patch: Partial<SessionState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }
}
