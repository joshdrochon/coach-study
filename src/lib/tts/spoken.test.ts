import { describe, expect, it } from 'vitest'

import { sendableLine, ttsLine } from './line'
import { SPOKEN_EXAMPLES } from './spoken-examples'
import {
  durationSaid,
  SPOKEN_RULES,
  SPOKEN_VERSION,
  spokenChanges,
  spokenText,
  unspokenPatterns,
} from './spoken'

describe('spokenText: each rule', () => {
  for (const rule of SPOKEN_RULES) {
    describe(rule.id, () => {
      it.each((SPOKEN_EXAMPLES[rule.id] ?? []).map(([written, spoken]) => ({ written, spoken })))(
        '$written -> $spoken',
        ({ written, spoken }) => {
          expect(spokenText(written)).toBe(spoken)

          expect(spokenText(spoken)).toBe(spoken)

          expect(unspokenPatterns(spoken)).toEqual([])

          if (rule.id !== 'clock') expect(unspokenPatterns(written)).not.toEqual([])
        },
      )
      it('is listed with what it does and at least one example', () => {
        expect(rule.says.length).toBeGreaterThan(10)
        expect(SPOKEN_EXAMPLES[rule.id]?.length).toBeGreaterThan(0)
        expect(rule.pattern.global).toBe(true)
      })
    })
  }
})

describe('spokenText: PC only before monitor(s)', () => {
  it('leaves the word "pc" and any other PC alone', () => {
    expect(spokenText('Dim the PC monitor.')).toBe('Dim the P-C monitor.')
    expect(spokenText('a pc monitor')).toBe('a pc monitor')
    expect(spokenText('PC support')).toBe('PC support')
    expect(unspokenPatterns(spokenText('PC support'))).toEqual([{ kind: 'capitals', match: 'PC' }])
  })
})

describe('spokenText: HQ as headquarters', () => {
  it('says HQ as a word, ends a sentence with it, and leaves other forms alone', () => {
    expect(spokenText('Next, call HQ!')).toBe('Next, call headquarters!')
    expect(spokenText('Go back to HQ.')).toBe('Go back to headquarters.')
    expect(spokenText('the HQs and the hq stay')).toBe('the HQs and the hq stay')
    expect(spokenText('a HQX unit')).toBe('a HQX unit')
  })
})

describe('spokenText: TV room letter by letter; BMI and QA said as letters', () => {
  it.each([
    ['Meet near the TV room', 'Meet near the T-V room'],
    ['Quiet please (TV room)', 'Quiet please (T-V room)'],
  ])('%s -> %s', (written, spoken) => {
    expect(spokenText(written)).toBe(spoken)
  })

  it('lets BMI and QA stand as letters, as PT does, and nothing longer', () => {
    expect(spokenText('Log your BMI, QA and PT notes')).toBe('Log your BMI, QA and PT notes')
    expect(unspokenPatterns('Log your BMI, QA and PT notes')).toEqual([])
    expect(unspokenPatterns('the BMIS course')).toEqual([{ kind: 'capitals', match: 'BMIS' }])
  })

  it('leaves any other TV alone', () => {
    expect(spokenText('TV power')).toBe('TV power')
    expect(unspokenPatterns(spokenText('TV power'))).toEqual([{ kind: 'capitals', match: 'TV' }])
  })
})

describe('spokenText: clock times and what no rule handles stay as written', () => {
  it.each(['Class at 6:30 pm.', 'Doors at 7:00 a.m.', 'Be there by 5:45PM', 'At 6:00 o’clock.'])(
    'a real clock time: %s',
    (line) => {
      expect(spokenText(line)).toBe(line)
      expect(unspokenPatterns(line)).toEqual([])
    },
  )

  it('an h:mm:ss time is left alone, and listed', () => {
    expect(spokenText('The video runs 1:02:03.')).toBe('The video runs 1:02:03.')
    expect(unspokenPatterns('The video runs 1:02:03.').map((u) => u.kind)).toContain('time')
  })

  it('a time past 59 seconds is not a time: left alone, and listed', () => {
    expect(spokenText('Hold 1:75.')).toBe('Hold 1:75.')
    expect(unspokenPatterns('Hold 1:75.')[0]?.kind).toBe('time')
  })

  it('a number chain or decimal range is left alone, and listed', () => {
    expect(spokenText('Lines 1-2-3.')).toBe('Lines 1-2-3.')
    expect(spokenText('3.5-4 pounds')).toBe('3.5-4 pounds')
    expect(unspokenPatterns('3.5-4 pounds')[0]?.kind).toBe('range')
  })
})

describe('unspokenPatterns', () => {
  it.each([
    ['Hold 1:02:03.', 'time'],
    ['Lines 3.5-4.', 'range'],
    ['About ~5 seconds.', 'symbol'],
    ['Coach @ the front.', 'symbol'],
    ['Use 1/2 the bands.', 'slash'],
    ['Tap {here}.', 'symbol'],
    ['Wait 2 hrs between.', 'abbreviation'],
    ['Ask the Q.R.S. first.', 'dotted'],
    ['The CEO watches.', 'capitals'],
    ['Add 10kg.', 'glued'],
    ['Then R first.', 'side'],
    ['In 3,2,1!', 'countdown'],
    ['Done. 2. Next step.', 'list'],
    ['Doors [open].', 'bracket'],
  ])('%s is %s', (line, kind) => {
    expect(unspokenPatterns(line).map((u) => u.kind)).toContain(kind)
  })

  it('lets the forms a voice reads right through', () => {
    expect(
      unspokenPatterns('The 1st and 2nd, 3.5 pounds, 40,000 characters, PT, 6:30 pm, 12 sessions.'),
    ).toEqual([])
  })
})

describe('the pieces', () => {
  it('says a length of time in minutes and seconds', () => {
    expect(durationSaid(240)).toBe('4 minutes')
    expect(durationSaid(100)).toBe('1 minute 40 seconds')
    expect(durationSaid(61)).toBe('1 minute 1 second')
    expect(durationSaid(45)).toBe('45 seconds')
    expect(durationSaid(0)).toBe('0 seconds')
  })

  it('reports each change by rule, in order', () => {
    expect(spokenChanges('30+ people, 4:00 min & salt + pepper.')).toEqual({
      spoken: '30 plus people, 4 minutes and salt and pepper.',
      changes: [
        { rule: 'duration', from: '4:00 min', to: '4 minutes' },
        { rule: 'plus', from: '30+', to: '30 plus' },
        { rule: 'plus', from: '+', to: 'and' },
        { rule: 'ampersand', from: '&', to: 'and' },
      ],
    })
  })

  it('has a version, part of every clip key', () => {
    expect(Number.isInteger(SPOKEN_VERSION)).toBe(true)
    expect(SPOKEN_VERSION).toBeGreaterThan(0)
  })

  it('is what a line sent to the app’s voice is, whitespace collapsed', () => {
    expect(ttsLine('  Hold  3:00.\n')).toBe('Hold 3 minutes.')
    expect(sendableLine('Hold 3:00.')).toBe('Hold 3 minutes.')
    expect(ttsLine('   ')).toBe('')
  })

  it('needs no lookbehind, which older iPad Safari can’t parse', () => {
    for (const rule of SPOKEN_RULES) expect(rule.pattern.source).not.toMatch(/\(\?<[=!]/)
  })
})
