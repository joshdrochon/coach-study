// Finds text a rule doesn't cover yet (a pattern the voice would read literally).

import {
  SPOKEN_RULES,
  spokenChanges,
  spokenText,
  unspokenPatterns,
  type UnspokenKind,
} from './spoken'
import { SPOKEN_EXAMPLES } from './spoken-examples'

export type SpokenLine = { source: string; text: string }

export type SpokenPattern = {
  rule: string
  from: string
  to: string
  count: number
  sources: string[]
}

export type SpokenCalibration = {
  planted: number
  caught: number
  missed: string[]
  noise: string[]
}

export type SpokenReport = {
  lines: number
  sources: Record<string, number>

  changedLines: number

  patterns: SpokenPattern[]
  issues: string[]
  calibration?: SpokenCalibration
}

export const PLANTED_UNSPOKEN: readonly (readonly [string, UnspokenKind])[] = [
  ['Hold for 1:02:03.', 'time'],
  ['Hold for 1:75.', 'time'],
  ['Go 3.5-4 pounds.', 'range'],
  ['About ~5 seconds.', 'symbol'],
  ['Coach @ the front.', 'symbol'],
  ['Use 1/2 the bands.', 'slash'],
  ['Rest a min between sessions.', 'abbreviation'],
  ['The Q.R.S. watches.', 'dotted'],
  ['The CEO watches.', 'capitals'],
  ['Add 10kg.', 'glued'],
  ['Then R first.', 'side'],
]

const kindOf = (source: string) => source.split(':')[0] ?? source

export function checkSpoken(
  lines: readonly SpokenLine[],
  options: { calibrate?: boolean } = {},
): SpokenReport {
  const sources: Record<string, number> = {}
  const patterns = new Map<string, SpokenPattern>()
  const issues: string[] = []
  let changedLines = 0
  for (const line of lines) {
    const kind = kindOf(line.source)
    sources[kind] = (sources[kind] ?? 0) + 1
    const { spoken, changes } = spokenChanges(line.text)
    if (changes.length > 0) changedLines += 1
    for (const change of changes) {
      const key = `${change.rule}\n${change.from}\n${change.to}`
      const known = patterns.get(key) ?? { ...change, count: 0, sources: [] }
      known.count += 1
      if (!known.sources.includes(kind)) known.sources.push(kind)
      patterns.set(key, known)
    }
    for (const left of unspokenPatterns(spoken)) {
      issues.push(`${line.source}: no rule says ${left.kind} "${left.match}" in "${spoken}"`)
    }
  }
  const order = new Map(SPOKEN_RULES.map((rule, i) => [rule.id, i]))
  const report: SpokenReport = {
    lines: lines.length,
    sources,
    changedLines,
    patterns: [...patterns.values()].sort(
      (a, b) => (order.get(a.rule) ?? 0) - (order.get(b.rule) ?? 0) || b.count - a.count,
    ),
    issues,
  }
  if (options.calibrate) {
    report.calibration = calibrateSpoken(lines)
    for (const missed of report.calibration.missed) {
      issues.push(`spoken-text calibration: missed ${missed}`)
    }
    for (const noise of report.calibration.noise) issues.push(`spoken-text calibration: ${noise}`)
    if (report.calibration.planted === 0) issues.push('spoken-text calibration: nothing planted')
  }
  return report
}

export function calibrateSpoken(
  lines: readonly SpokenLine[],
  planted: readonly (readonly [string, UnspokenKind])[] = PLANTED_UNSPOKEN,
): SpokenCalibration {
  const result: SpokenCalibration = { planted: 0, caught: 0, missed: [], noise: [] }

  for (const rule of SPOKEN_RULES) {
    for (const [written] of SPOKEN_EXAMPLES[rule.id] ?? []) {
      result.planted += 1
      const said = spokenText(written)
      const seen = rule.id === 'clock' || unspokenPatterns(written).length > 0
      const clean = unspokenPatterns(said)
      if (seen && clean.length === 0) result.caught += 1
      else result.missed.push(`rule ${rule.id} on "${written}"`)
    }
  }

  const host = lines.find(
    (line) => line.text.trim() !== '' && unspokenPatterns(spokenText(line.text)).length === 0,
  )
  if (!host) {
    result.noise.push('no clean real line to plant into')
    return result
  }
  for (const [plant, kind] of planted) {
    result.planted += 1
    const report = checkSpoken([{ source: host.source, text: `${host.text} ${plant}` }])
    const found = report.issues.filter((issue) => issue.includes(` ${kind} "`))
    if (found.length > 0) result.caught += 1
    else result.missed.push(`planted ${kind} "${plant}" (in ${host.source})`)
    for (const issue of report.issues.filter((i) => !found.includes(i))) {
      result.noise.push(`planted ${kind}: ${issue}`)
    }
  }
  return result
}

export function spokenLine(report: SpokenReport): string {
  const sources = Object.entries(report.sources)
    .map(([kind, n]) => `${String(n)} ${kind}`)
    .join(', ')
  const uses = report.patterns.reduce((sum, p) => sum + p.count, 0)
  const cal = report.calibration
  const calibration = cal ? `; calibration ${String(cal.caught)}/${String(cal.planted)} caught` : ''
  return `spoken text: ${String(report.lines)} lines (${sources}), ${String(report.patterns.length)} written forms found ${String(uses)} times in ${String(report.changedLines)} lines, ${String(report.issues.length)} no rule says${calibration}`
}
