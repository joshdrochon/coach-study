// Rewrites text for the voice: times, ranges, acronyms and abbreviations are said
// the way a person would say them. Rules are tried in order.

import { z } from 'zod'

import spokenData from '../../../content/method/spoken.json'

export const SPOKEN_VERSION = 2

type Match = RegExpExecArray

export type SpokenRule = {
  readonly id: string

  readonly says: string

  readonly pattern: RegExp

  readonly when?: (match: Match, text: string) => boolean
  readonly speak: (match: Match, text: string) => string
}

const g = (match: Match, n: number): string => match[n] ?? ''
const before = (match: Match, text: string): string => text.charAt(match.index - 1)
const after = (match: Match, text: string): string => text.slice(match.index + match[0].length)

function endsSentence(match: Match, text: string, numberStarts = false): boolean {
  return (numberStarts ? /^\s*(?:$|[A-Z“"‘\d])/ : /^\s*(?:$|[A-Z“"‘])/).test(after(match, text))
}

const CLOCK_AFTER = /^\s?(?:[aApP]\.?[mM]\.?(?![A-Za-z])|o['’]clock)/

function plural(n: number, unit: string): string {
  return `${String(n)} ${unit}${n === 1 ? '' : 's'}`
}

export function durationSaid(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes === 0) return plural(rest, 'second')
  return rest === 0
    ? plural(minutes, 'minute')
    : `${plural(minutes, 'minute')} ${plural(rest, 'second')}`
}

const secondsOf = (minutes: string, seconds: string) =>
  Number(minutes || '0') * 60 + Number(seconds)

function rangeSaid(from: number, to: number): string {
  if (from > 0 && from % 60 === 0 && to % 60 === 0) {
    return `${String(from / 60)} to ${plural(to / 60, 'minute')}`
  }
  if (from < 60 && to < 60) return `${String(from)} to ${plural(to, 'second')}`
  return `${durationSaid(from)} to ${durationSaid(to)}`
}

function standaloneTime(match: Match, text: string): boolean {
  return !/[\w:.]/.test(before(match, text)) && !/^[\d:]/.test(after(match, text))
}

const UNIT_AFTER = String.raw`(?:\s?(?:minutes?|mins?|seconds?|secs?)(?![A-Za-z]))?`
const TIME = String.raw`(\d{1,2})?:([0-5]\d)`

const acronymSchema = z.strictObject({
  letters: z.string().regex(/^[A-Z]{2,6}$/),
  say: z.string().min(1),
  dotted: z.boolean().optional(),
  before: z.string().optional(),
})
// How the voice says the source's acronyms: data (content/method/spoken.json), not code.
export const ACRONYM_LIST = z
  .strictObject({ acronyms: z.array(acronymSchema) })
  .parse(spokenData).acronyms
const ACRONYMS: Record<string, string> = Object.fromEntries(
  ACRONYM_LIST.map((entry) => [entry.letters, entry.say]),
)
const ACRONYM_PATTERN = ACRONYM_LIST.flatMap((entry) => {
  const ahead = entry.before === undefined ? '' : `(?=${entry.before})`
  const dotted = entry.dotted ? [`${entry.letters.split('').join(String.raw`\.`)}${ahead}`] : []
  return [...dotted, `${entry.letters}${ahead}`]
}).join('|')

const EMPHASIS = [
  'NO',
  'NOT',
  'CANNOT',
  'NEVER',
  'ALWAYS',
  'ONLY',
  'THEN',
  'OR',
  'AND',
  'SLOWLY',
  'ALL',
]

const LATIN: Record<string, string> = {
  'e.g': 'for example',
  'i.e': 'that is',
  etc: 'et cetera',
  vs: 'versus',
  'a.k.a': 'also known as',
  aka: 'also known as',
  appx: 'approximately',
  approx: 'approximately',
}

const UNITS: Record<string, string> = {
  lb: 'pound',
  lbs: 'pound',
  sec: 'second',
  secs: 'second',
  min: 'minute',
  mins: 'minute',
  hr: 'hour',
  hrs: 'hour',
}

const SLASH_PAIRS: Record<string, string> = {
  'up/down': 'up down',
  'and/or': 'and or',
}

const SIDE = { L: 'left', R: 'right' } as const
const sideOf = (letter: string) => (letter === 'L' ? SIDE.L : SIDE.R)
const BODY_PARTS =
  'foot|feet|knee|knees|hand|hands|arm|arms|leg|legs|side|elbow|elbows|hip|hips|shoulder|shoulders|wrist|ankle|forearm|forearms|toe|toes|glute|glutes'

function capitalLike(model: string, words: string): string {
  return /^[A-Z]/.test(model) ? words.charAt(0).toUpperCase() + words.slice(1) : words
}

export const SPOKEN_RULES: readonly SpokenRule[] = [
  {
    id: 'brackets',
    says: 'brackets are emphasis or a placeholder on screen, never said (Eleven v4 reads [words] as audio tags)',
    pattern: /\[([^\]\n]+)\]/g,
    speak: (m) => g(m, 1),
  },
  {
    id: 'acronym',
    says: `acronyms said as written in content/method/spoken.json: ${ACRONYM_LIST.map((entry) => entry.letters).join(', ')}`,
    pattern: new RegExp(String.raw`\b(${ACRONYM_PATTERN})\b(\.(?!\.))?`, 'g'),
    speak: (m, text) => {
      const word = ACRONYMS[g(m, 1).replaceAll('.', '')] ?? g(m, 1)
      return m[2] !== undefined && endsSentence(m, text) ? `${word}.` : word
    },
  },
  {
    id: 'emphasis',
    says: 'a word the source writes in capitals for emphasis said as the word (NO, THEN, SLOWLY)',
    pattern: new RegExp(String.raw`\b(?:${EMPHASIS.join('|')})\b`, 'g'),
    speak: (m) => m[0].toLowerCase(),
  },
  {
    id: 'latin',
    says: 'written abbreviations said in full: e.g., i.e., etc., vs., aka, appx.',
    pattern: /\b(e\.g|i\.e|etc|vs|a\.k\.a|aka|appx|approx)\b(\.(?!\.))?/gi,
    speak: (m, text) => {
      const words = capitalLike(g(m, 1), LATIN[g(m, 1).toLowerCase()] ?? g(m, 1))
      return m[2] !== undefined && endsSentence(m, text) ? `${words}.` : words
    },
  },
  {
    id: 'clock',
    says: 'a real clock time (am, pm, o’clock) stays as written',
    pattern: new RegExp(`${TIME}(?=\\s?(?:[aApP]\\.?[mM]|o['’]clock))`, 'g'),
    when: (m, text) => standaloneTime(m, text) && CLOCK_AFTER.test(after(m, text)),
    speak: (m) => m[0],
  },
  {
    id: 'time-range',
    says: 'a range of times m:ss-m:ss said in minutes and seconds',
    pattern: new RegExp(`${TIME}\\s?[-–]\\s?${TIME}${UNIT_AFTER}`, 'g'),
    when: (m, text) => standaloneTime(m, text) && !CLOCK_AFTER.test(after(m, text)),
    speak: (m) => rangeSaid(secondsOf(g(m, 1), g(m, 2)), secondsOf(g(m, 3), g(m, 4))),
  },
  {
    id: 'duration',
    says: 'a time m:ss is a length of time: minutes and seconds',
    pattern: new RegExp(`${TIME}${UNIT_AFTER}`, 'g'),
    when: (m, text) => standaloneTime(m, text) && !CLOCK_AFTER.test(after(m, text)),
    speak: (m) => durationSaid(secondsOf(g(m, 1), g(m, 2))),
  },
  {
    id: 'page',
    says: 'p. and pp. said as page and pages',
    pattern: /\b(pp?|pg)\.?\s?(\d+)(?:\s?[-–]\s?(\d+))?\b/gi,
    when: (m) => m[0].includes('.') || /^pg$/i.test(g(m, 1)),
    speak: (m) =>
      m[3] === undefined
        ? capitalLike(g(m, 1), `page ${g(m, 2)}`)
        : capitalLike(g(m, 1), `pages ${g(m, 2)} to ${g(m, 3)}`),
  },
  {
    id: 'number-range',
    says: 'a range of numbers said with "to": 8-10 is 8 to 10',
    pattern: /(\d+)\s?[-–]\s?(\d+)\b/g,
    when: (m, text) =>
      !/[\w.,:–-]/.test(before(m, text)) && !/^(?:[:.]\d|[-–]\d)/.test(after(m, text)),
    speak: (m) => `${g(m, 1)} to ${g(m, 2)}`,
  },
  {
    id: 'compare',
    says: '<, >, ≤ and ≥ before a number said as under, over, at most and at least',
    pattern: /([<>≤≥])\s?(\d)/g,
    speak: (m) => {
      const word = { '<': 'under', '>': 'over', '≤': 'at most', '≥': 'at least' }[g(m, 1)] ?? ''
      return `${word} ${g(m, 2)}`
    },
  },
  {
    id: 'plus',
    says: "+ that joins two things said as and (salt + pepper is salt and pepper); a number's own 50+ is 50 plus",
    pattern: /(\d+)\+(?=$|[\s.,;:!?)])|\s\+\s|(\d+)\+(\d)/g,
    speak: (m) => {
      if (m[1] !== undefined) return `${g(m, 1)} plus`
      if (m[2] !== undefined) return `${g(m, 2)} and ${g(m, 3)}`
      return ' and '
    },
  },
  {
    id: 'percent',
    says: '% after a number said as percent',
    pattern: /(\d+)\s?%/g,
    speak: (m) => `${g(m, 1)} percent`,
  },
  {
    id: 'degrees',
    says: '° after a number said as degrees (degree before a word: a 45 degree angle)',
    pattern: /(\d+)\s?°/g,
    speak: (m, text) => `${g(m, 1)} ${/^\s+[A-Za-z]/.test(after(m, text)) ? 'degree' : 'degrees'}`,
  },
  {
    id: 'ampersand',
    says: '& said as and',
    pattern: /\s?&\s?/g,
    speak: () => ' and ',
  },
  {
    id: 'equals',
    says: '= said as equals',
    pattern: /\s?=\s?/g,
    speak: () => ' equals ',
  },
  {
    id: 'number-sign',
    says: '# before a number said as number',
    pattern: /#\s?(\d)/g,
    speak: (m) => `number ${g(m, 1)}`,
  },
  {
    id: 'times',
    says: 'x2, 2x and 2 × 3 said with times',
    pattern: /\b[xX](\d+)\b|\b(\d+)[xX]\b|(\d)\s?×\s?(\d)/g,
    speak: (m) => {
      if (m[1] !== undefined) return `${g(m, 1)} times`
      if (m[2] !== undefined) return `${g(m, 2)} times`
      return `${g(m, 3)} times ${g(m, 4)}`
    },
  },
  {
    id: 'unit',
    says: 'lbs, sec, min and hrs after a number said in full',
    pattern: /(\d+(?:\.\d+)?)\s?(lbs|lb|secs|sec|mins|min|hrs|hr)\b(\.(?!\.))?/g,
    speak: (m, text) => {
      const unit = UNITS[g(m, 2)] ?? g(m, 2)
      const words = `${g(m, 1)} ${unit}${g(m, 1) === '1' ? '' : 's'}`
      return m[3] !== undefined && endsSentence(m, text, true) ? `${words}.` : words
    },
  },
  {
    id: 'pounds',
    says: 'lbs on its own said as pounds',
    pattern: /\blbs?\b(\.(?!\.))?/g,
    speak: (m, text) => (m[1] !== undefined && endsSentence(m, text) ? 'pounds.' : 'pounds'),
  },
  {
    id: 'side',
    says: 'L and R as a side said as left and right',
    pattern: new RegExp(
      String.raw`\b([LR])\/([LR])\b|\b(on the|on your|to the|of|behind) ([LR])\b|\b([LR]) (${BODY_PARTS})\b`,
      'g',
    ),
    speak: (m) => {
      if (m[1] !== undefined) return `${sideOf(g(m, 1))} or ${sideOf(g(m, 2))}`
      if (m[3] !== undefined) return `${g(m, 3)} ${sideOf(g(m, 4))}`
      return `${sideOf(g(m, 5))} ${g(m, 6)}`
    },
  },
  {
    id: 'slash',
    says: 'a slash between words said as or (up/down as up down, and/or as and or)',
    pattern: /\b[A-Za-z]+(?:\/[A-Za-z]+)+\b/g,
    speak: (m) => {
      const pair = SLASH_PAIRS[m[0].toLowerCase()]
      if (pair !== undefined) return capitalLike(m[0], pair)
      const words = m[0].split('/')
      const last = words.pop() ?? ''
      return `${words.join(', ')} or ${last}`
    },
  },
  {
    id: 'countdown',
    says: 'a countdown written 3,2,1 said as 3, 2, 1 (never three thousand two hundred twenty-one)',
    pattern: /\b\d(?:,\d)+\b/g,
    speak: (m) => m[0].split(',').join(', '),
  },
  {
    id: 'list',
    says: 'a numbered list item "1." said as "1," (a short pause, never "first" or a decimal)',
    pattern: /(^|[.!?]\s+|\n\s*|[“"])(\d{1,2})\.\s+(?=[A-Z“"‘])/g,
    speak: (m) => `${g(m, 1)}${g(m, 2)}, `,
  },
  {
    id: 'glued',
    says: 'a word run into a number said apart: Room12 is Room 12',
    pattern: /\b([A-Za-z]{3,})(\d+)\b/g,
    speak: (m) => `${g(m, 1)} ${g(m, 2)}`,
  },
]

export type SpokenChange = { rule: string; from: string; to: string }

function applyRule(text: string, rule: SpokenRule, changes?: SpokenChange[]): string {
  let out = ''
  let at = 0
  for (const match of text.matchAll(rule.pattern)) {
    if (rule.when && !rule.when(match, text)) continue
    const to = rule.speak(match, text)
    out += text.slice(at, match.index) + to
    at = match.index + match[0].length
    changes?.push({ rule: rule.id, from: match[0].trim(), to: to.trim() })
  }
  return out + text.slice(at)
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function spokenText(text: string, rules: readonly SpokenRule[] = SPOKEN_RULES): string {
  let out = text
  for (const rule of rules) out = applyRule(out, rule, undefined)
  return collapse(out)
}

export function spokenChanges(text: string): { spoken: string; changes: SpokenChange[] } {
  const changes: SpokenChange[] = []
  let out = text
  for (const rule of SPOKEN_RULES) out = applyRule(out, rule, changes)
  return { spoken: collapse(out), changes }
}

export type UnspokenKind =
  | 'time'
  | 'range'
  | 'symbol'
  | 'slash'
  | 'bracket'
  | 'abbreviation'
  | 'dotted'
  | 'capitals'
  | 'glued'
  | 'side'
  | 'countdown'
  | 'list'

export type Unspoken = { kind: UnspokenKind; match: string }

export const SAID_AS_LETTERS: ReadonlySet<string> = new Set(['PT', 'BMI', 'QA'])

const UNSPOKEN: readonly (readonly [UnspokenKind, RegExp])[] = [
  ['time', /\d*:\d+/g],
  ['range', /\d\s?[-–]\s?\d/g],
  ['symbol', /[<>≤≥+%°&=#@~*^|\\×$€£_{}]/g],
  ['slash', /\//g],
  ['bracket', /[[\]]/g],
  ['abbreviation', /\b(?:lbs?|secs?|mins?|hrs?|appx|approx|etc|aka|vs|pp?\.|pg)(?![A-Za-z])/gi],
  ['dotted', /\b(?:[A-Za-z]\.){2,}/g],
  ['capitals', /\b[A-Z]{2,}\b/g],
  ['glued', /\b\d+[A-Za-z]+\b|\b[A-Za-z]+\d+\b/g],
  ['side', /\b[LR]\b/g],
  ['countdown', /\b\d,\d\b/g],
  ['list', /(?:^|[.!?]\s+|[“"])\d{1,2}\.\s/g],
]

const CLOCK_TIME = /\b\d{1,2}:[0-5]\d\s?(?:[aApP]\.?[mM]\.?(?![A-Za-z])|o['’]clock)/g

function allowed(kind: UnspokenKind, match: string): boolean {
  if (kind === 'capitals') return SAID_AS_LETTERS.has(match)
  if (kind === 'glued') return /^\d+(?:st|nd|rd|th)$/.test(match)
  return false
}

export function unspokenPatterns(text: string): Unspoken[] {
  const found: Unspoken[] = []
  const unclocked = text.replace(CLOCK_TIME, ' ')
  for (const [kind, pattern] of UNSPOKEN) {
    for (const match of unclocked.matchAll(pattern)) {
      const written = match[0].trim()
      if (!allowed(kind, written)) found.push({ kind, match: written })
    }
  }
  return found
}
