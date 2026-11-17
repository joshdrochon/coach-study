import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC = path.resolve(__dirname, '..')

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name)
    if (statSync(file).isDirectory()) return cssFiles(file)
    return file.endsWith('.css') ? [file] : []
  })
}

type Rule = { file: string; selector: string; property: string; value: string }

function declarations(file: string): Rule[] {
  const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: Rule[] = []
  for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (block[1] ?? '').trim().replace(/\s+/g, ' ')
    for (const declaration of (block[2] ?? '').split(';')) {
      const [property, ...rest] = declaration.split(':')
      if (property?.trim()) {
        rules.push({
          file: path.relative(SRC, file),
          selector,
          property: property.trim(),
          value: rest.join(':').trim(),
        })
      }
    }
  }
  return rules
}

const RULES = cssFiles(SRC).flatMap(declarations)

const LEADING =
  /^(?:padding-left|padding-inline(?:-start)?|margin-left|margin-inline(?:-start)?|text-indent)$/
const HEADER_PART = /header|lead\b|titles?\b/i

const indents = (rule: Rule) =>
  LEADING.test(rule.property) && !/^(?:auto|0|0px|0rem|inherit|initial|unset)$/.test(rule.value)

describe('header gutter', () => {
  it('reads the app’s style sheets', () => {
    expect(RULES.length).toBeGreaterThan(500)
    expect(RULES.some((rule) => rule.selector.includes('headerStart'))).toBe(true)
  })

  it('has no header, header label or title moved in from the gutter', () => {
    const found = RULES.filter((rule) => HEADER_PART.test(rule.selector) && indents(rule)).map(
      (rule) => `${rule.file}: ${rule.selector} { ${rule.property}: ${rule.value} }`,
    )
    expect(found).toEqual([])
  })

  it('has no leading edge pushed in by space-64 anywhere (the iPad window-controls indent)', () => {
    const found = RULES.filter((rule) => indents(rule) && /--space-64\b/.test(rule.value)).map(
      (rule) => `${rule.file}: ${rule.selector} { ${rule.property}: ${rule.value} }`,
    )
    expect(found).toEqual([])
  })

  it('catches an indent when one is put back (calibration)', () => {
    const planted: Rule = {
      file: 'planted.css',
      selector: '.headerStart',
      property: 'padding-left',
      value: 'var(--space-64)',
    }
    expect(indents(planted)).toBe(true)
    expect(HEADER_PART.test(planted.selector)).toBe(true)
    expect(indents({ ...planted, property: 'margin-left', value: 'auto' })).toBe(false)
  })
})
