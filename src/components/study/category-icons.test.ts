import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CATEGORIES } from '@/lib/content/schema'
import { loadBank } from '@/lib/content/bank'

import { categoryChoices } from './categories'
import { CATEGORY_ICONS, categoryIcon, type ChooseRow } from './category-icons'
import { PickerOption } from './PickerOption'

const html = (node: ReactNode) => renderToStaticMarkup(createElement(Fragment, null, node))

const APPROVED: ChooseRow[] = [
  'Everything',
  'Mic practice',
  'Coaching voice',
  'Floor work',
  'Standing work',
  'Balance work',
  'Stretch work',
  'Gear',
  'Glossary',
  'Basics',
  'Voice test',
]

describe('the Choose icons', () => {
  it('has exactly the approved rows', () => {
    expect(Object.keys(CATEGORY_ICONS).sort()).toEqual([...APPROVED].sort())
  })

  it.each(APPROVED)('%s: one 32px line icon in currentColor, hidden from screen readers', (row) => {
    const svg = html(categoryIcon(row))
    expect(svg.match(/<svg/g)).toHaveLength(1)
    expect(svg).toContain('viewBox="0 0 24 24"')

    expect(svg).toContain('stroke-width="1.5"')
    expect(svg).toContain('stroke="currentColor"')
    expect(svg).toContain('stroke-linecap="round"')
    expect(svg).toContain('stroke-linejoin="round"')
    expect(svg).toContain('fill="none"')
    expect(svg).toContain('aria-hidden="true"')
    expect(svg).toContain('focusable="false"')

    expect(svg).not.toMatch(/(fill|stroke)="(?!none"|currentColor")/)
    expect(svg).not.toMatch(/#[0-9a-f]{3,8}\b|rgb/i)
  })

  it('draws each row differently', () => {
    const drawings = APPROVED.map((row) => html(categoryIcon(row)))
    expect(new Set(drawings).size).toBe(APPROVED.length)
  })

  it('draws every category', () => {
    expect(CATEGORIES.filter((category) => !(category in CATEGORY_ICONS))).toEqual([])
  })

  it('covers every category Choose lists from the card bank', () => {
    const bank = loadBank()
    for (const choice of categoryChoices(bank.items, bank.passages)) {
      expect(categoryIcon(choice.name), choice.name).not.toBeNull()
    }
  })
})

describe('a picker option’s icon slot', () => {
  const option = (icon?: ReactNode, selected = false) =>
    html(
      PickerOption({
        onClick: () => undefined,
        selected,
        detail: 'Sample cues and timing',
        ...(icon === undefined ? {} : { icon }),
        children: 'Coaching voice',
      }),
    )
  const visibleText = (markup: string) =>
    markup.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '')

  it('puts the icon before the title and detail, which stay together', () => {
    const markup = option(categoryIcon('Coaching voice'))
    expect(markup).toContain('data-icon-slot="icon"')
    const svg = markup.indexOf('<svg')
    const title = markup.indexOf('data-text-style="body-l-strong"')
    const detail = markup.indexOf('data-text-style="body"')
    expect(svg).toBeGreaterThan(-1)
    expect(svg).toBeLessThan(title)
    expect(title).toBeLessThan(detail)

    expect(visibleText(markup)).toBe('Coaching voiceSample cues and timing')
    expect(markup).not.toMatch(/<title|aria-label/)
  })

  it('keeps the icon column for a row with no icon, with no drawing in it', () => {
    const markup = option(null)
    expect(markup).toContain('data-icon-slot="empty"')
    expect(markup).not.toContain('<svg')
    expect(visibleText(markup)).toBe('Coaching voiceSample cues and timing')
  })

  it('has no icon column where none is asked for (every other picker)', () => {
    const markup = option()
    expect(markup).not.toContain('data-icon-slot')
    expect(markup).not.toContain('<svg')
  })

  it('selected: the same markup, pressed; the icon keeps currentColor, so it turns on-accent with the row', () => {
    const plain = option(categoryIcon('Coaching voice'))
    const chosen = option(categoryIcon('Coaching voice'), true)
    expect(chosen).toContain('aria-pressed="true"')
    const drawing = (markup: string) => /<svg[\s\S]*?<\/svg>/.exec(markup)?.[0]
    expect(drawing(chosen)).toBe(drawing(plain))
    expect(drawing(chosen)).toContain('stroke="currentColor"')
  })
})
