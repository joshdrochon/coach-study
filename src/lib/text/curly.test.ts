import { describe, expect, it } from 'vitest'

import { curly } from './curly'

describe('curly', () => {
  it('curls apostrophes', () => {
    expect(curly("Robin's Easy Glide")).toBe('Robin’s Easy Glide')
    expect(curly("don't")).toBe('don’t')
  })

  it('opens and closes double and single quotes', () => {
    expect(curly('a sample move a-based "center" set')).toBe('a sample move a-based “center” set')
    expect(curly('"Tuck the rail."')).toBe('“Tuck the rail.”')
    expect(curly("say 'wait' (or 'next')")).toBe('say ‘wait’ (or ‘next’)')
  })

  it('opens a quotation that starts right inside another (a citation that starts with the manual’s own quote)', () => {
    expect(curly('“"Lower your hands." Use hands on the rail.”')).toBe(
      '““Lower your hands.” Use hands on the rail.”',
    )
    expect(curly("“'Wave hello.'”")).toBe('“‘Wave hello.’”')
  })

  it('leaves text that is already curly, or has no quotes, as it is', () => {
    expect(curly('You’re saying “hint.”')).toBe('You’re saying “hint.”')
    expect(curly('A mat first.')).toBe('A mat first.')
  })
})
