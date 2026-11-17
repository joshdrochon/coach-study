import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Item } from '../content/schema'
import { openTestDb, type Db } from '../db/client'
import { traces } from '../db/schema'

import { cardRequestSchema, gradeCard } from './card'

const item: Item = {
  id: 'term-range',
  category: 'Floor work',
  type: 'recall',
  exercise: 'Sample move a',
  facet: 'parts',
  prompt: 'Sample move a: which parts carry it?',
  answer: 'A mat; a strap and the rollers',
  explanation: 'The guide lists a mat as the main part.',
  citations: [{ passageId: 'm008-station-parts', quote: 'A mat first' }],
}

const usage = {
  input_tokens: 1500,
  output_tokens: 120,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}

describe('gradeCard', () => {
  let db: Db
  beforeEach(async () => {
    db = await openTestDb()
  })

  it('grades an exact answer by code, with no model call and no cost', async () => {
    const ask = vi.fn()
    const grade = await gradeCard(
      db,
      item,
      {
        itemId: item.id,
        answer: 'a mat; a strap and the rollers',
        answerMs: 3000,
        hintUsed: false,
      },
      't1',
      ask,
    )
    expect(grade).toMatchObject({ result: 'right', source: 'code', traceId: null })
    expect(ask).not.toHaveBeenCalled()
  })

  it('asks Sonnet to judge meaning, with the cached system prompt, and traces the call', async () => {
    const ask = vi.fn(() =>
      Promise.resolve({
        value: {
          corrections: [],
          result: 'partial' as const,
          missing: ['rollers'],
          inOrder: null,
          fix: 'Add rollers.',
          followUp: null,
          alsoListed: null,
        },
        model: 'claude-sonnet-5-5' as const,
        usage,
      }),
    )
    const grade = await gradeCard(
      db,
      item,
      { itemId: item.id, answer: 'a mat and a strap', answerMs: 4000, hintUsed: false },
      't2',
      ask,
    )

    expect(grade).toMatchObject({
      result: 'partial',
      spoken: 'Almost. Add rollers.',
      source: 'tutor',
      traceId: 't2',
    })
    expect(grade).not.toHaveProperty('fix')
    const [request] = ask.mock.calls[0] as unknown as [
      { model: string; system: { cache_control?: unknown }[]; effort?: string },
    ]
    expect(request.model).toBe('claude-sonnet-5-5')
    expect(request.effort).toBe('low')
    expect(request.system[0]?.cache_control).toEqual({ type: 'ephemeral' })
    const [row] = await db.select().from(traces).where(eq(traces.id, 't2'))
    expect(row?.outcome).toBe('ok')
  })

  it('records the grader’s verdict in the call’s trace, next to the correlation ID', async () => {
    const ask = vi.fn(() =>
      Promise.resolve({
        value: {
          corrections: [],
          result: 'wrong' as const,
          missing: ['A mat'],
          inOrder: null,
          fix: 'A mat.',
          followUp: null,
          alsoListed: null,
        },
        model: 'claude-sonnet-5-5' as const,
        usage,
      }),
    )
    await gradeCard(
      db,
      item,
      { itemId: item.id, answer: 'pegs', answerMs: 3000, hintUsed: false },
      't3',
      ask,
      'corr-card',
    )
    const [row] = await db.select().from(traces).where(eq(traces.id, 't3'))
    expect(row?.result).toEqual({
      correlationId: 'corr-card',
      itemId: item.id,
      result: 'wrong',
      missing: ['A mat'],
      inOrder: null,
      corrections: 0,
    })
  })

  it('records the error, and no verdict, when the grader fails', async () => {
    const ask = vi.fn(() => Promise.reject(new Error('socket hang up')))
    await expect(
      gradeCard(
        db,
        item,
        { itemId: item.id, answer: 'pegs', answerMs: 3000, hintUsed: false },
        't4',
        ask,
      ),
    ).rejects.toMatchObject({ kind: 'upstream' })
    const [row] = await db.select().from(traces).where(eq(traces.id, 't4'))
    expect(row).toMatchObject({ outcome: 'fallback', error: 'upstream', result: null })
  })

  const readsAs = (corrections: { heard: string; readAs: string }[]) =>
    vi.fn(() =>
      Promise.resolve({
        value: {
          corrections,
          result: 'right' as const,
          missing: [],
          inOrder: null,
          fix: '',
          followUp: null,
          alsoListed: null,
        },
        model: 'claude-sonnet-5-5' as const,
        usage,
      }),
    )
  const promptOf = (ask: ReturnType<typeof readsAs>) => {
    const [request] = ask.mock.calls[0] as unknown as [{ messages: { content: string }[] }]
    return request.messages[0]?.content ?? ''
  }

  it('tells the grader a spoken answer is a transcript and keeps the words it read as sound-alikes', async () => {
    const ask = readsAs([{ heard: 'rulers', readAs: 'rollers' }])
    const grade = await gradeCard(
      db,
      item,
      {
        itemId: item.id,
        answer: 'a mat, a strap and the rulers',
        answerMs: 3000,
        hintUsed: false,
        entry: 'voice',
      },
      't5',
      ask,
    )
    expect(promptOf(ask)).toContain(
      'THEIR ANSWER (speech recognition): a mat, a strap and the rulers',
    )
    expect(grade.corrections).toEqual([{ heard: 'rulers', readAs: 'rollers' }])
    const [row] = await db.select().from(traces).where(eq(traces.id, 't5'))

    expect(row?.result).toMatchObject({ corrections: 1 })
    expect(JSON.stringify(row?.result)).not.toContain('rulers')
  })

  const callOf = (ask: ReturnType<typeof readsAs>, n: number) => {
    const [request] = ask.mock.calls[n] as unknown as [{ messages: { content: string }[] }]
    return request.messages[0]?.content ?? ''
  }

  it('a typed answer is marked typed; a correction the model returns anyway is dropped and the answer is graded again strictly', async () => {
    const ask = readsAs([{ heard: 'rulers', readAs: 'rollers' }])
    const grade = await gradeCard(
      db,
      item,
      {
        itemId: item.id,
        answer: 'a mat, a strap and the rulers',
        answerMs: 3000,
        hintUsed: false,
        entry: 'typed',
      },
      't6',
      ask,
    )
    expect(callOf(ask, 0)).toContain('THEIR ANSWER (typed): a mat, a strap and the rulers')
    expect(callOf(ask, 0)).not.toContain('STRICT')

    expect(ask).toHaveBeenCalledTimes(2)
    expect(callOf(ask, 1)).toContain('STRICT: grade every word of THEIR ANSWER exactly as written')
    expect(grade.corrections).toEqual([])

    const rows = await db.select().from(traces)
    expect(rows).toHaveLength(2)
    expect(grade.traceId).not.toBe('t6')
    expect(rows.map((row) => row.id)).toContain(grade.traceId)
  })

  it('a typed answer with nothing read as a sound-alike is graded once', async () => {
    const ask = readsAs([])
    await gradeCard(
      db,
      item,
      {
        itemId: item.id,
        answer: 'a mat and rulers',
        answerMs: 3000,
        hintUsed: false,
        entry: 'typed',
      },
      't6b',
      ask,
    )
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('a spoken correction of words the learner never said drops, and the answer is graded again strictly', async () => {
    const ask = readsAs([
      { heard: 'boulders', readAs: 'rollers' },
      { heard: 'rulers', readAs: 'rollers' },
    ])
    const grade = await gradeCard(
      db,
      item,
      { itemId: item.id, answer: 'a mat and rulers', answerMs: 3000, hintUsed: false },
      't7',
      ask,
    )
    expect(ask).toHaveBeenCalledTimes(2)
    expect(callOf(ask, 1)).toContain('STRICT')
    expect(grade.corrections).toEqual([])
  })

  it('a spoken correction that reads a word as something the card never says drops, and is graded again strictly', async () => {
    const ask = readsAs([{ heard: 'rulers', readAs: 'the bar lift' }])
    const grade = await gradeCard(
      db,
      item,
      { itemId: item.id, answer: 'a mat and rulers', answerMs: 3000, hintUsed: false },
      't7b',
      ask,
    )
    expect(ask).toHaveBeenCalledTimes(2)
    expect(grade.corrections).toEqual([])
  })

  it('keeps the model words in the card as the card says them, in plain punctuation, with one call', async () => {
    const ask = readsAs([{ heard: 'rulers', readAs: 'Rollers;' }])
    const grade = await gradeCard(
      db,
      item,
      { itemId: item.id, answer: 'a mat and rulers', answerMs: 3000, hintUsed: false },
      't7c',
      ask,
    )
    expect(ask).toHaveBeenCalledTimes(1)
    expect(grade.corrections).toEqual([{ heard: 'rulers', readAs: 'Rollers.' }])
  })

  it('if the strict grade cannot be made, there is no grade (never the lenient one)', async () => {
    let calls = 0
    const ask = vi.fn(() => {
      calls += 1
      if (calls === 2) return Promise.reject(new Error('socket hang up'))
      return Promise.resolve({
        value: {
          corrections: [{ heard: 'rulers', readAs: 'rollers' }],
          result: 'right' as const,
          missing: [],
          inOrder: null,
          fix: '',
          followUp: null,
          alsoListed: null,
        },
        model: 'claude-sonnet-5-5' as const,
        usage,
      })
    })
    await expect(
      gradeCard(
        db,
        item,
        {
          itemId: item.id,
          answer: 'a mat and rulers',
          answerMs: 3000,
          hintUsed: false,
          entry: 'choice',
        },
        't7d',
        ask as never,
      ),
    ).rejects.toMatchObject({ kind: 'upstream' })
  })

  it('reads a request with no entry (from an older app) as spoken', () => {
    const parsed = cardRequestSchema.parse({
      itemId: 'x',
      answer: 'y',
      answerMs: 1,
      hintUsed: false,
    })
    expect(parsed.entry).toBe('voice')
    expect(
      cardRequestSchema.safeParse({
        itemId: 'x',
        answer: 'y',
        answerMs: 1,
        hintUsed: false,
        entry: 'pasted',
      }).success,
    ).toBe(false)
  })

  it('validates requests', () => {
    expect(
      cardRequestSchema.safeParse({ itemId: 'x', answer: 'y', answerMs: -1, hintUsed: false })
        .success,
    ).toBe(false)
  })
})
