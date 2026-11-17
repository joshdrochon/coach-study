// Shows a card's source text. A quote is widened to whole sentences, and quotes from
// passages that continue one another are joined.

import { depthMark, MAX_DEPTH } from '../text/lines'

import { findSourceText } from './normalize'
import type { Passage } from './schema'

export type QuotedCitation = { readonly passageId: string; readonly quote: string }

export type PassageRuns = ReadonlyMap<string, readonly string[]>

export type CitationSource = {

  label: string

  text: string

  layout: string

  passageIds: string[]
}

export function sourceLabel(passage: Passage): string {
  return passage.kind === 'manual'
    ? `Manual p. ${String(passage.page)}`
    : `Video ${passage.timestamp}`
}

export function passageRuns(runs: readonly (readonly string[])[]): PassageRuns {
  const map = new Map<string, readonly string[]>()
  for (const run of runs) for (const id of run) map.set(id, run)
  return map
}

const NEEDS_MORE = new Set(
  (
    'a an the of to and or nor but with without within for from by at into onto than as per via ' +
    'about between among behind beneath toward towards under upon during if that which who whom ' +
    'whose because while when whenever where whether unless until although though is are was were ' +
    'be been being am will would can could should shall must may might do does did has have had ' +
    'not your their our its his her my this these those each every both either neither such very ' +
    'more most less least before after e.g. eg. i.e. ie. vs. pg. p. appx. approx.'
  ).split(' '),
)
const LIST_MARKER = /^\(?\d{1,2}[.)]$/

const NUMBER_STOP = /^\(?\d{1,2}\.$/

const NUMBER_WORD = /^\d+(?:-\p{L}|\p{L}|°)/u
const ELLIPSIS = /(?:\.\.\.?|…)["'’”)\]]*$/

const EXAMPLE = /^["'‘’“”([]*(?:i\.e\.|e\.g\.|ie\.|eg\.)/i

function bare(word: string): string {
  return word.toLowerCase().replace(/^["'‘’“”([]+/, '')
}

export function endsSentence(word: string): boolean {
  if (!/[.!?]["'’”)\]]*$/.test(word)) return false
  if (ELLIPSIS.test(word) || LIST_MARKER.test(word)) return false
  return !NEEDS_MORE.has(bare(word).replace(/[,;:]$/, ''))
}

export function needsMore(word: string): boolean {
  if (endsSentence(word)) return false
  if (LIST_MARKER.test(word) || ELLIPSIS.test(word)) return true
  if (/[,:;\-–—/(&+=]$/.test(word)) return true
  const last = bare(word).split('/').pop() ?? ''
  return NEEDS_MORE.has(last)
}

function firstLetter(word: string): string {
  return /^["'‘’“”([]*(\p{L})/u.exec(word)?.[1] ?? ''
}

export function bringsExample(word: string): boolean {
  return EXAMPLE.test(word)
}

export function opensQuote(word: string): boolean {
  return /^[([]*["'‘“]/.test(word)
}

const SUB_ITEM = /^[a-z]\.$/

export function startsLowercase(word: string): boolean {
  if (word.startsWith('[')) return false
  if (bringsExample(word)) return false

  if (SUB_ITEM.test(word)) return false
  const letter = firstLetter(word)
  return letter !== '' && letter !== letter.toUpperCase()
}

export function startsItem(word: string): boolean {
  if (NUMBER_STOP.test(word)) return true
  if (NUMBER_WORD.test(word)) return !/[,;]$/.test(word)
  if (bringsExample(word) || opensQuote(word)) return false
  const letter = firstLetter(word)
  if (letter === '' || letter === letter.toLowerCase()) return false
  if (word.startsWith('[')) return true
  const letters = word.replace(/[^\p{L}]/gu, '')
  return !(letters.length >= 2 && letters === letters.toUpperCase())
}

export function namePhrase(previous: string, word: string, next: string): boolean {
  const titled = (w: string) => /^["'‘“([]*\p{Lu}\p{Ll}/u.test(w)
  return NEEDS_MORE.has(bare(previous)) && titled(word) && titled(next)
}

export type NumberRole = 'item' | 'end'

function numberValue(word: string): number | null {
  return NUMBER_STOP.test(word) ? Number(word.replace(/\D/g, '')) : null
}

export function numberRoles(list: readonly string[]): (NumberRole | null)[] {
  const roles: (NumberRole | null)[] = []
  list.forEach((word, k) => {
    const value = numberValue(word)
    if (value === null) {
      roles.push(null)
      return
    }
    const previous = list[k - 1]
    const listed =
      value === 1
        ? list.slice(k + 1).some((later) => numberValue(later) === 2)
        : list.slice(0, k).some((earlier, j) => roles[j] === 'item' && numberValue(earlier) === value - 1)
    const item =
      previous === undefined ||
      roles[k - 1] === 'end' ||
      endsSentence(previous) ||
      previous.endsWith(':') ||
      listed
    roles.push(item ? 'item' : 'end')
  })
  return roles
}

export function endsAs(word: string, role: NumberRole | null | undefined): boolean {
  return role === 'end' || (role !== 'item' && endsSentence(word))
}

function needsMoreAs(word: string, role: NumberRole | null | undefined): boolean {
  if (role === 'end') return false
  return role === 'item' || needsMore(word)
}

export type EdgeRoles = { before?: NumberRole | null; after?: NumberRole | null }

export function unitBreak(before: string, after: string, roles: EdgeRoles = {}): boolean {
  if (NUMBER_STOP.test(after)) {
    if (roles.after === 'end') return false
    return endsAs(before, roles.before) || !needsMoreAs(before, roles.before)
  }
  return (
    endsAs(before, roles.before) || (!needsMoreAs(before, roles.before) && startsItem(after))
  )
}

export function headsItem(word: string, previous: string | undefined, role?: NumberRole | null): boolean {
  return /^\d{1,2}$/.test(word) && (previous === undefined || endsAs(previous, role))
}

export function outOfOrder(text: string): string | null {
  const list = text.split(/\s+/).filter((word) => word !== '')
  const roles = numberRoles(list)
  for (const [k, word] of list.entries()) {
    if (/\p{L}["“”]\p{L}/u.test(word)) return `a quotation mark inside "${word}"`
    const next = list[k + 1]
    if (next !== undefined && endsAs(word, roles[k]) && startsLowercase(next) && !next.startsWith('(')) {
      return `"${next}" starts a sentence after "${word}"`
    }
  }
  return null
}

export function carriesOn(word: string): boolean {
  return needsMore(word) && !ELLIPSIS.test(word) && !word.endsWith(':')
}

type Word = { start: number; end: number; text: string }

function words(text: string): Word[] {
  return [...text.matchAll(/\S+/g)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    text: match[0],
  }))
}

type Run = {
  ids: string[]
  text: string
  offsets: Map<string, number>
  passage: Passage

  table: boolean

  starts: { at: number; depth: number; breaks: boolean }[]
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function isTable(passage: Passage | undefined): boolean {
  return passage?.kind === 'manual' && passage.rows !== undefined
}

function lineStarts(
  passage: Passage | undefined,
  text: string,
  offset: number,
  carriesOn: boolean,
): Run['starts'] {
  if (passage?.kind !== 'manual' || passage.lines === undefined) return []
  const words = passage.lines.map(collapse)
  if (words.join(' ') !== text) return []
  let at = offset
  return passage.lines.map((line, k) => {
    const start = {
      at,
      depth: Math.min(MAX_DEPTH, /^\t*/.exec(line)?.[0].length ?? 0),
      breaks: !(carriesOn && k === 0),
    }
    at += (words[k]?.length ?? 0) + 1
    return start
  })
}

function layoutOf(run: Run, start: number, end: number): string {
  const inside = run.starts.filter((line) => line.breaks && line.at > start && line.at < end)
  const opening = run.starts.findLast((line) => line.at <= start)
  const cuts = [start, ...inside.map((line) => line.at), end]
  const depths = [opening?.depth ?? 0, ...inside.map((line) => line.depth)]
  const shallowest = Math.min(...depths)
  return cuts
    .slice(0, -1)
    .map((from, k) => {
      const line = run.text.slice(from, cuts[k + 1]).trim()
      return `${depthMark((depths[k] ?? 0) - shallowest)}${line}`
    })
    .join('\n')
}

function runOf(passage: Passage, passages: ReadonlyMap<string, Passage>, runs: PassageRuns): Run {
  const table = isTable(passage)
  const listed = table ? [passage.id] : (runs.get(passage.id) ?? [passage.id])
  const ids = listed.filter((id) => {
    const other = passages.get(id)
    if (other?.kind !== passage.kind) return false
    return other.kind === 'manual' && passage.kind === 'manual'
      ? other.page === passage.page
      : id === passage.id
  })
  const own = ids.includes(passage.id) ? ids : [passage.id]
  const offsets = new Map<string, number>()
  const starts: Run['starts'] = []
  let text = ''
  for (const [index, id] of own.entries()) {
    const part = collapse(passages.get(id)?.text ?? '')
    if (text !== '') text += ' '
    offsets.set(id, text.length)
    starts.push(...lineStarts(passages.get(id), part, text.length, index > 0))
    text += part
  }
  return {
    ids: own,
    text,
    offsets,
    passage: passages.get(own[0] ?? passage.id) ?? passage,
    table,
    starts,
  }
}

function quoteMarks(word: string): { single: number; double: number }[] {
  const lead = /^[([]*(["'‘“]+)/.exec(word)?.[1] ?? ''
  const rest = word.slice(word.indexOf(lead) + lead.length)
  const trail = rest === '' ? '' : (/(["'’”]+)[)\].,;:!?…]*$/.exec(rest)?.[1] ?? '')
  const count = (marks: string, single: RegExp) => {
    const singles = marks.match(single)?.length ?? 0
    return { single: singles, double: marks.length - singles }
  }
  return [count(lead, /['‘]/g), count(trail, /['’]/g)]
}

export function openQuotes(list: readonly string[]): { closers: number; openers: number } {
  let closers = 0
  let openers = 0
  for (const kind of ['single', 'double'] as const) {
    let depth = 0
    let lowest = 0
    for (const word of list) {
      const [opens, closes] = quoteMarks(word)
      depth += opens?.[kind] ?? 0
      depth -= closes?.[kind] ?? 0
      lowest = Math.min(lowest, depth)
    }
    closers += -lowest
    openers += depth - lowest
  }
  return { closers, openers }
}

function wordRange(list: readonly Word[], start: number, end: number): [number, number] {
  let first = list.findIndex((word) => word.end > start)
  if (first < 0) first = list.length - 1
  let last = list.length - 1
  for (let i = list.length - 1; i >= 0; i--) {
    if ((list[i]?.start ?? 0) < end) {
      last = i
      break
    }
  }
  return [first, Math.max(first, last)]
}

export function wholeWords(text: string, start: number, end: number): [number, number] {
  const list = words(text)
  if (list.length === 0) return [0, text.length]
  const [first, last] = wordRange(list, start, end)
  return [list[first]?.start ?? 0, list[last]?.end ?? text.length]
}

function joinedAt(texts: readonly string[], roles: readonly (NumberRole | null)[], i: number) {
  const at = (k: number) => texts[k] ?? ''
  return (
    !unitBreak(at(i), at(i + 1), { before: roles[i], after: roles[i + 1] }) ||
    namePhrase(at(i - 1), at(i), at(i + 1))
  )
}

export function wholeUnits(text: string, start: number, end: number): [number, number] {
  const list = words(text)
  if (list.length === 0) return [0, text.length]
  let [first, last] = wordRange(list, start, end)
  const texts = list.map((word) => word.text)
  const roles = numberRoles(texts)
  const joined = (i: number) => joinedAt(texts, roles, i)
  const back = () => {
    while (first > 0 && joined(first - 1)) first -= 1

    if (first > 0 && headsItem(texts[first - 1] ?? '', texts[first - 2], roles[first - 2])) {
      first -= 1
    }
  }
  const on = () => {
    while (last < list.length - 1 && joined(last)) last += 1
  }
  back()
  on()
  const unit = [first, last] as const
  const open = () => openQuotes(list.slice(first, last + 1).map((word) => word.text))
  for (let marks = open(); marks.closers + marks.openers > 0; marks = open()) {
    if (marks.closers > 0 && first > 0) {
      first -= 1
      back()
    } else if (marks.openers > 0 && last < list.length - 1) {
      last += 1
      on()
    } else {

      ;[first, last] = unit
      break
    }
  }
  return [list[first]?.start ?? 0, list[last]?.end ?? text.length]
}

export function textUnits(text: string): [number, number][] {
  const list = words(text)
  const texts = list.map((word) => word.text)
  const roles = numberRoles(texts)
  const units: [number, number][] = []
  let from = 0
  for (let i = 0; i < list.length; i++) {
    const end = i === list.length - 1
    const heading = i === from && headsItem(texts[i] ?? '', texts[i - 1], roles[i - 1])
    const open = openQuotes(texts.slice(from, i + 1)).openers > 0
    if (end || (!heading && !open && !joinedAt(texts, roles, i))) {
      units.push([list[from]?.start ?? 0, list[i]?.end ?? text.length])
      from = i + 1
    }
  }
  return units
}

type Span = { run: Run; start: number; end: number }

export function citationSources(
  citations: readonly QuotedCitation[],
  passages: ReadonlyMap<string, Passage>,
  runs: PassageRuns,
): CitationSource[] {
  const spans: Span[] = []
  const byRun = new Map<string, Run>()
  for (const citation of citations) {
    const passage = passages.get(citation.passageId)
    if (!passage) continue
    const fresh = runOf(passage, passages, runs)
    const key = fresh.ids.join(' ')
    const run = byRun.get(key) ?? fresh
    byRun.set(key, run)
    const offset = run.offsets.get(passage.id) ?? 0
    const own = collapse(passage.text)
    const inOwn = findSourceText(own, citation.quote)
    const onward = inOwn ? null : findSourceText(run.text.slice(offset), citation.quote)
    const [from, to] = inOwn
      ? [offset + inOwn[0], offset + inOwn[1]]
      : onward
        ? [offset + onward[0], offset + onward[1]]
        : [offset, offset + own.length]
    const [start, end] = run.table ? wholeWords(run.text, from, to) : wholeUnits(run.text, from, to)

    const joined = spans.find(
      (span) => span.run === run && start <= span.end + 1 && end >= span.start - 1,
    )
    if (joined) {
      joined.start = Math.min(joined.start, start)
      joined.end = Math.max(joined.end, end)
    } else {
      spans.push({ run, start, end })
    }
  }

  for (let merged = true; merged; ) {
    merged = false
    for (const span of spans) {
      const other = spans.find(
        (s) => s !== span && s.run === span.run && s.start <= span.end + 1 && s.end >= span.start - 1,
      )
      if (other) {
        span.start = Math.min(span.start, other.start)
        span.end = Math.max(span.end, other.end)
        spans.splice(spans.indexOf(other), 1)
        merged = true
        break
      }
    }
  }
  return spans.map(({ run, start, end }) => ({
    label: sourceLabel(run.passage),
    text: run.text.slice(start, end),
    layout: layoutOf(run, start, end),
    passageIds: run.ids.filter((id) => {
      const at = run.offsets.get(id) ?? 0
      const length = collapse(passages.get(id)?.text ?? '').length
      return at < end && at + length > start
    }),
  }))
}

export function displayedCitation(
  citations: readonly QuotedCitation[],
  passages: ReadonlyMap<string, Passage>,
  runs: PassageRuns,
): CitationSource | null {
  return citationSources(citations, passages, runs)[0] ?? null
}

function acrossRuns(
  citation: PlacedCitation,
  passages: ReadonlyMap<string, Passage>,
  runs: PassageRuns,
): string | null {
  const here = [...passages.values()].filter((passage) =>
    citation.kind === 'manual'
      ? passage.kind === 'manual' && passage.page === citation.page
      : passage.kind === 'video' && passage.timestamp === citation.timestamp,
  )
  const units: Run[] = []
  const seen = new Set<string>()
  for (const passage of here) {
    if (seen.has(passage.id)) continue
    const unit = runOf(passage, passages, runs)
    for (const id of unit.ids) seen.add(id)
    units.push(unit)
  }
  for (let from = 0; from < units.length; from++) {
    for (let to = from + 1; to < Math.min(units.length, from + 4); to++) {
      const group = units.slice(from, to + 1)
      let text = ''
      const starts: Run['starts'] = []
      for (const [index, unit] of group.entries()) {
        if (text !== '') text += ' '
        starts.push(...unit.starts.map((line) => ({ ...line, at: line.at + text.length })))
        if (index > 0 && !unit.starts.some((line) => line.at === 0)) {
          starts.push({ at: text.length, depth: 0, breaks: true })
        }
        text += unit.text
      }
      const found = findSourceText(text, citation.quote)
      if (!found) continue
      const passage = group[0]?.passage
      if (!passage) continue
      const run: Run = { ids: [], text, offsets: new Map(), passage, table: false, starts }
      return layoutOf(run, found[0], found[1])
    }
  }
  return null
}

export type PlacedCitation =
  | { readonly kind: 'manual'; readonly page: number; readonly quote: string }
  | { readonly kind: 'video'; readonly timestamp: string; readonly quote: string }

export function quotedSource(
  citation: PlacedCitation,
  passages: ReadonlyMap<string, Passage>,
  runs: PassageRuns,
): CitationSource {
  for (const passage of passages.values()) {
    const here =
      citation.kind === 'manual'
        ? passage.kind === 'manual' && passage.page === citation.page
        : passage.kind === 'video' && passage.timestamp === citation.timestamp
    if (!here) continue
    const run = runOf(passage, passages, runs)
    const offset = run.offsets.get(passage.id) ?? 0
    if (!findSourceText(run.text.slice(offset), citation.quote)) continue
    const [source] = citationSources([{ passageId: passage.id, quote: citation.quote }], passages, runs)
    if (source) return source
  }
  const label =
    citation.kind === 'manual' ? `Manual p. ${String(citation.page)}` : `Video ${citation.timestamp}`
  const text = collapse(citation.quote)
  return { label, text, layout: acrossRuns(citation, passages, runs) ?? text, passageIds: [] }
}
