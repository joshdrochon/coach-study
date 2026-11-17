import 'server-only'

// The one place that calls the Claude API. Structured output is parsed with zod;
// every failure becomes a typed TutorError the routes can answer with.

import Anthropic, { type AutoParseableOutputFormat } from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { z } from 'zod'

import { MODELS, type ModelId, type Usage } from '../grader/models'

import { CutOffError, TutorError } from './errors'

export type Parser = Pick<Anthropic['messages'], 'parse'>

let shared: Anthropic | undefined

export function defaultParser(): Parser {
  if (process.env.APP_TEST_SERVER === '1')
    throw new TutorError('misconfigured', 'a test server never calls the model', 'nothing')
  const key = process.env.ANTHROPIC_API_KEY
  if (!key || key === '[SENSITIVE]')
    throw new TutorError('misconfigured', 'no API key on the server', 'nothing')
  shared ??= new Anthropic({ apiKey: key, maxRetries: 2, timeout: 60_000 })
  return shared.messages
}

function lenientFormat<S extends z.ZodType>(
  schema: S,
): AutoParseableOutputFormat<z.infer<S> | null> {
  const strict = zodOutputFormat(schema)
  return {
    ...strict,
    parse: (content: string) => {
      try {
        return strict.parse(content)
      } catch {
        return null
      }
    },
  }
}

const PARSE_FAILURE = 'Failed to parse structured output'

const SPEND_REFUSAL = /credit balance is too low|usage limits?\b/i

function refusedForMoney(type: string | null, status: unknown, message: string): boolean {
  if (type === 'billing_error' || status === 402) return true
  return status === 400 && SPEND_REFUSAL.test(message)
}

export type StructuredRequest = {
  model: ModelId

  system: Anthropic.TextBlockParam[]
  messages: Anthropic.MessageParam[]
  maxTokens: number

  effort?: 'low' | 'medium' | 'high'
}

export async function askStructured<S extends z.ZodType>(
  request: StructuredRequest,
  schema: S,
  signal: AbortSignal,
  parser: Parser = defaultParser(),
): Promise<{ value: z.infer<S>; model: ModelId; usage: Usage }> {
  const effort = request.model === MODELS.haiku ? undefined : request.effort
  const format = lenientFormat(schema)
  let response
  try {
    response = await parser.parse(
      {
        model: request.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: request.messages,
        output_config: { format, ...(effort ? { effort } : {}) },
      },
      { signal },
    )
  } catch (error) {
    if (signal.aborted || error instanceof Anthropic.APIConnectionTimeoutError) {
      throw new TutorError('timeout', 'the tutor took too long', 'nothing')
    }
    if (error instanceof Anthropic.APIError) {
      const status: unknown = error.status
      if (refusedForMoney(error.type, status, error.message)) {
        throw new TutorError('spend-limit', `API error ${String(error.status)}: spend`, 'nothing')
      }
      throw new TutorError('upstream', `API error ${String(error.status ?? 'network')}`, 'nothing')
    }

    if (error instanceof Anthropic.AnthropicError && error.message.startsWith(PARSE_FAILURE)) {
      throw new TutorError('invalid-output', 'no valid answer (unparseable)')
    }
    throw error
  }

  const spend = { model: request.model, usage: response.usage }
  if (response.stop_reason === 'refusal') {
    throw new TutorError('refused', 'the model declined', spend)
  }
  if (response.stop_reason === 'max_tokens') throw new CutOffError(spend)
  if (response.parsed_output === null) {
    throw new TutorError(
      'invalid-output',
      `no valid answer (stop: ${response.stop_reason ?? 'unknown'})`,
      spend,
    )
  }
  return { value: response.parsed_output, model: request.model, usage: response.usage }
}
