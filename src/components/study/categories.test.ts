import { describe, expect, it } from 'vitest'

import { loadBank } from '@/lib/content/bank'

import { categoryChoices } from './categories'

describe('categoryChoices', () => {
  it('offers nothing when the bank is empty', () => {
    expect(categoryChoices([], new Map())).toEqual([])
  })

  it('offers only categories with cards, the drawn ones first', () => {
    const bank = loadBank()
    const choices = categoryChoices(bank.items, bank.passages)
    expect(choices.slice(0, 4).map((choice) => choice.name)).toEqual([
      'Floor work',
      'Standing work',
      'Glossary',
      'Coaching voice',
    ])
    expect(choices.find((choice) => choice.name === 'Coaching voice')?.detail).toBe(
      'Sample cues and timing',
    )
    const groupA = choices.find((choice) => choice.name === 'Floor work')
    expect(groupA?.detail).toMatch(/^\d+ exercises · Manual p\. \d+$/)
    expect(choices).toHaveLength(new Set(bank.items.map((item) => item.category)).size)
  })
})
