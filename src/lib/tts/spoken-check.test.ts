import { describe, expect, it } from 'vitest'

import { checkSpoken } from './spoken-check'

describe('checkSpoken', () => {
  it('fails on a pattern no rule says, naming the line', () => {
    const report = checkSpoken([{ source: 'app copy:x.ts', text: 'Rest ~5 seconds @ the front.' }])
    expect(report.issues).toEqual([
      'app copy:x.ts: no rule says symbol "~" in "Rest ~5 seconds @ the front."',
      'app copy:x.ts: no rule says symbol "@" in "Rest ~5 seconds @ the front."',
    ])
  })

  it('has nowhere to plant without a clean real line, and says so', () => {
    const report = checkSpoken([{ source: 'cards:x', text: 'Hold 1:02:03.' }], { calibrate: true })
    expect(report.issues).toContain('spoken-text calibration: no clean real line to plant into')
  })
})
