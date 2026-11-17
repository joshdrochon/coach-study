import { describe, expect, it } from 'vitest'

import { heardParts, soundsAlike } from './heard'

describe('heardParts', () => {
  it('reads each corrected word as the grader read it, with what was heard beside it', () => {
    expect(
      heardParts('a strap and the rulers, then the timer', [
        { heard: 'rulers', readAs: 'rollers' },
        { heard: 'then', readAs: 'bend' },
      ]),
    ).toEqual([
      { text: 'a strap and the ' },
      { text: 'rollers', heard: 'rulers' },
      { text: ', ' },
      { text: 'bend', heard: 'then' },
      { text: ' the timer' },
    ])
  })

  it('is their words as said with nothing to correct, or a correction not in them', () => {
    expect(heardParts('lift your arms', [])).toEqual([{ text: 'lift your arms' }])
    expect(heardParts('lift your arms', [{ heard: 'then', readAs: 'bend' }])).toEqual([
      { text: 'lift your arms' },
    ])
  })
})

describe('soundsAlike', () => {
  it('keeps the known sound-alikes', () => {
    expect(soundsAlike('then', 'bend')).toBe(true)
    expect(soundsAlike('rulers', 'rollers')).toBe(true)
  })

  it('rejects words only added or dropped, and spans too far apart in sound', () => {
    expect(soundsAlike('bend arms', 'bend your arms')).toBe(false)
    expect(soundsAlike('front whale', 'front')).toBe(false)
    expect(soundsAlike('arms in the box', 'arms out of the box')).toBe(false)
    expect(soundsAlike('lift your arms', 'bend your arms')).toBe(false)
  })

  it('rejects "in the box" read as "out of the box": the opposite place, not a sound-alike', () => {
    expect(soundsAlike('in the box', 'out of the box')).toBe(false)
  })

  it('rejects any swap, addition or loss of a direction, side or negation word', () => {
    expect(soundsAlike('on', 'off')).toBe(false)
    expect(soundsAlike('inner', 'outer')).toBe(false)
    expect(soundsAlike('up', 'down')).toBe(false)
    expect(soundsAlike('left', 'right')).toBe(false)
    expect(soundsAlike('now bend', 'not bend')).toBe(false)
    expect(soundsAlike('over the rail', 'under the rail')).toBe(false)
    expect(soundsAlike('front', 'behind')).toBe(false)
    expect(soundsAlike('toward', 'away')).toBe(false)
  })

  it('rejects words that do not sound alike, or only add a word', () => {
    expect(soundsAlike('lift', 'bend')).toBe(false)
    expect(soundsAlike('keys', 'arms out of')).toBe(false)
  })
})
