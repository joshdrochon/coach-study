// Model ids, prices and which model plays which role. Costs are computed from token
// usage, including cache reads and writes.

export const MODELS = {
  haiku: 'claude-haiku-4-5',
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',

  haiku55: 'claude-haiku-5-5',
} as const
export type ModelKey = keyof typeof MODELS
export type ModelId = (typeof MODELS)[ModelKey]

type Rates = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cacheWrite1h: number
}
type Price = Rates & { long?: Rates & { above: number } }

export const PRICES: Record<ModelId, Price> = {
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25, cacheWrite1h: 2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5, cacheWrite1h: 4 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5, cacheWrite1h: 8 },
  'claude-haiku-5-5': {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    cacheWrite: 0.125,
    cacheWrite1h: 0.2,
    long: {
      above: 100_000,
      input: 0.5,
      output: 2.5,
      cacheRead: 0.05,
      cacheWrite: 0.625,
      cacheWrite1h: 1,
    },
  },
}

export const ROLES = {
  cardGrader: MODELS.sonnet,
  practiceGrader: MODELS.sonnet,
  explainer: MODELS.sonnet,
  escalation: MODELS.opus,
  dispute: MODELS.opus,
} as const satisfies Record<string, ModelId>

export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null

  cache_creation?: {
    ephemeral_1h_input_tokens?: number | null
    ephemeral_5m_input_tokens?: number | null
  } | null
}

export function promptTokens(usage: Usage): number {
  return (
    usage.input_tokens +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0)
  )
}

export function costUsd(model: ModelId, usage: Usage): number {
  const base = PRICES[model]
  const price = base.long && promptTokens(usage) > base.long.above ? base.long : base
  const writes = usage.cache_creation_input_tokens ?? 0
  const hour = Math.min(writes, usage.cache_creation?.ephemeral_1h_input_tokens ?? 0)
  const dollars =
    usage.input_tokens * price.input +
    usage.output_tokens * price.output +
    (usage.cache_read_input_tokens ?? 0) * price.cacheRead +
    (writes - hour) * price.cacheWrite +
    hour * price.cacheWrite1h
  return dollars / 1_000_000
}
