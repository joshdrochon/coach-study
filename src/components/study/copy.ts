import { formatPercent } from '@/lib/dashboard/format'
import { dayLabel, dayNumber, SCHEDULE } from '@/lib/schedule'
import type { AnswerEntry } from '@/lib/study/entry'
import type { HomeView } from '@/lib/study/client'
import { progressLineEnabled } from '@/lib/study/flags'
import { paceStanding } from '@/lib/study/pace'

const NUMBER_WORDS = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
]

export function countWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n)
}

function plural(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`
}

export function cardCount(n: number): string {
  return plural(n, 'card', 'cards')
}

export function micPracticeCount(n: number): string {
  return plural(n, 'mic practice', 'mic practices')
}

type Countdown = Pick<HomeView, 'daysToPracticeDay' | 'daysToFirstClass'>

function micAhead(home: Countdown): boolean {
  return home.daysToPracticeDay >= 0
}

type HomeFacts = Countdown &
  Partial<Pick<HomeView, 'dueToday' | 'readiness' | 'paceStart' | 'studiedToday'>>

const FIRST_CLASS_DATE = dayLabel(SCHEDULE.firstClass)

export function progressLine(home: HomeFacts): string {
  const left = home.dueToday
  if (left === undefined) return ''
  const cards = left === 1 ? '1 card' : `${String(left)} cards`

  const s = left === 1 ? 's' : ''
  const readiness = home.readiness
  if (!readiness) {
    if (left > 0) return `Today’s ${cards} ${left === 1 ? 'is' : 'are'} what’s left.`
    return home.studiedToday ? 'Today’s cards are done.' : 'Nothing is due today.'
  }

  if (readiness.now === 0) {
    return left > 0 ? `Answer today’s ${cards} to see how ready you are.` : 'Nothing is due today.'
  }
  const there = `You’re ${formatPercent(readiness.now)} there`
  if (left === 0) {
    return `${there}. ${home.studiedToday ? 'Today’s cards are done.' : 'Nothing is due today.'}`
  }
  const whatsLeft = `Today’s ${cards} ${left === 1 ? 'is' : 'are'} what’s left.`
  if (home.paceStart === null || home.paceStart === undefined) return `${there}. ${whatsLeft}`
  const standing = paceStanding({
    now: readiness.now,
    afterToday: readiness.afterToday,
    start: home.paceStart,
    daysToFirstClass: home.daysToFirstClass,
  })
  const today = `Today’s ${cards}`
  switch (standing.pace) {
    case 'on':
      return standing.effect === 'keeps'
        ? `${there}. ${today} keep${s} you on pace for ${FIRST_CLASS_DATE}.`
        : `${there}, on pace for ${FIRST_CLASS_DATE}. ${whatsLeft}`
    case 'ahead':
      return standing.effect === 'keeps'
        ? `${there}, ahead of pace. ${today} keep${s} you there.`
        : `${there}, ahead of pace. ${whatsLeft}`
    case 'behind': {
      const behind = standing.far ? 'behind pace' : 'a bit behind pace'
      switch (standing.effect) {
        case 'catches-up':
          return `${there}, ${behind}. ${today} catch${s ? 'es' : ''} you up.`
        case 'closer':
          return `${there}, ${behind}. ${today} get${s} you closer.`
        default:
          return `${there}, ${behind}. ${whatsLeft}`
      }
    }
  }
}

export function homeHero(
  home: HomeFacts,
  progress: boolean = progressLineEnabled(),
): { headline: string; line: string } {
  const mic = home.daysToPracticeDay
  const first = home.daysToFirstClass
  if (micAhead(home)) {
    const firstIn =
      first === 1
        ? 'First coaching session tomorrow.'
        : `First coaching session in ${String(first)} days.`
    if (mic === 0) {
      return { headline: 'Practice day is today.', line: `Warm-up and main set. ${firstIn}` }
    }
    const days = mic === 1 ? 'One day' : `${countWord(mic)} days`
    return { headline: `${days} to practice day.`, line: `Warm-up and main set. ${firstIn}` }
  }
  const goal = progress ? progressLine(home) : 'Current goal: a good grasp of all the material.'
  if (first > 1) {
    return { headline: `${countWord(first)} days to your first coaching session.`, line: goal }
  }
  if (first === 1) return { headline: 'One day to your first coaching session.', line: goal }
  if (first === 0) return { headline: 'Your first coaching session is today.', line: goal }
  return { headline: 'Keep it all ready.', line: 'Every category at 90% ready.' }
}

export function milestoneLine(home: Countdown): string | null {
  const mic = home.daysToPracticeDay
  const first = home.daysToFirstClass
  if (micAhead(home)) {
    if (mic === 0) return 'Practice day is today.'
    return mic === 1 ? 'Tomorrow is practice day.' : `Practice day is in ${String(mic)} days.`
  }
  if (first > 1) return `Your first coaching session is in ${String(first)} days.`
  if (first === 1) return 'Tomorrow is your first coaching session.'
  if (first === 0) return 'Your first coaching session is today.'
  return null
}

export const WAITING_LINE = 'Your answers are saved on this iPad and will send when it reconnects.'

export function planLine(baseline: HomeView['baseline'] = null, cards?: number): string {
  const plan = baseline ? `Today’s plan · ${baseline.label} first` : 'Today’s plan'
  return cards === undefined ? plan : `${plan} · ${cardCount(cards)}`
}

export function seeAgain(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return `You’ll see this again in ${plural(minutes, 'minute', 'minutes')}.`
  const hours = Math.round(ms / 3_600_000)
  if (hours < 24) return `You’ll see this again in ${plural(hours, 'hour', 'hours')}.`
  const days = Math.round(ms / 86_400_000)
  return days === 1
    ? 'You’ll see this again tomorrow.'
    : `You’ll see this again in ${String(days)} days.`
}

export function studyTime(ms: number): string {
  const total = Math.max(1, Math.round(ms / 60_000))
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  if (hours === 0) return `${String(minutes)} min`
  return minutes === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(minutes)} min`
}

export function timer(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`
}

export function dateLabel(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

export function bestFor(date: Date): string {
  const day = date.getFullYear() * 10_000 + (date.getMonth() + 1) * 100 + date.getDate()
  for (const milestone of [SCHEDULE.practiceDay, SCHEDULE.firstClass]) {
    if (day <= dayNumber(milestone)) return `Best for ${dayLabel(milestone)} · recommended`
  }
  return 'Recommended'
}

export const QUESTION_XL_LINES = 3

export function questionStyleFor(height: number, lineHeight: number): 'question-xl' | 'headline-l' {
  const lines = lineHeight > 0 ? Math.round(height / lineHeight) : 1
  return lines > QUESTION_XL_LINES ? 'headline-l' : 'question-xl'
}

export const HEADLINE_STEPS = ['headline-xl', 'headline-l', 'headline-m'] as const
export type HeadlineStep = (typeof HEADLINE_STEPS)[number]

export function fittingHeadline(widths: readonly number[], column: number): HeadlineStep {
  const index = widths.findIndex((width) => width <= column + 0.5)
  return HEADLINE_STEPS[index] ?? 'headline-m'
}

export const LONG_QUESTION_CHARS = 80

export type AnswerRow = { label: string | null; value: string }

export function answerRows(answer: string): AnswerRow[] {
  const sentences = answer
    .trim()
    .split(/(?<=\.)\s+/)
    .filter(Boolean)
  const rows = sentences.map((sentence) =>
    /^([A-Z][A-Za-z]*(?: [A-Za-z]+){0,2}):\s+(.+?)\.?$/.exec(sentence),
  )
  if (sentences.length > 0 && rows.every((match) => match !== null)) {
    return rows.flatMap((match) =>
      match[1] && match[2]
        ? [{ label: match[1], value: `${match[2].charAt(0).toUpperCase()}${match[2].slice(1)}` }]
        : [],
    )
  }
  return [{ label: null, value: answer.trim() }]
}

export function quoted(text: string): string {
  return `“${text.trim()}”`
}

export function sameWords(container: string, part: string): boolean {
  const normal = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  const inner = normal(part)
  return inner !== '' && normal(container).includes(inner)
}

export const ENTRY_LABELS: Record<AnswerEntry, string> = {
  voice: 'You said',
  typed: 'You typed',
  choice: 'You chose',
}
