import { describe, expect, it } from 'vitest'

import { citationLines, depthMark, flatText, hasLayout, textLines } from './lines'

describe('a text with its source layout', () => {
  it('drops empty lines and collapses a line’s own whitespace', () => {
    expect(textLines('A  b\n\n  \n\tc\t d')).toEqual([
      { depth: 0, text: 'A b' },
      { depth: 1, text: 'c d' },
    ])
    expect(textLines('')).toEqual([])
  })

  it('says the same words with or without its layout', () => {
    expect(flatText('Step one:\n\tStand tall\nStep two:')).toBe('Step one: Stand tall Step two:')
    expect(hasLayout('Step:\n\tStand')).toBe(true)
    expect(hasLayout('Step: Stand')).toBe(false)
  })

  it('marks at most two steps of indent', () => {
    expect(depthMark(0)).toBe('')
    expect(depthMark(1)).toBe('\t')
    expect(depthMark(5)).toBe('\t\t')
  })
})

describe('a citation’s lines as the screens set them', () => {
  it('makes a top-level line with deeper lines under it a label, and the lines under it flush', () => {
    expect(citationLines('Setup\n\tStand tall')).toEqual([
      { text: 'Setup', label: true, indent: 0 },
      { text: 'Stand tall', label: false, indent: 0 },
    ])
  })

  it('indents a deeper mark one step, and keeps a line with nothing under it plain', () => {
    expect(
      citationLines(
        'SAMPLE PLAN\nReady\n\t+ stance\nSteady\n\tNotes\n\t\tFirst note:\n\t\tSecond note:',
      ),
    ).toEqual([
      { text: 'SAMPLE PLAN', label: false, indent: 0 },
      { text: 'Ready', label: true, indent: 0 },
      { text: '+ stance', label: false, indent: 0 },
      { text: 'Steady', label: true, indent: 0 },
      { text: 'Notes', label: false, indent: 0 },
      { text: 'First note:', label: false, indent: 1 },
      { text: 'Second note:', label: false, indent: 1 },
    ])
  })

  it('has no label in a text of one level or one line', () => {
    expect(citationLines('A\nB').some((line) => line.label)).toBe(false)
    expect(citationLines('A')).toEqual([{ text: 'A', label: false, indent: 0 }])
  })
})
