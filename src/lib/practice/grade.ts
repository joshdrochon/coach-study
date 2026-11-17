import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import type { Db } from '../db/client'
import { gateResults, practices } from '../db/schema'
import { ROLES } from '../grader/models'
import type { Parser, StructuredRequest } from '../tutor/anthropic'
import { TutorError } from '../tutor/errors'
import { runTutorCall } from '../tutor/run'

import type { PracticeReport, PracticeRequest, ReportCheck, SceneView } from './contract'
import { evaluate, type CodeVerdict, type Transcript } from './engine'
import { sceneMoves, type Method, type PracticeScene } from './method'
import {
  applyTutor,
  plainLine,
  practiceSystemPrompt,
  practiceUserPrompt,
  tutorOutputSchema,
  type TutorOutput,
} from './tutor'

export type AskTutor = (
  request: StructuredRequest,
  signal: AbortSignal,
) => ReturnType<typeof askPracticeTutor>

export async function askPracticeTutor(
  request: StructuredRequest,
  signal: AbortSignal,
  parser?: Parser,
) {
  const { askStructured } = await import('../tutor/anthropic')
  return askStructured(request, tutorOutputSchema, signal, parser)
}

export const PRACTICE_TIMEOUT_MS = 20_000
const PRACTICE_ESTIMATE_USD = 0.03

export function sceneView(method: Method, scene: PracticeScene): SceneView {
  return {
    id: scene.id,
    kind: scene.kind,
    title: scene.title,
    moves: sceneMoves(method, scene).map((move) => ({ id: move.id, name: move.name })),
    checks: method.checklist.gates
      .filter((gate) => gate.appliesTo.includes(scene.kind))
      .map((gate) => ({ gateId: gate.id, label: gate.label, mustPass: gate.mustPass })),
  }
}

const storedSceneSchema = z.object({ sceneId: z.string() })

// The scene practiced least so far, first in file order on a tie, so every sequence comes round.
export async function nextScene(db: Db, method: Method): Promise<PracticeScene> {
  const rows = await db.select({ scene: practices.scene }).from(practices)
  const counts = new Map<string, number>()
  for (const { scene } of rows) {
    const parsed = storedSceneSchema.safeParse(scene)
    if (parsed.success) counts.set(parsed.data.sceneId, (counts.get(parsed.data.sceneId) ?? 0) + 1)
  }
  const [first, ...rest] = method.scenes
  if (!first) throw new Error('no practice scenes')
  return rest.reduce(
    (best, scene) => ((counts.get(scene.id) ?? 0) < (counts.get(best.id) ?? 0) ? scene : best),
    first,
  )
}

// Without the tutor the feedback still names something real: the first pass and the first
// must-pass miss, by their labels.
export function codeFeedback(checks: readonly ReportCheck[]) {
  const passed = checks.find((c) => c.verdict === 'pass')
  const missed =
    checks.find((c) => c.verdict === 'miss' && c.mustPass) ??
    checks.find((c) => c.verdict === 'miss')
  return {
    wentWell: passed ? `${passed.label}: done.` : 'You finished the practice.',
    toWorkOn: missed ? `${missed.label}.` : 'Keep every check passing next time.',
    by: 'code' as const,
  }
}

function toChecks(method: Method, verdicts: readonly CodeVerdict[]): ReportCheck[] {
  return verdicts.map((v) => {
    const gate = method.checklist.gates.find((g) => g.id === v.gateId)
    return {
      gateId: v.gateId,
      label: gate?.label ?? v.gateId,
      mustPass: gate?.mustPass ?? false,
      verdict: v.verdict,
      by: v.by,
      quote: v.quote,
      note: v.note,
      ...(v.moves ? { moves: v.moves } : {}),
    }
  })
}

export type GradeOptions = {
  db: Db
  method: Method
  scene: PracticeScene
  request: PracticeRequest
  ask: AskTutor
  now?: () => Date
}

export async function gradePractice(options: GradeOptions): Promise<PracticeReport> {
  const { db, method, scene, request, ask } = options
  const now = (options.now ?? (() => new Date()))()
  const transcript: Transcript = {
    words: request.words,
    marks: request.marks,
    doneAtMs: request.doneAtMs,
  }
  const code = evaluate(method, scene, transcript)

  const traceId = randomUUID()
  let verdicts = code
  let tutor: TutorOutput | null = null
  try {
    const result = await runTutorCall(
      {
        db,
        kind: 'practice-grade',
        traceId,
        estimateUsd: PRACTICE_ESTIMATE_USD,
        timeoutMs: PRACTICE_TIMEOUT_MS,
        verdict: (output: TutorOutput) => ({ sceneId: scene.id, checks: output.checks.length }),
      },
      (signal) =>
        ask(
          {
            model: ROLES.practiceGrader,
            system: [
              { type: 'text', text: practiceSystemPrompt(), cache_control: { type: 'ephemeral' } },
            ],
            messages: [
              {
                role: 'user',
                content: practiceUserPrompt(method, scene, transcript, code, request.selfReview),
              },
            ],
            maxTokens: 800,
            effort: 'low',
          },
          signal,
        ),
    )
    tutor = result.value
    verdicts = applyTutor(code, tutor, request.words)
  } catch (error) {
    // The practice is still graded and kept: tutor checks stay unjudged.
    if (!(error instanceof TutorError)) throw error
  }

  const checks = toChecks(method, verdicts)
  const judgedMustPass = checks.filter(
    (c) => c.mustPass && (c.verdict === 'pass' || c.verdict === 'miss'),
  )
  const passed = judgedMustPass.filter((c) => c.verdict === 'pass').length
  const feedback = tutor
    ? {
        wentWell: plainLine(tutor.wentWell),
        toWorkOn: plainLine(tutor.toWorkOn),
        by: 'tutor' as const,
      }
    : codeFeedback(checks)
  const practiceId = randomUUID()
  const report: PracticeReport = {
    practiceId,
    sceneId: scene.id,
    checks,
    mustPass: { passed, of: judgedMustPass.length },
    allMustPass: passed === judgedMustPass.length,
    feedback,
    tutor: tutor ? 'ok' : 'unavailable',
  }

  await db.transaction(async (tx) => {
    await tx.insert(practices).values({
      id: practiceId,
      deviceId: request.deviceId ?? 'device',
      sceneKind: scene.kind,
      scene: { sceneId: scene.id, sequence: scene.sequence },
      transcript: {
        entry: request.entry,
        words: request.words,
        marks: request.marks,
        doneAtMs: request.doneAtMs,
      },
      selfReview: request.selfReview ?? null,
      grade: report,
      passed: report.allMustPass,
      gradedBy: tutor ? 'tutor' : null,
      traceId: tutor ? traceId : null,
      startedAt: new Date(now.getTime() - request.doneAtMs),
      doneAt: now,
    })
    const stored = checks.flatMap((c) =>
      c.verdict === 'unjudged' ? [] : [{ practiceId, gateId: c.gateId, verdict: c.verdict }],
    )
    if (stored.length > 0) await tx.insert(gateResults).values(stored)
  })
  return report
}
