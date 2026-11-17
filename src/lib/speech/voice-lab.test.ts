import { describe, expect, it } from 'vitest'

import {
  attemptSummary,
  bytesLabel,
  diagnosticRows,
  errorLabel,
  initialLab,
  labReducer,
  secondsLabel,
  voicePlayLine,
  type LabEvent,
  type LabState,
  type Support,
} from './voice-lab'

const run = (events: LabEvent[], from: LabState = initialLab): LabState =>
  events.reduce(labReducer, from)

const support: Support = {
  recognition: true,
  getUserMedia: true,
  mediaRecorder: true,
  audioSession: true,
  audioSessionType: 'auto',
  mode: 'Home Screen app',
}

const attemptOf = (state: LabState, index: number) => {
  const attempt = state.attempts[index]
  if (!attempt) throw new Error(`no attempt at ${index}`)
  return attempt
}

const row = (state: LabState, label: string) =>
  diagnosticRows(state, support).find((r) => r.label === label)?.value

const goodHold = (n: number): LabEvent[] => [
  { type: 'attempt-started', n },
  { type: 'recognition-started', n },
  { type: 'mic', n, result: 'ok' },
  { type: 'recorder-started', n, mimeType: 'audio/mp4' },
  { type: 'transcript', n, text: 'hello there' },
  { type: 'hold-ended' },
  { type: 'track-at-stop', n, muted: false },
  { type: 'recognition-ended', n, whileHeld: false },
  { type: 'recorded', n, bytes: 20480, durationMs: 3200, mimeType: 'audio/mp4' },
]

describe('the voice lab diagnostics', () => {
  it('starts empty: no attempt yet', () => {
    expect(row(initialLab, 'Attempt')).toBe('none yet')
    expect(row(initialLab, 'Recognition')).toBeUndefined()
    expect(row(initialLab, 'Audio session')).toBe('unreadable')
    expect(initialLab.recordingOf).toBeNull()
  })

  it('reports a good hold, row by row', () => {
    const state = run(goodHold(1))
    expect(row(state, 'Attempt')).toBe('1')
    expect(row(state, 'Holding')).toBe('no')
    expect(row(state, 'Recognition')).toBe('started: yes · ended: yes')
    expect(row(state, 'Recognition error')).toBe('none')
    expect(row(state, 'Transcript received')).toBe('yes')
    expect(row(state, 'getUserMedia result')).toBe('ok')
    expect(row(state, 'Mic track')).toBe('muted at stop: no · mute events: 0')
    expect(row(state, 'MediaRecorder mimeType')).toBe('audio/mp4')
    expect(row(state, 'Recorded')).toBe('20.0 KB · 3.2 s held')
    expect(row(state, 'Playback')).toBe('not played')
    expect(state.recordingOf).toBe(1)
  })

  it('shows the hold while it is in progress', () => {
    const state = run([
      { type: 'attempt-started', n: 1 },
      { type: 'recognition-started', n: 1 },
      { type: 'mic', n: 1, result: 'ok' },
      { type: 'recorder-started', n: 1, mimeType: 'audio/mp4' },
    ])
    expect(state.holding).toBe(true)
    expect(row(state, 'Holding')).toBe('yes')
    expect(row(state, 'Transcript received')).toBe('no')
    expect(row(state, 'Recorded')).toBe('recording…')
  })

  it('keeps one result per attempt and shows the newest in the live list', () => {
    const state = run([...goodHold(1), ...goodHold(2), { type: 'attempt-started', n: 3 }])
    expect(state.attempts.map((a) => a.n)).toEqual([1, 2, 3])
    expect(row(state, 'Attempt')).toBe('3')
    expect(row(state, 'Transcript received')).toBe('no')
    expect(attemptSummary(attemptOf(state, 0))).toBe('words heard · recorded 20.0 KB · not played')
  })

  it('does not start the same attempt twice', () => {
    const state = run([
      { type: 'attempt-started', n: 1 },
      { type: 'transcript', n: 1, text: 'kept' },
      { type: 'attempt-started', n: 1 },
    ])
    expect(state.attempts).toHaveLength(1)
    expect(attemptOf(state, 0).transcript).toBe('kept')
  })

  it('puts a late event on its own attempt (bug 326069: recognition ends after the next hold)', () => {
    const state = run([
      ...goodHold(1).slice(0, 6),
      { type: 'attempt-started', n: 2 },
      { type: 'recognition-ended', n: 1, whileHeld: false },
      { type: 'recognition-error', n: 1, error: 'no-speech' },
    ])
    expect(attemptOf(state, 0).recognitionEnded).toBe(true)
    expect(attemptOf(state, 0).recognitionError).toBe('no-speech')
    expect(attemptOf(state, 1).recognitionEnded).toBe(false)
    expect(attemptOf(state, 1).recognitionError).toBeNull()
  })

  it('ignores events for an attempt that does not exist', () => {
    const state = run([{ type: 'transcript', n: 9, text: 'lost' }])
    expect(state).toEqual(initialLab)
  })

  it('names a recognizer that ended on its own while the learner held', () => {
    const state = run([
      { type: 'attempt-started', n: 1 },
      { type: 'recognition-started', n: 1 },
      { type: 'recognition-ended', n: 1, whileHeld: true },
    ])
    expect(row(state, 'Recognition')).toBe('started: yes · ended: yes, while held')
  })

  it('reports a refused microphone and no recording', () => {
    const state = run([
      { type: 'attempt-started', n: 1 },
      { type: 'mic', n: 1, result: 'failed', detail: 'NotAllowedError: denied' },
      { type: 'recognition-error', n: 1, error: 'not-allowed' },
    ])
    expect(row(state, 'getUserMedia result')).toBe('failed: NotAllowedError: denied')
    expect(row(state, 'Recognition error')).toBe('not-allowed')
    expect(attemptSummary(attemptOf(state, 0))).toBe(
      'error not-allowed · no recording · not played',
    )
    expect(state.recordingOf).toBeNull()
  })

  it('treats an empty clip as silence, not a recording to play', () => {
    const state = run([
      { type: 'attempt-started', n: 1 },
      { type: 'mic', n: 1, result: 'ok' },
      { type: 'track-mute', n: 1 },
      { type: 'track-at-stop', n: 1, muted: true },
      { type: 'recorded', n: 1, bytes: 0, durationMs: 1500, mimeType: 'audio/mp4' },
    ])
    expect(row(state, 'Mic track')).toBe('muted at stop: yes · mute events: 1')
    expect(row(state, 'Recorded')).toBe('0 bytes · 1.5 s held (empty)')
    expect(state.recordingOf).toBeNull()
  })

  it('moves the recording to the newest clip and drops it on clear', () => {
    const two = run([...goodHold(1), ...goodHold(2)])
    expect(two.recordingOf).toBe(2)
    expect(labReducer(two, { type: 'cleared' }).recordingOf).toBeNull()
  })

  it('tracks playback: started, ended, clip length, and an error', () => {
    const played = run([
      ...goodHold(1),
      { type: 'playback', n: 1, result: 'started' },
      { type: 'clip-length', n: 1, seconds: 3.04 },
    ])
    expect(row(played, 'Playback')).toBe('started, not ended yet · clip 3.0 s')
    const ended = labReducer(played, { type: 'playback', n: 1, result: 'ended' })
    expect(row(ended, 'Playback')).toBe('ended · clip 3.0 s')
    const failed = run([
      ...goodHold(1),
      { type: 'playback', n: 1, result: 'error', detail: 'NotAllowedError' },
    ])
    expect(row(failed, 'Playback')).toBe('error: NotAllowedError')
  })

  it('shows what the browser lacks, never throws on missing pieces', () => {
    const bare: Support = {
      recognition: false,
      getUserMedia: false,
      mediaRecorder: false,
      audioSession: false,
      audioSessionType: null,
      mode: 'Safari tab',
    }
    const state = run([
      { type: 'attempt-started', n: 1 },
      { type: 'recognition-unsupported', n: 1 },
      { type: 'mic', n: 1, result: 'unsupported' },
    ])
    const rows = diagnosticRows(state, bare)
    expect(rows.find((r) => r.label === 'Audio session')?.value).toBe('not available')
    expect(rows.find((r) => r.label === 'Recognition')?.value).toBe('not available in this browser')
    expect(rows.find((r) => r.label === 'getUserMedia result')?.value).toBe(
      'not available in this browser',
    )

    const before = diagnosticRows(initialLab, null)
    expect(before.map((r) => r.label)).toEqual(
      diagnosticRows(initialLab, support).map((r) => r.label),
    )
    expect(before.find((r) => r.label === 'MediaRecorder available')?.value).toBe('checking…')
  })

  it('shows the audio session as read back after the page sets it', () => {
    const state = run([{ type: 'audio-session', value: 'play-and-record' }])
    expect(row(state, 'Audio session')).toBe('play-and-record')
    expect(row(run([{ type: 'audio-session', value: null }]), 'Audio session')).toBe('unreadable')
  })

  it('formats sizes, durations and errors', () => {
    expect(bytesLabel(900)).toBe('900 bytes')
    expect(bytesLabel(1536)).toBe('1.5 KB')
    expect(secondsLabel(2450)).toBe('2.5 s')
    expect(errorLabel(new DOMException('no mic', 'NotFoundError'))).toBe('NotFoundError: no mic')
    expect(errorLabel(new Error(''))).toBe('Error')
    expect(errorLabel('plain')).toBe('plain')
    expect(errorLabel(undefined)).toBe('unknown error')
  })

  it('starts in recognize-and-record and switches the hold mode', () => {
    expect(initialLab.holdMode).toBe('recognize-and-record')
    expect(run([{ type: 'hold-mode', mode: 'recognize-only' }]).holdMode).toBe('recognize-only')
  })

  it('a recognition-only hold uses no recorder and says so', () => {
    const state = run([
      { type: 'hold-mode', mode: 'recognize-only' },
      { type: 'attempt-started', n: 1 },
      { type: 'recognition-started', n: 1 },
      { type: 'mic', n: 1, result: 'skipped' },
      { type: 'transcript', n: 1, text: 'hello' },
      { type: 'hold-ended' },
      { type: 'recognition-ended', n: 1, whileHeld: false },
    ])
    expect(row(state, 'getUserMedia result')).toBe('not used (recognition only)')
    expect(row(state, 'MediaRecorder mimeType')).toBe('not used (recognition only)')
    expect(row(state, 'Recorded')).toBe('not recording (recognition only)')
    expect(attemptSummary(attemptOf(state, 0))).toBe('words heard · recognition only · not played')
    expect(state.recordingOf).toBeNull()
  })
})

describe('the app’s voice plays', () => {
  const playOf = (state: LabState, index: number) => {
    const play = state.voicePlays[index]
    if (!play) throw new Error(`no play at ${index}`)
    return play
  }
  const asked = (
    id: number,
    mode: 'as-today' | 'with-fix' | 'reference',
    extra: Partial<Extract<LabEvent, { type: 'voice-asked' }>> = {},
  ): LabEvent => ({
    type: 'voice-asked',
    id,
    mode,
    micUsed: true,
    afterAttempt: 2,
    sessionApi: true,
    sessionBefore: 'auto',
    sessionAfter: mode === 'with-fix' ? 'playback' : 'auto',
    ...extra,
  })

  it('shows none before the first play', () => {
    expect(row(initialLab, 'Last voice play')).toBe('no play yet')
    expect(row(run(goodHold(1)), 'Last voice play')).toBe('no play yet')
  })

  it('records each play with its mode, the audio session and the mic', () => {
    const state = run([
      asked(1, 'as-today'),
      { type: 'voice-over', id: 1, ok: true, ms: 2300 },
      asked(2, 'with-fix'),
      { type: 'voice-over', id: 2, ok: true, ms: 2100 },
    ])
    expect(state.voicePlays.map((p) => [p.id, p.mode, p.by, p.result])).toEqual([
      [1, 'as-today', 'app', 'ended'],
      [2, 'with-fix', 'app', 'ended'],
    ])
    expect(voicePlayLine(playOf(state, 0))).toBe(
      'Play as today: audio session left as is (auto) · mic used before, after attempt 2 · app voice, ended after 2.3 s',
    )
    expect(row(state, 'Last voice play')).toBe(
      '2. Play with fix: audio session set to playback (reads playback) · mic used before, after attempt 2 · app voice, ended after 2.1 s',
    )
  })

  it('says when there is no audio session API', () => {
    const none = asked(1, 'with-fix', {
      sessionApi: false,
      sessionBefore: null,
      sessionAfter: null,
    })
    const state = run([none, { type: 'voice-over', id: 1, ok: true, ms: 1000 }])
    expect(row(state, 'Last voice play')).toContain('no audio session API, nothing set')
    const today = run([asked(1, 'as-today', { sessionApi: false, sessionBefore: null })])
    expect(row(today, 'Last voice play')).toContain('no audio session API · mic used')
  })

  it('names a line the iPad’s own voice took, which tests nothing', () => {
    const state = run([
      asked(1, 'as-today'),
      { type: 'voice-system', id: 1, reason: 'status-503' },
      { type: 'voice-over', id: 1, ok: true, ms: 900 },
    ])
    expect(state.voicePlays[0]?.by).toBe('system')
    expect(row(state, 'Last voice play')).toContain(
      'the iPad’s own voice said it instead (status-503), so this play tests nothing',
    )
  })

  it('reports an error, a cut-short line and a line still being asked for', () => {
    expect(row(run([asked(1, 'as-today')]), 'Last voice play')).toContain('asking…')
    expect(
      row(
        run([asked(1, 'as-today'), { type: 'voice-error', id: 1, error: 'boom' }]),
        'Last voice play',
      ),
    ).toContain('error: boom')
    expect(
      row(
        run([asked(1, 'as-today'), { type: 'voice-over', id: 1, ok: false, ms: 300 }]),
        'Last voice play',
      ),
    ).toContain('failed or cut short')
  })

  it('flags a reference play taken after the mic was used, and not one taken before', () => {
    const after = run([asked(1, 'reference'), { type: 'voice-over', id: 1, ok: true, ms: 1500 }])
    expect(row(after, 'Last voice play')).toContain('mic already used: reload for a true reference')
    const before = run([
      asked(1, 'reference', { micUsed: false, afterAttempt: null }),
      { type: 'voice-over', id: 1, ok: true, ms: 1500 },
    ])
    expect(row(before, 'Last voice play')).toContain('mic not used yet')
    expect(row(before, 'Last voice play')).not.toContain('reload')
  })

  it('ignores a repeated ask and events for a play that does not exist', () => {
    const state = run([
      asked(1, 'as-today'),
      asked(1, 'with-fix'),
      { type: 'voice-over', id: 9, ok: true, ms: 1 },
    ])
    expect(state.voicePlays).toHaveLength(1)
    expect(state.voicePlays[0]?.mode).toBe('as-today')
    expect(state.voicePlays[0]?.result).toBe('asked')
  })
})
