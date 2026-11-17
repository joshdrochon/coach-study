import { appliesIn, type Gate, type Rule } from '../gates'

import { findPhrase, firstOf, quoteOf, type Hit, type Word } from './match'
import { partGroup, sceneMoves, type Method, type Move, type PracticeScene } from './method'

// What the learner said, and when the learner moved on: marks[i] is when move i of the scene started.
export type Transcript = { words: Word[]; marks: number[]; doneAtMs: number }

export type CheckVerdict = 'pass' | 'miss' | 'not-applicable' | 'unjudged'

export type MoveResult = { moveId: string; name: string; ok: boolean }

export type CodeVerdict = {
  gateId: string
  verdict: CheckVerdict
  by: 'code' | 'tutor'
  quote: string | null
  note: string
  moves?: MoveResult[]
}

type Segment = { move: Move; words: Word[]; startMs: number; endMs: number }

export function segments(method: Method, scene: PracticeScene, t: Transcript): Segment[] {
  const moves = sceneMoves(method, scene)
  return moves.map((move, i) => {
    const startMs = t.marks[i] ?? t.doneAtMs
    const endMs = t.marks[i + 1] ?? t.doneAtMs
    const words = t.words.filter((word) => word.atMs >= startMs && word.atMs < endMs)
    return { move, words, startMs, endMs }
  })
}

function phrasesFor(method: Method, group: string, move: Move | null): readonly string[] {
  if (group.startsWith('move:')) return move?.say[group.slice('move:'.length)] ?? []
  return method.phrases[group] ?? []
}

type SayRule = Extract<Rule, { kind: 'say' }>

type SayResult = { ok: boolean; quote: string | null; missing: string[]; outOfOrder: boolean }

// One pass over the words for each part. In order, each part is looked for after the end of the
// one before it; a part said only earlier counts as out of order, not as missing.
export function checkSay(
  method: Method,
  rule: SayRule,
  words: readonly Word[],
  move: Move | null,
): SayResult {
  const hits: Hit[] = []
  const missing: string[] = []
  let outOfOrder = false
  let from = 0
  for (const part of rule.parts) {
    const { group, all } = partGroup(part)
    const phrases = phrasesFor(method, group, move)
    const wanted = all ? phrases.map((phrase) => [phrase]) : [phrases]
    for (const options of wanted) {
      const hit = firstOf(words, options, rule.ordered ? from : 0)
      if (hit) {
        hits.push(hit)
        if (rule.ordered) from = hit.to + 1
        continue
      }
      if (rule.ordered && firstOf(words, options, 0)) outOfOrder = true
      missing.push(all ? (options[0] ?? group) : group.replace(/^move:/, ''))
    }
  }
  const ok = missing.length === 0
  const quote = hits.length > 0 ? hits.map((hit) => quoteOf(words, hit)).join(' … ') : null
  return { ok, quote, missing, outOfOrder }
}

function windowed(segment: Omit<Segment, 'move'>, rule: SayRule): Word[] {
  if (!rule.window) return segment.words
  const { from, ms } = rule.window
  return from === 'start'
    ? segment.words.filter((word) => word.atMs < segment.startMs + ms)
    : segment.words.filter((word) => word.atMs >= segment.endMs - ms)
}

function sayVerdict(method: Method, gate: Gate, rule: SayRule, all: Segment[], t: Transcript) {
  if (rule.scope === 'practice') {
    const whole = { words: t.words, startMs: 0, endMs: t.doneAtMs }
    const result = checkSay(method, rule, windowed(whole, rule), null)
    return verdict(gate.id, result.ok, result.quote, result.ok ? 'Said' : missingNote(result))
  }
  const picked =
    rule.scope === 'first-move' ? all.slice(0, 1) : rule.scope === 'last-move' ? all.slice(-1) : all
  const results = picked.map((segment) => ({
    segment,
    result: checkSay(method, rule, windowed(segment, rule), segment.move),
  }))
  const ok = results.every((r) => r.result.ok)
  const quotes = results.flatMap((r) => (r.result.quote ? [r.result.quote] : []))
  const firstMiss = results.find((r) => !r.result.ok)
  const note = firstMiss
    ? `${firstMiss.segment.move.name}: ${missingNote(firstMiss.result)}`
    : `Said for ${results.map((r) => r.segment.move.name).join(', ')}`
  return {
    ...verdict(
      gate.id,
      ok,
      ok ? quotes.join(' / ') || null : (firstMiss?.result.quote ?? null),
      note,
    ),
    moves: results.map((r) => ({
      moveId: r.segment.move.id,
      name: r.segment.move.name,
      ok: r.result.ok,
    })),
  }
}

function missingNote(result: SayResult): string {
  return result.outOfOrder
    ? `Out of order: ${result.missing.join(', ')}`
    : `Not heard: ${result.missing.join(', ')}`
}

function verdict(gateId: string, ok: boolean, quote: string | null, note: string): CodeVerdict {
  return { gateId, verdict: ok ? 'pass' : 'miss', by: 'code', quote, note }
}

function avoidVerdict(method: Method, gate: Gate, group: string, t: Transcript): CodeVerdict {
  const hit = firstOf(t.words, method.phrases[group] ?? [])
  return hit
    ? verdict(gate.id, false, quoteOf(t.words, hit), `Said "${hit.phrase}"`)
    : verdict(gate.id, true, null, 'None heard')
}

// Counts every place a phrase of the group is said; overlapping hits are counted once.
export function countSaid(words: readonly Word[], phrases: readonly string[]): Hit[] {
  const hits = phrases
    .flatMap((phrase) => findPhrase(words, phrase))
    .sort((x, y) => x.from - y.from)
  const kept: Hit[] = []
  for (const hit of hits) {
    const last = kept.at(-1)
    if (!last || hit.from > last.to) kept.push(hit)
  }
  return kept
}

function repeatVerdict(method: Method, gate: Gate, group: string, atLeast: number, t: Transcript) {
  const hits = countSaid(t.words, method.phrases[group] ?? [])
  const ok = hits.length >= atLeast
  const first = hits[0]
  const quote = first ? quoteOf(t.words, first) : null
  return verdict(gate.id, ok, quote, `Said ${String(hits.length)} of ${String(atLeast)} times`)
}

// The code's verdict for every check of the checklist. Tutor checks come back unjudged here.
export function evaluate(method: Method, scene: PracticeScene, t: Transcript): CodeVerdict[] {
  const all = segments(method, scene, t)
  return method.checklist.gates.map((gate): CodeVerdict => {
    if (!appliesIn(gate, scene.kind)) {
      return {
        gateId: gate.id,
        verdict: 'not-applicable',
        by: 'code',
        quote: null,
        note: 'Not in this scene',
      }
    }
    const { rule } = gate
    switch (rule.kind) {
      case 'say':
        return sayVerdict(method, gate, rule, all, t)
      case 'avoid':
        return avoidVerdict(method, gate, rule.phrases, t)
      case 'repeat':
        return repeatVerdict(method, gate, rule.phrases, rule.atLeast, t)
      case 'tutor':
        return { gateId: gate.id, verdict: 'unjudged', by: 'tutor', quote: null, note: rule.ask }
    }
  })
}
