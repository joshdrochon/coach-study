import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import type { Item } from '../content/schema'
import type { Db } from '../db/client'
import {
  alsoListedKept,
  alsoListedLine,
  cardOutputSchema,
  cardSystemPrompt,
  cardUserPrompt,
  codeGrade,
  type CardOutput,
} from '../grader/card'
import { cardRegradeOutputSchema } from '../grader/card-regrade'
import { ANSWER_ENTRIES, correctionWords, reviewCorrections } from '../grader/heard'
import { ROLES } from '../grader/models'
import { spokenLine } from '../grader/words'

import type { Parser, StructuredRequest } from './anthropic'
import { runTutorCall } from './run'

export const cardRequestSchema = z.object({
  itemId: z.string().max(120),
  answer: z.string().max(2000),
  answerMs: z.number().int().min(0).max(600_000),
  hintUsed: z.boolean(),

  entry: z.enum(ANSWER_ENTRIES).default('voice'),
})
export type CardRequest = z.input<typeof cardRequestSchema>

export type CardGrade = Omit<CardOutput, 'fix' | 'alsoListed'> & {
  spoken: string
  source: 'code' | 'tutor'
  traceId: string | null
}

function toGrade(
  output: CardOutput,
  source: CardGrade['source'],
  traceId: string | null,
  also: string | null = null,
): CardGrade {
  const { corrections, result, missing, inOrder, followUp } = output
  const line = also === null ? output.fix : alsoListedLine(also)
  const spoken = spokenLine(result, line)
  return { corrections, result, missing, inOrder, followUp, spoken, source, traceId }
}

export const CARD_TIMEOUT_MS = 8000

export const CARD_CLIENT_BUDGET_MS = 11_000
export const CARD_STRICT_MIN_MS = 2000

const CARD_ESTIMATE_USD = 0.01

export async function gradeCard(
  db: Db,
  item: Item,
  request: CardRequest,
  traceId: string,
  ask: (request: StructuredRequest, signal: AbortSignal) => ReturnType<typeof askCard>,
  correlationId?: string,
): Promise<CardGrade> {
  const byCode = codeGrade(item, request.answer)
  if (byCode) return toGrade(byCode, 'code', null)
  const entry = request.entry ?? 'voice'
  const askOnce = (
    callTrace: string,
    strict: boolean,
    label: string | undefined,
    timeoutMs: number,
  ) =>
    runTutorCall(
      {
        db,
        kind: 'card-grade',
        traceId: callTrace,
        ...(label ? { correlationId: label } : {}),
        estimateUsd: CARD_ESTIMATE_USD,
        timeoutMs,

        verdict: (output: CardOutput) => ({
          itemId: item.id,
          result: output.result,
          missing: output.missing,
          inOrder: output.inOrder,

          corrections: output.corrections.length,
          ...(strict ? { strict: true } : {}),
        }),
      },
      (signal) =>
        ask(
          {
            model: ROLES.cardGrader,
            system: [
              { type: 'text', text: cardSystemPrompt(), cache_control: { type: 'ephemeral' } },
            ],
            messages: [
              { role: 'user', content: cardUserPrompt(item, request.answer, entry, strict) },
            ],
            maxTokens: 600,

            effort: 'low',
          },
          signal,
        ),
    )
  const startedAt = Date.now()
  const result = await askOnce(traceId, false, correlationId, CARD_TIMEOUT_MS)

  const key = correctionWords(item)
  const { kept, dropped } = reviewCorrections(result.value.corrections, request.answer, entry, key)
  if (!dropped) {
    const also = alsoListedKept(item, request.answer, result.value)
    return toGrade({ ...result.value, corrections: kept }, 'tutor', traceId, also)
  }

  const strictTrace = randomUUID()
  const left = CARD_CLIENT_BUDGET_MS - (Date.now() - startedAt)
  const strict = await askOnce(
    strictTrace,
    true,
    correlationId,
    Math.min(CARD_TIMEOUT_MS, Math.max(CARD_STRICT_MIN_MS, left)),
  )
  const also = alsoListedKept(item, request.answer, strict.value)
  return toGrade({ ...strict.value, corrections: [] }, 'tutor', strictTrace, also)
}

export async function askCard(request: StructuredRequest, signal: AbortSignal, parser?: Parser) {
  const { askStructured } = await import('./anthropic')
  return askStructured(request, cardOutputSchema, signal, parser)
}

export async function askCardRegrade(
  request: StructuredRequest,
  signal: AbortSignal,
  parser?: Parser,
) {
  const { askStructured } = await import('./anthropic')
  return askStructured(request, cardRegradeOutputSchema, signal, parser)
}
