import {
  practiceReportSchema,
  sceneViewSchema,
  type PracticeReport,
  type PracticeRequest,
  type SceneView,
} from './contract'
import { typedWords, TYPED_WORD_MS, type Word } from './match'

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

export async function fetchScene(fetcher: Fetcher = fetch, id?: string): Promise<SceneView> {
  const url = id ? `/api/practice/scene?id=${encodeURIComponent(id)}` : '/api/practice/scene'
  const response = await fetcher(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`scene: ${String(response.status)}`)
  return sceneViewSchema.parse(await response.json())
}

export async function sendPractice(
  request: PracticeRequest,
  fetcher: Fetcher = fetch,
): Promise<PracticeReport> {
  const response = await fetcher('/api/tutor/practice', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!response.ok) throw new Error(`practice: ${String(response.status)}`)
  return practiceReportSchema.parse(await response.json())
}

// A spoken practice: the words as heard, and the taps that moved on to each move.
export function voiceRequest(
  scene: SceneView,
  words: readonly Word[],
  marks: readonly number[],
  doneAtMs: number,
): PracticeRequest {
  const lastWord = words.reduce((last, word) => Math.max(last, word.atMs), 0)
  const done = Math.max(doneAtMs, lastWord, ...marks)
  return {
    sceneId: scene.id,
    entry: 'voice',
    words: words
      .filter((word) => word.text.trim() !== '')
      .map((word) => ({ text: word.text.slice(0, 80), atMs: Math.round(word.atMs) })),
    marks: scene.moves.map((_, i) => Math.round(marks[i] ?? done)),
    doneAtMs: Math.round(done),
  }
}

// A typed practice: one text per move, laid end to end with even timings.
export function typedRequest(scene: SceneView, texts: readonly string[]): PracticeRequest {
  const words: Word[] = []
  const marks: number[] = []
  let at = 0
  scene.moves.forEach((_, i) => {
    marks.push(at)
    const moveWords = typedWords(texts[i] ?? '', at)
    words.push(...moveWords)
    at += Math.max(1, moveWords.length) * TYPED_WORD_MS
  })
  return { sceneId: scene.id, entry: 'typed', words, marks, doneAtMs: at }
}
