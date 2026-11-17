export type Support = {
  recognition: boolean
  getUserMedia: boolean
  mediaRecorder: boolean
  audioSession: boolean

  audioSessionType: string | null
  mode: 'Home Screen app' | 'Safari tab'
}

export type MicResult = 'pending' | 'ok' | 'failed' | 'unsupported' | 'released-early' | 'skipped'

export type HoldMode = 'recognize-and-record' | 'recognize-only'

export type VoiceMode = 'as-today' | 'with-fix' | 'reference'

export const VOICE_MODE_LABEL: Record<VoiceMode, string> = {
  'as-today': 'Play as today',
  'with-fix': 'Play with fix',
  reference: 'Play without using the mic first',
}

export type VoicePlay = {
  id: number
  mode: VoiceMode

  micUsed: boolean

  afterAttempt: number | null

  sessionApi: boolean
  sessionBefore: string | null
  sessionAfter: string | null

  result: 'asked' | 'ended' | 'failed' | 'error'

  by: 'app' | 'system' | null
  reason: string | null
  ms: number | null
  detail: string | null
}

export type PlaybackResult = 'not-played' | 'started' | 'ended' | 'error'

export type Attempt = {
  n: number

  recognition: 'unsupported' | 'waiting' | 'started'
  recognitionEnded: boolean

  endedWhileHeld: boolean
  recognitionError: string | null
  transcript: string

  mic: MicResult
  micDetail: string | null
  trackMutedAtStop: boolean | null
  muteEvents: number

  recorderStarted: boolean
  mimeType: string | null
  bytes: number | null
  durationMs: number | null
  recorderError: string | null

  playback: PlaybackResult
  playbackDetail: string | null
  clipSeconds: number | null
}

export type LabState = {
  attempts: Attempt[]
  holdMode: HoldMode
  voicePlays: VoicePlay[]
  holding: boolean

  recordingOf: number | null

  audioSession: string | null
}

export type LabEvent =
  | { type: 'opened'; audioSession: string | null }
  | { type: 'attempt-started'; n: number }
  | { type: 'hold-mode'; mode: HoldMode }
  | { type: 'hold-ended' }
  | { type: 'audio-session'; value: string | null }
  | { type: 'recognition-unsupported'; n: number }
  | { type: 'recognition-started'; n: number }
  | { type: 'transcript'; n: number; text: string }
  | { type: 'recognition-error'; n: number; error: string }
  | { type: 'recognition-ended'; n: number; whileHeld: boolean }
  | { type: 'mic'; n: number; result: Exclude<MicResult, 'pending'>; detail?: string }
  | { type: 'track-mute'; n: number }
  | { type: 'track-at-stop'; n: number; muted: boolean }
  | { type: 'recorder-started'; n: number; mimeType: string }
  | { type: 'recorder-error'; n: number; error: string }
  | { type: 'recorded'; n: number; bytes: number; durationMs: number; mimeType: string }
  | { type: 'cleared' }
  | { type: 'playback'; n: number; result: Exclude<PlaybackResult, 'not-played'>; detail?: string }
  | { type: 'clip-length'; n: number; seconds: number }
  | {
      type: 'voice-asked'
      id: number
      mode: VoiceMode
      micUsed: boolean
      afterAttempt: number | null
      sessionApi: boolean
      sessionBefore: string | null
      sessionAfter: string | null
    }
  | { type: 'voice-system'; id: number; reason: string }
  | { type: 'voice-over'; id: number; ok: boolean; ms: number }
  | { type: 'voice-error'; id: number; error: string }

export const initialLab: LabState = {
  attempts: [],
  holdMode: 'recognize-and-record',
  voicePlays: [],
  holding: false,
  recordingOf: null,
  audioSession: null,
}

export function newAttempt(n: number): Attempt {
  return {
    n,
    recognition: 'waiting',
    recognitionEnded: false,
    endedWhileHeld: false,
    recognitionError: null,
    transcript: '',
    mic: 'pending',
    micDetail: null,
    trackMutedAtStop: null,
    muteEvents: 0,
    recorderStarted: false,
    mimeType: null,
    bytes: null,
    durationMs: null,
    recorderError: null,
    playback: 'not-played',
    playbackDetail: null,
    clipSeconds: null,
  }
}

function update(state: LabState, n: number, change: (attempt: Attempt) => Attempt): LabState {
  if (!state.attempts.some((attempt) => attempt.n === n)) return state
  return {
    ...state,
    attempts: state.attempts.map((attempt) => (attempt.n === n ? change(attempt) : attempt)),
  }
}

function updatePlay(state: LabState, id: number, change: (play: VoicePlay) => VoicePlay): LabState {
  if (!state.voicePlays.some((play) => play.id === id)) return state
  return {
    ...state,
    voicePlays: state.voicePlays.map((play) => (play.id === id ? change(play) : play)),
  }
}

export function labReducer(state: LabState, event: LabEvent): LabState {
  switch (event.type) {
    case 'opened':
      return { ...state, audioSession: event.audioSession }
    case 'attempt-started':
      if (state.attempts.some((attempt) => attempt.n === event.n)) return state
      return { ...state, holding: true, attempts: [...state.attempts, newAttempt(event.n)] }
    case 'hold-mode':
      return { ...state, holdMode: event.mode }
    case 'hold-ended':
      return { ...state, holding: false }
    case 'audio-session':
      return { ...state, audioSession: event.value }
    case 'recognition-unsupported':
      return update(state, event.n, (a) => ({ ...a, recognition: 'unsupported' }))
    case 'recognition-started':
      return update(state, event.n, (a) => ({ ...a, recognition: 'started' }))
    case 'transcript':
      return update(state, event.n, (a) => ({ ...a, transcript: event.text }))
    case 'recognition-error':
      return update(state, event.n, (a) => ({ ...a, recognitionError: event.error }))
    case 'recognition-ended':
      return update(state, event.n, (a) => ({
        ...a,
        recognitionEnded: true,
        endedWhileHeld: a.endedWhileHeld || event.whileHeld,
      }))
    case 'mic':
      return update(state, event.n, (a) => ({
        ...a,
        mic: event.result,
        micDetail: event.detail ?? null,
      }))
    case 'track-mute':
      return update(state, event.n, (a) => ({ ...a, muteEvents: a.muteEvents + 1 }))
    case 'track-at-stop':
      return update(state, event.n, (a) => ({ ...a, trackMutedAtStop: event.muted }))
    case 'recorder-started':
      return update(state, event.n, (a) => ({
        ...a,
        recorderStarted: true,
        mimeType: event.mimeType || null,
      }))
    case 'recorder-error':
      return update(state, event.n, (a) => ({ ...a, recorderError: event.error }))
    case 'recorded': {
      const next = update(state, event.n, (a) => ({
        ...a,
        bytes: event.bytes,
        durationMs: event.durationMs,
        mimeType: event.mimeType || a.mimeType,
      }))

      return event.bytes > 0 ? { ...next, recordingOf: event.n } : next
    }
    case 'cleared':
      return { ...state, recordingOf: null }
    case 'playback':
      return update(state, event.n, (a) => ({
        ...a,
        playback: event.result,
        playbackDetail: event.detail ?? null,
      }))
    case 'clip-length':
      return update(state, event.n, (a) => ({ ...a, clipSeconds: event.seconds }))
    case 'voice-asked':
      if (state.voicePlays.some((play) => play.id === event.id)) return state
      return {
        ...state,
        voicePlays: [
          ...state.voicePlays,
          {
            id: event.id,
            mode: event.mode,
            micUsed: event.micUsed,
            afterAttempt: event.afterAttempt,
            sessionApi: event.sessionApi,
            sessionBefore: event.sessionBefore,
            sessionAfter: event.sessionAfter,
            result: 'asked',
            by: null,
            reason: null,
            ms: null,
            detail: null,
          },
        ],
      }
    case 'voice-system':
      return updatePlay(state, event.id, (p) => ({ ...p, by: 'system', reason: event.reason }))
    case 'voice-over':
      return updatePlay(state, event.id, (p) => ({
        ...p,
        result: event.ok ? 'ended' : 'failed',
        by: p.by ?? (event.ok ? 'app' : null),
        ms: event.ms,
      }))
    case 'voice-error':
      return updatePlay(state, event.id, (p) => ({ ...p, result: 'error', detail: event.error }))
  }
}

export type Row = { label: string; value: string }

const yesNo = (value: boolean): string => (value ? 'yes' : 'no')

export function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`
  return `${(bytes / 1024).toFixed(1)} KB`
}

export function secondsLabel(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`
}

export function errorLabel(error: unknown): string {
  if (error instanceof Error) {
    const name = error.name || 'Error'
    return error.message ? `${name}: ${error.message}` : name
  }
  if (typeof error === 'string' && error) return error
  return 'unknown error'
}

function recognitionLine(attempt: Attempt): string {
  if (attempt.recognition === 'unsupported') return 'not available in this browser'
  const started = `started: ${yesNo(attempt.recognition === 'started')}`
  const ended = `ended: ${attempt.recognitionEnded ? (attempt.endedWhileHeld ? 'yes, while held' : 'yes') : 'no'}`
  return `${started} · ${ended}`
}

function micLine(attempt: Attempt): string {
  switch (attempt.mic) {
    case 'pending':
      return 'asking…'
    case 'ok':
      return 'ok'
    case 'failed':
      return `failed: ${attempt.micDetail ?? 'unknown error'}`
    case 'unsupported':
      return 'not available in this browser'
    case 'released-early':
      return 'ok, but the learner let go before it opened'
    case 'skipped':
      return 'not used (recognition only)'
  }
}

function trackLine(attempt: Attempt): string {
  if (attempt.trackMutedAtStop === null && attempt.muteEvents === 0) return 'not read yet'
  const atStop =
    attempt.trackMutedAtStop === null
      ? 'muted at stop: not read'
      : `muted at stop: ${yesNo(attempt.trackMutedAtStop)}`
  return `${atStop} · mute events: ${attempt.muteEvents}`
}

function recordedLine(attempt: Attempt): string {
  if (attempt.mic === 'skipped') return 'not recording (recognition only)'
  if (attempt.bytes === null) return attempt.recorderStarted ? 'recording…' : 'nothing yet'
  const duration = attempt.durationMs === null ? '' : ` · ${secondsLabel(attempt.durationMs)} held`
  return `${bytesLabel(attempt.bytes)}${duration}${attempt.bytes === 0 ? ' (empty)' : ''}`
}

function playbackLine(attempt: Attempt): string {
  const clip = attempt.clipSeconds === null ? '' : ` · clip ${attempt.clipSeconds.toFixed(1)} s`
  switch (attempt.playback) {
    case 'not-played':
      return 'not played'
    case 'started':
      return `started, not ended yet${clip}`
    case 'ended':
      return `ended${clip}`
    case 'error':
      return `error: ${attempt.playbackDetail ?? 'unknown error'}`
  }
}

export function voicePlayLine(play: VoicePlay): string {
  const label = VOICE_MODE_LABEL[play.mode]
  const session =
    play.mode === 'with-fix'
      ? play.sessionApi
        ? `audio session set to playback (reads ${play.sessionAfter ?? 'nothing'})`
        : 'no audio session API, nothing set'
      : play.sessionApi
        ? `audio session left as is (${play.sessionBefore ?? 'unreadable'})`
        : 'no audio session API'
  const mic = play.micUsed
    ? `mic used before${play.afterAttempt === null ? '' : `, after attempt ${String(play.afterAttempt)}`}`
    : 'mic not used yet'
  let outcome: string
  if (play.result === 'asked') outcome = 'asking…'
  else if (play.result === 'error') outcome = `error: ${play.detail ?? 'unknown error'}`
  else if (play.by === 'system') {
    outcome = `the iPad’s own voice said it instead (${play.reason ?? 'unknown reason'}), so this play tests nothing`
  } else if (play.result === 'failed') outcome = 'failed or cut short'
  else outcome = `app voice, ended after ${secondsLabel(play.ms ?? 0)}`
  const reference =
    play.mode === 'reference' && play.micUsed
      ? ' · mic already used: reload for a true reference'
      : ''
  return `${label}: ${session} · ${mic} · ${outcome}${reference}`
}

export function diagnosticRows(state: LabState, support: Support | null): Row[] {
  const known = (value: (found: Support) => string) => (support ? value(support) : 'checking…')
  const rows: Row[] = [
    { label: 'Opened as', value: known((found) => found.mode) },
    { label: 'Speech recognition available', value: known((found) => yesNo(found.recognition)) },
    { label: 'getUserMedia available', value: known((found) => yesNo(found.getUserMedia)) },
    { label: 'MediaRecorder available', value: known((found) => yesNo(found.mediaRecorder)) },
    {
      label: 'Audio session',
      value: known((found) =>
        found.audioSession ? (state.audioSession ?? 'unreadable') : 'not available',
      ),
    },
  ]
  const play = state.voicePlays.at(-1)
  const voiceRow: Row = {
    label: 'Last voice play',
    value: play ? `${String(play.id)}. ${voicePlayLine(play)}` : 'no play yet',
  }
  const attempt = state.attempts.at(-1)
  rows.push({ label: 'Attempt', value: attempt ? String(attempt.n) : 'none yet' })
  if (!attempt) return [...rows, voiceRow]
  rows.push(
    { label: 'Holding', value: yesNo(state.holding) },
    { label: 'Recognition', value: recognitionLine(attempt) },
    { label: 'Recognition error', value: attempt.recognitionError ?? 'none' },
    { label: 'Transcript received', value: yesNo(attempt.transcript !== '') },
    { label: 'getUserMedia result', value: micLine(attempt) },
    { label: 'Mic track', value: trackLine(attempt) },
    {
      label: 'MediaRecorder mimeType',
      value:
        attempt.mic === 'skipped'
          ? 'not used (recognition only)'
          : (attempt.recorderError ?? attempt.mimeType ?? 'not started'),
    },
    { label: 'Recorded', value: recordedLine(attempt) },
    { label: 'Playback', value: playbackLine(attempt) },
    voiceRow,
  )
  return rows
}

export function attemptSummary(attempt: Attempt): string {
  const heard = attempt.recognitionError
    ? `error ${attempt.recognitionError}`
    : attempt.transcript !== ''
      ? 'words heard'
      : 'no words'
  const recorded =
    attempt.mic === 'skipped'
      ? 'recognition only'
      : attempt.mic === 'failed' || attempt.mic === 'unsupported'
        ? 'no recording'
        : attempt.bytes === null
          ? 'recording not finished'
          : attempt.bytes === 0
            ? 'recording empty'
            : `recorded ${bytesLabel(attempt.bytes)}`
  return `${heard} · ${recorded} · ${playbackLine(attempt)}`
}
