import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { askStructured, defaultParser, type Parser } from './anthropic'
import { CutOffError, TutorError } from './errors'

const schema = z.object({ result: z.enum(['right', 'partial', 'wrong']) })
const request = {
  model: 'claude-haiku-4-5' as const,
  system: [{ type: 'text' as const, text: 'Grade against the manual.' }],
  messages: [{ role: 'user' as const, content: 'Sample move a: primary parts? Answer: a mat' }],
  maxTokens: 512,
  effort: 'low' as const,
}
const usage = {
  input_tokens: 100,
  output_tokens: 20,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}

function parserReturning(response: Record<string, unknown>) {
  const parse = vi.fn(() => Promise.resolve({ usage, ...response }))
  return { parser: { parse } as unknown as Parser, parse }
}

function sdkAnswering(status: number, body: unknown): Parser {
  const client = new Anthropic({
    apiKey: 'test-key-not-real',
    maxRetries: 0,
    fetch: () =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      ),
  })
  return client.messages
}

function sdkOffline(): Parser {
  const client = new Anthropic({
    apiKey: 'test-key-not-real',
    maxRetries: 0,
    fetch: () => Promise.reject(new TypeError('fetch failed')),
  })
  return client.messages
}

const billed = { input_tokens: 1500, output_tokens: 200 }
const message = (text: string | null, stopReason: string) => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-haiku-4-5',
  content: text === null ? [] : [{ type: 'text', text }],
  stop_reason: stopReason,
  stop_sequence: null,
  usage: billed,
})

async function failure(promise: Promise<unknown>): Promise<TutorError> {
  const error: unknown = await promise.then(
    () => null,
    (reason: unknown) => reason,
  )
  if (!(error instanceof TutorError)) throw new Error('expected a TutorError')
  return error
}

const ask = (parser: Parser, signal = new AbortController().signal) =>
  askStructured(request, schema, signal, parser)

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('askStructured', () => {
  it('returns the schema-validated answer with usage', async () => {
    const { parser, parse } = parserReturning({
      stop_reason: 'end_turn',
      parsed_output: { result: 'right' },
    })
    const out = await askStructured(request, schema, new AbortController().signal, parser)
    expect(out).toEqual({ value: { result: 'right' }, model: 'claude-haiku-4-5', usage })

    expect(JSON.stringify(parse.mock.calls[0])).not.toContain('"effort"')
  })

  it('sends effort to Sonnet', async () => {
    const { parser, parse } = parserReturning({
      stop_reason: 'end_turn',
      parsed_output: { result: 'right' },
    })
    await askStructured(
      { ...request, model: 'claude-sonnet-5-5' },
      schema,
      new AbortController().signal,
      parser,
    )
    expect(JSON.stringify(parse.mock.calls[0])).toContain('"effort":"low"')
  })

  it('the SDK’s own parse throws on an answer that fails its schema (why the format is lenient)', async () => {
    const parser = sdkAnswering(200, message('{"result":"maybe"}', 'end_turn'))
    await expect(
      parser.parse({
        model: 'claude-haiku-4-5',
        max_tokens: 512,
        messages: request.messages,
        output_config: { format: zodOutputFormat(schema) },
      }),
    ).rejects.toThrow(/^Failed to parse structured output/)
  })

  it('returns a valid answer through the real SDK, with its usage', async () => {
    const out = await ask(sdkAnswering(200, message('{"result":"partial"}', 'end_turn')))
    expect(out).toMatchObject({
      value: { result: 'partial' },
      model: 'claude-haiku-4-5',
      usage: billed,
    })
  })

  it('treats an answer that fails its schema, isn’t JSON, or was cut off as invalid, charged at its usage', async () => {
    const spend = { model: 'claude-haiku-4-5', usage: billed }
    for (const answer of [
      message('{"result":"maybe"}', 'end_turn'),
      message('Right: the a mat.', 'end_turn'),
      message('{"result":"ri', 'max_tokens'),
      message(null, 'end_turn'),
    ]) {
      const error = await failure(ask(sdkAnswering(200, answer)))
      expect(error).toMatchObject({ kind: 'invalid-output', spend })

      expect(error instanceof CutOffError).toBe(answer.stop_reason === 'max_tokens')
    }
  })

  it('turns a refusal into a typed error, charged at its usage', async () => {
    const spend = { model: 'claude-haiku-4-5', usage: billed }
    for (const answer of [
      message('I can’t help with that.', 'refusal'),
      message(null, 'refusal'),
    ]) {
      expect(await failure(ask(sdkAnswering(200, answer)))).toMatchObject({
        kind: 'refused',
        spend,
      })
    }
  })

  it('maps API errors, a lost connection and timeouts to typed errors that spent nothing', async () => {
    const overloaded = sdkAnswering(529, {
      type: 'error',
      error: { type: 'overloaded_error', message: 'Overloaded' },
    })
    expect(await failure(ask(overloaded))).toMatchObject({ kind: 'upstream', spend: 'nothing' })
    expect(await failure(ask(sdkOffline()))).toMatchObject({ kind: 'upstream', spend: 'nothing' })
    const apiError = {
      parse: () =>
        Promise.reject(new Anthropic.APIError(529, undefined, 'overloaded', new Headers())),
    }
    expect(await failure(ask(apiError as unknown as Parser))).toMatchObject({
      kind: 'upstream',
      spend: 'nothing',
    })
    const controller = new AbortController()
    controller.abort()
    const aborted = { parse: () => Promise.reject(new Error('aborted')) }
    expect(await failure(ask(aborted as unknown as Parser, controller.signal))).toMatchObject({
      kind: 'timeout',
      spend: 'nothing',
    })
    const slow = sdkAnswering(200, message('{"result":"right"}', 'end_turn'))
    const late = new AbortController()
    late.abort()
    expect(await failure(ask(slow, late.signal))).toMatchObject({
      kind: 'timeout',
      spend: 'nothing',
    })
  })

  it('maps Anthropic refusing for money to a typed spend-limit error that spent nothing', async () => {
    const refusals = [
      sdkAnswering(400, {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message:
            'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
        },
      }),
      sdkAnswering(400, {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message:
            'You have reached your specified API usage limits. You will regain access on 2026-09-17 at 00:00 UTC.',
        },
      }),
      sdkAnswering(402, {
        type: 'error',
        error: { type: 'billing_error', message: 'Payment required.' },
      }),
    ]
    for (const parser of refusals) {
      expect(await failure(ask(parser))).toMatchObject({ kind: 'spend-limit', spend: 'nothing' })
    }

    const badRequest = sdkAnswering(400, {
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'messages: roles must alternate between "user" and "assistant"',
      },
    })
    expect(await failure(ask(badRequest))).toMatchObject({ kind: 'upstream', spend: 'nothing' })
  })

  it('maps the SDK’s own parse failure to invalid output, at a cost it doesn’t know', async () => {
    const thrown = {
      parse: () =>
        Promise.reject(
          new Anthropic.AnthropicError('Failed to parse structured output: SyntaxError'),
        ),
    }
    const error = await failure(ask(thrown as unknown as Parser))
    expect(error.kind).toBe('invalid-output')
    expect(error.spend).toBeUndefined()
  })

  it('rethrows programming errors unchanged', async () => {
    const broken = { parse: () => Promise.reject(new TypeError('bug')) }
    await expect(
      askStructured(request, schema, new AbortController().signal, broken as unknown as Parser),
    ).rejects.toBeInstanceOf(TypeError)
    const other = { parse: () => Promise.reject(new Anthropic.AnthropicError('Missing argument')) }
    await expect(ask(other as unknown as Parser)).rejects.not.toBeInstanceOf(TutorError)
  })
})

describe('defaultParser', () => {
  it('refuses to run without a key, or with the build-time placeholder, before any call', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    expect(() => defaultParser()).toThrow(/no API key/)
    vi.stubEnv('ANTHROPIC_API_KEY', '[SENSITIVE]')
    expect(() => defaultParser()).toThrow(
      expect.objectContaining({ kind: 'misconfigured', spend: 'nothing' }),
    )
  })

  it('builds one shared client when a key is present', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real')
    expect(defaultParser()).toBe(defaultParser())
  })
})

describe('a test server', () => {
  it('never calls the model, even with a key in the env', () => {
    const before = { key: process.env.ANTHROPIC_API_KEY, test: process.env.APP_TEST_SERVER }
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key-not-real'
    process.env.APP_TEST_SERVER = '1'
    try {
      expect(() => defaultParser()).toThrow('a test server never calls the model')
    } finally {
      if (before.key === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = before.key
      if (before.test === undefined) delete process.env.APP_TEST_SERVER
      else process.env.APP_TEST_SERVER = before.test
    }
  })
})
