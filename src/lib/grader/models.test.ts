import { describe, expect, it } from 'vitest'

import { costUsd, MODELS, PRICES, promptTokens, ROLES } from './models'

describe('pinned models', () => {
  it('pins exact model IDs with no date suffixes', () => {
    expect(Object.values(MODELS)).toEqual([
      'claude-haiku-4-5',
      'claude-sonnet-5-5',
      'claude-opus-5-5',
      'claude-haiku-5-5',
    ])
  })

  it('has a price for every pinned model and every role', () => {
    for (const id of Object.values(MODELS)) expect(PRICES[id]).toBeDefined()
    for (const id of Object.values(ROLES)) expect(PRICES[id]).toBeDefined()
  })

  it('prices cache reads and writes as the API reference does (Opus 5.5 reads at 0.05x)', () => {
    expect(PRICES['claude-opus-5-5']).toEqual({
      input: 4,
      output: 20,
      cacheRead: 0.2,
      cacheWrite: 5,
      cacheWrite1h: 8,
    })
    expect(PRICES['claude-sonnet-5-5']).toEqual({
      input: 2,
      output: 10,
      cacheRead: 0.2,
      cacheWrite: 2.5,
      cacheWrite1h: 4,
    })
    for (const [id, price] of Object.entries(PRICES)) {
      for (const rates of price.long ? [price, price.long] : [price]) {
        expect(rates.cacheWrite / rates.input, id).toBeCloseTo(1.25)
        expect(rates.cacheWrite1h / rates.input, id).toBeCloseTo(2)
        expect(rates.cacheRead / rates.input, id).toBeCloseTo(id === 'claude-opus-5-5' ? 0.05 : 0.1)
      }
    }
  })

  it('prices Haiku 5.5 with the long-prompt rates above 100K', () => {
    expect(PRICES['claude-haiku-5-5']).toMatchObject({ input: 0.1, output: 0.5 })
    expect(PRICES['claude-haiku-5-5'].long).toMatchObject({
      above: 100_000,
      input: 0.5,
      output: 2.5,
    })
  })

  it('assigns the roles: Sonnet for cards and practices, Opus for disputes', () => {
    expect(ROLES).toMatchObject({
      cardGrader: 'claude-sonnet-5-5',
      practiceGrader: 'claude-sonnet-5-5',
      dispute: 'claude-opus-5-5',
    })
  })
})

describe('costUsd', () => {
  it('prices a practice grade like the planning estimate (~15K in, ~2K out on Sonnet)', () => {
    expect(
      costUsd('claude-sonnet-5-5', { input_tokens: 15_000, output_tokens: 2_000 }),
    ).toBeCloseTo(0.05)
  })

  it('charges cached reads at the cache rate', () => {
    const cached = costUsd('claude-sonnet-5-5', {
      input_tokens: 1_000,
      output_tokens: 500,
      cache_read_input_tokens: 14_000,
      cache_creation_input_tokens: 0,
    })
    expect(cached).toBeCloseTo(0.002 + 0.005 + 0.0028)
  })
})

describe('costUsd with a 1-hour cache and long prompts', () => {
  it('prices 1-hour cache writes at 2x input and 5-minute ones at 1.25x', () => {
    const usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 1_000_000,
      cache_creation: { ephemeral_1h_input_tokens: 600_000, ephemeral_5m_input_tokens: 400_000 },
    }

    expect(costUsd('claude-sonnet-5-5', usage)).toBeCloseTo(2.4 + 1)
  })

  it('never prices more 1-hour writes than the call wrote', () => {
    const usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 10,
      cache_creation: { ephemeral_1h_input_tokens: 50 },
    }
    expect(costUsd('claude-sonnet-5-5', usage)).toBeCloseTo((10 * 4) / 1_000_000)
  })

  it('uses Haiku 5.5 short rates up to 100K prompt tokens and long rates above', () => {
    const short = { input_tokens: 100_000, output_tokens: 1_000_000 }
    expect(costUsd('claude-haiku-5-5', short)).toBeCloseTo(0.01 + 0.5)
    const long = {
      input_tokens: 1_000,
      output_tokens: 1_000_000,
      cache_read_input_tokens: 150_000,
    }
    expect(promptTokens(long)).toBe(151_000)
    expect(costUsd('claude-haiku-5-5', long)).toBeCloseTo(0.0005 + 2.5 + 0.0075)
  })

  it('treats a missing cache breakdown as 5-minute writes', () => {
    const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000 }
    expect(costUsd('claude-haiku-4-5', usage)).toBeCloseTo(1.25)
    expect(
      costUsd('claude-haiku-4-5', {
        ...usage,
        cache_creation: null,
        cache_read_input_tokens: null,
      }),
    ).toBeCloseTo(1.25)
  })
})
