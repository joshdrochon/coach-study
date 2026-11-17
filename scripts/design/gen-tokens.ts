// pnpm tokens: generates the CSS and TS token files from design/tokens.json.
// --check fails when the committed files are stale.

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const named = z.object({ name: z.string(), value: z.string(), usage: z.string().optional() })
const typeStyle = z.object({
  name: z.string(),
  fontSize: z.string(),
  lineHeight: z.number(),
  fontWeight: z.number(),
  letterSpacing: z.string().optional(),
  textTransform: z.literal('uppercase').optional(),
  usage: z.string().optional(),
})
const tokensSchema = z.object({
  color: z.object({
    tokens: z.array(z.object({ name: z.string(), value: z.object({ dark: z.string() }) })),
  }),
  type: z.object({
    families: z.object({ display: z.string(), sans: z.string(), mono: z.string() }),
    groups: z.array(
      z.object({ family: z.enum(['display', 'sans', 'mono']), styles: z.array(typeStyle) }),
    ),
  }),
  spacing: z.object({ tokens: z.array(named) }),
  radius: z.object({ tokens: z.array(named) }),
  size: z.object({ tokens: z.array(named) }),
  border: z.object({ tokens: z.array(named) }),

  emphasis: z.object({ tokens: z.array(named) }),
})

const tokens = tokensSchema.parse(
  JSON.parse(readFileSync(path.join(ROOT, 'design', 'tokens.json'), 'utf8')),
)

function rem(px: string): string {
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(px)
  if (!match?.[1]) throw new Error(`expected a px value, got ${px}`)
  const value = Number(match[1]) / 16
  return value === 0 ? '0' : `${String(value)}rem`
}

const FONT_VARS = {
  display: 'var(--font-nimbus-sans-narrow)',
  sans: 'var(--font-switzer)',
  mono: '',
} as const

const lines: string[] = [
  '/* Generated from design/tokens.json by `pnpm tokens`. Do not edit. */',
  ':root {',
]
for (const color of tokens.color.tokens) lines.push(`  --color-${color.name}: ${color.value.dark};`)
for (const [family, stack] of Object.entries(tokens.type.families)) {
  const loaded = FONT_VARS[family as keyof typeof FONT_VARS]
  lines.push(`  --font-${family}: ${loaded ? `${loaded}, ` : ''}${stack};`)
}
for (const space of tokens.spacing.tokens) lines.push(`  --${space.name}: ${rem(space.value)};`)
for (const radius of tokens.radius.tokens) {
  lines.push(`  --${radius.name}: ${radius.name === 'radius-pill' ? radius.value : rem(radius.value)};`)
}
for (const size of tokens.size.tokens) lines.push(`  --${size.name}: ${rem(size.value)};`)
for (const border of tokens.border.tokens) lines.push(`  --${border.name}: ${border.value};`)
for (const token of tokens.emphasis.tokens) lines.push(`  --${token.name}: ${token.value};`)

const styles = tokens.type.groups.flatMap((group) =>
  group.styles.map((style) => ({ ...style, family: group.family })),
)
for (const style of styles) {
  const p = `--type-${style.name}`
  lines.push(
    `  ${p}-family: var(--font-${style.family});`,
    `  ${p}-size: ${rem(style.fontSize)};`,
    `  ${p}-line: ${String(style.lineHeight)};`,
    `  ${p}-weight: ${String(style.fontWeight)};`,
    `  ${p}-tracking: ${style.letterSpacing ?? '0'};`,
    `  ${p}-case: ${style.textTransform ?? 'none'};`,
  )
}
lines.push('}', '')

const textCss = [
  '/* Generated from design/tokens.json by `pnpm tokens`. Do not edit. */',
  '/* The only place in the app that sets font family, size, weight, line height or tracking. */',
  ...styles.map((style) => {
    const p = `--type-${style.name}`
    return [
      `.${style.name} {`,
      `  font-family: var(${p}-family);`,
      `  font-size: var(${p}-size);`,
      `  line-height: var(${p}-line);`,
      `  font-weight: var(${p}-weight);`,
      `  letter-spacing: var(${p}-tracking);`,
      `  text-transform: var(${p}-case);`,
      '}',
    ].join('\n')
  }),
  '',
].join('\n')

const tsOut = [
  '// Generated from design/tokens.json by `pnpm tokens`. Do not edit.',
  `export const TYPE_STYLES = ${JSON.stringify(styles.map((s) => s.name))} as const`,
  'export type TypeStyle = (typeof TYPE_STYLES)[number]',
  `export const COLOR_TOKENS = ${JSON.stringify(tokens.color.tokens.map((c) => c.name))} as const`,
  'export type ColorToken = (typeof COLOR_TOKENS)[number]',
  '// Values for the few places a CSS variable cannot reach (the web app manifest, theme-color).',
  `export const COLOR_VALUES = ${JSON.stringify(Object.fromEntries(tokens.color.tokens.map((c) => [c.name, c.value.dark])))} as const satisfies Record<ColorToken, string>`,
  '// Size tokens in px, for the few places CSS cannot size (the intrinsic width and height of an image).',
  `export const SIZE_PX = ${JSON.stringify(Object.fromEntries(tokens.size.tokens.map((s) => [s.name, parseFloat(s.value)])))} as const`,
  '',
].join('\n')

const outputs: [string, string][] = [
  ['src/styles/tokens.css', lines.join('\n')],
  ['src/components/text-styles.module.css', textCss],
  ['src/styles/tokens.ts', tsOut],
]

if (process.argv.includes('--check')) {
  const stale = outputs.filter(([file, content]) => {
    try {
      return readFileSync(path.join(ROOT, file), 'utf8') !== content
    } catch {
      return true
    }
  })
  if (stale.length > 0) {
    console.error(`FAIL tokens: stale generated files: ${stale.map(([f]) => f).join(', ')}`)
    process.exitCode = 1
  } else console.log('tokens: generated files are current')
} else {
  for (const [file, content] of outputs) writeFileSync(path.join(ROOT, file), content)
  console.log(`tokens: wrote ${outputs.map(([f]) => f).join(', ')}`)
}
