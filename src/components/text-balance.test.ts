import { readFileSync } from 'node:fs'
import path from 'node:path'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { TYPE_STYLES } from '@/styles/tokens'

import { Text } from './Text'
import styles from './Text.module.css'

describe('every h1 is balanced', () => {
  it('gives an h1 the balance class in every type style', () => {
    const balance = styles.balance
    expect(balance).toBeTruthy()
    for (const variant of TYPE_STYLES) {
      const html = renderToStaticMarkup(Text<'h1'>({ as: 'h1', variant, children: 'Mic practice' }))
      const classes = /class="([^"]*)"/.exec(html)?.[1]?.split(' ') ?? []
      expect(classes, variant).toContain(balance)
    }
  })

  it('makes the balance class text-wrap: balance', () => {
    const css = readFileSync(path.join(import.meta.dirname, 'Text.module.css'), 'utf8')
    expect(css).toMatch(/\.balance\s*\{[^}]*text-wrap:\s*balance/)
  })
})

describe('a headline keeps its last two words together', () => {
  const unit = (html: string) =>
    new RegExp(
      `<span class="${styles.keepWhole ?? 'missing'}" data-keep-whole="true">([^<]*)</span>`,
    ).exec(html)?.[1]

  it('wraps the last two words of an h1 or headline in the keep-whole unit', () => {
    const h1 = renderToStaticMarkup(
      Text<'h1'>({
        as: 'h1',
        variant: 'headline-xl',
        children: 'Six days to your first coaching session.',
      }),
    )
    expect(unit(h1)).toBe('coaching session.')
    expect(h1.replace(/<[^>]*>/g, '')).toBe('Six days to your first coaching session.')
    const parts = renderToStaticMarkup(
      Text<'h1'>({
        as: 'h1',
        variant: 'headline-xl',
        children: ['You’re a ', 'Mentor', '.'],
      }),
    )
    expect(unit(parts)).toBe('a Mentor.')
    const p = renderToStaticMarkup(
      Text<'p'>({ as: 'p', variant: 'headline-m', children: 'Keep it all ready.' }),
    )
    expect(unit(p)).toBe('all ready.')
  })

  it('leaves body text and one or two words as they are', () => {
    const body = renderToStaticMarkup(
      Text<'p'>({ as: 'p', variant: 'body', children: 'Two words' }),
    )
    expect(unit(body)).toBeUndefined()

    const two = renderToStaticMarkup(
      Text<'p'>({ as: 'p', variant: 'headline-m', children: 'Coach Alex' }),
    )
    expect(two).toContain('>Coach Alex</p>')
    const one = renderToStaticMarkup(
      Text<'h1'>({ as: 'h1', variant: 'headline-xl', children: 'Progress' }),
    )
    expect(unit(one)).toBeUndefined()
    expect(one).toContain('>Progress</h1>')
  })

  it('makes the unit an inline-block no wider than the column', () => {
    const css = readFileSync(path.join(import.meta.dirname, 'Text.module.css'), 'utf8')
    expect(css).toMatch(/\.keepWhole\s*\{[^}]*display:\s*inline-block;[^}]*max-width:\s*100%/)
  })
})
