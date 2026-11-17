import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

describe('the headline font’s license', () => {
  it('ships in public/, identical to the license beside the font in design/assets/fonts', () => {
    const shipped = readFileSync(path.join(ROOT, 'public', 'NimbusSansNarrow-LICENSE.txt'))
    const source = readFileSync(
      path.join(ROOT, 'design', 'assets', 'fonts', 'NimbusSansNarrow-LICENSE.txt'),
    )
    expect(shipped.equals(source)).toBe(true)
    expect(readFileSync(path.join(ROOT, 'src', 'app', 'fonts.ts'), 'utf8')).toContain(
      'design/assets/fonts/NimbusSansNarrow-Bold.otf',
    )
  })

  it('ships the AGPL text the license refers to (COPYING), beside the font and in public/', () => {
    const copying = readFileSync(path.join(ROOT, 'design', 'assets', 'fonts', 'COPYING'))
    expect(copying.toString('utf8')).toMatch(/^\s*GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3/)
    expect(
      readFileSync(path.join(ROOT, 'public', 'NimbusSansNarrow-COPYING.txt')).equals(copying),
    ).toBe(true)
  })
})
