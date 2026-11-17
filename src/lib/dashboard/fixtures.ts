import type { ProgressData } from '../progress/client'

import type { LearningData, SystemData } from './client'

export const SYSTEM_FIXTURE: SystemData = {
  today: 'Aug 18',
  cost: { today: 1.38, dailyCap: 5, month: 2.71, monthlyLimit: 50 },
  latency: { cardP50Ms: 1100, cardP95Ms: 1900, practiceP95Ms: 11_400, reviewP95Ms: 3800 },
  calls: { total: 212, fallbacks: 1, micReports: 0 },
  database: { bytes: 126 * 1_048_576, clips: { rows: 612, bytes: 84 * 1_048_576 } },
  evalGate: {
    grader: 'Sonnet 5.5',
    rubric: 'v3',
    categories: {
      schema_valid: 1,
      citation_present: 1,
      verdict_correct: 0.968,
      no_invented_content: 1,
      stays_in_scope: 1,
    },
    heldOutAgreement: 0.961,
    falsePasses: 0,
    adversarial: { held: 15, of: 15 },
    runAt: '2026-08-17T09:12:00.000Z',
  },
  disputes: [
    {
      title: 'Check B1 · Sample Move A',
      status: 'Needs review',
      note: 'The learner said “left side”; grader marked the side missing. Opus re-grade disagreed with the grader. Item pulled from rotation.',
    },
    {
      title: 'Item · Sample Move B timing',
      status: 'Resolved',
      note: 'Opus re-grade agreed with the grader. The cited passage confirmed it.',
    },
  ],
  traces: [
    {
      id: 'rep_4f2a·19c',
      call: 'Practice report · 5 checks · 1 must-pass miss',
      latencyMs: 10_800,
      costUsd: 0.041,
      model: 'Sonnet',
    },
    {
      id: 'rep_4f2a·19b',
      call: 'Self-review (spoken first)',
      latencyMs: 3600,
      costUsd: 0.012,
      model: 'Sonnet',
    },
    {
      id: 'card_88d1·03',
      call: 'Recall · Sample Move A pace · Good',
      latencyMs: 1200,
      costUsd: 0.002,
      model: 'Haiku',
    },
    {
      id: 'card_88d1·02',
      call: 'List recall · RSG order · Hard',
      latencyMs: null,
      costUsd: 0,
      model: null,
    },
  ],
}

export const SYSTEM_EMPTY_FIXTURE: SystemData = {
  today: 'Aug 17',
  cost: { today: 0, dailyCap: 5, month: 0, monthlyLimit: 50 },
  latency: { cardP50Ms: null, cardP95Ms: null, practiceP95Ms: null, reviewP95Ms: null },
  calls: { total: 0, fallbacks: 0, micReports: 0 },
  database: { bytes: 9 * 1_048_576, clips: { rows: 0, bytes: 0 } },
  evalGate: null,
  disputes: [],
  traces: [],
}

export const MUST_PASS_LABELS = [
  'Give one pace cue while the move runs',
  'Close the set with a clear finish',
  'Place each hand and foot by name',
  "Say the move's name before it starts",
]

export const LEARNING_FIXTURE: LearningData = {
  sessions: [
    { label: 'Aug 17 · session 1', accuracy: 0.79 },
    { label: 'Aug 17 · session 2', accuracy: 0.86 },
    { label: 'Aug 18 · session 1', accuracy: 0.94 },
  ],
  readiness: [
    { category: 'Floor work', recall: 0.72 },
    { category: 'Standing work', recall: 0.58 },
    { category: 'Glossary', recall: 0.91 },
    { category: 'Coaching voice', recall: 0.64 },
  ],
  practices: [
    { label: 'Practice 1', passed: 11, of: 19 },
    { label: 'Practice 2', passed: 14, of: 19 },
    { label: 'Practice 3', passed: 16, of: 19 },
    { label: 'Practice 4', passed: 17, of: 19 },
  ],
  mostMissed: 'pace cue (3 of 4), clear finish (2 of 4)',
  baseline: { label: 'Baseline · Aug 17', pct: 0.41, of: 60 },
  now: { pct: 0.63, of: 60 },

  northStar: {
    sequencesInARow: [4, 7],
    of: 3,
    reachedOn: null,
    target: 'Aug 18',
    daysLeft: 0,
    mastery: MUST_PASS_LABELS.map((label, index) => ({
      label,
      sequences: index < 3 ? 3 : index % 3,
      mastered: index < 3,
    })),
  },
}

export const LEARNING_EMPTY_FIXTURE: LearningData = {
  sessions: [],
  readiness: [],
  practices: [],
  mostMissed: null,
  baseline: null,
  now: null,
  northStar: {
    sequencesInARow: [],
    of: 3,
    reachedOn: null,
    target: 'Aug 18',
    daysLeft: 1,
    mastery: MUST_PASS_LABELS.map((label) => ({
      label,
      sequences: 0,
      mastered: false,
    })),
  },
}

export const PROGRESS_FIXTURE: ProgressData = {
  name: 'Coach Alex',
  title: 'Starter',
  avatarUrl: '/api/avatar',
  practiceSessions: { done: 1, of: 3 },
  practiceClasses: { done: 0, of: 10 },
  readiness: [
    { category: 'Floor work', ready: 0.72 },
    { category: 'Standing work', ready: 0.58 },
    { category: 'Glossary', ready: 0.91 },
    { category: 'Coaching voice', ready: 0.64 },
  ],
  isDayOne: false,
}

export const PROGRESS_WITH_PRACTICES_FIXTURE: ProgressData = {
  ...PROGRESS_FIXTURE,
  practices: [
    {
      label: 'Practice 4 · Warm-up',
      passed: 17,
      of: 19,
      missed: ['pace cue'],
    },
    {
      label: 'Practice 3 · Main set',
      passed: 16,
      of: 19,
      missed: ['pace cue', 'setup'],
    },
    {
      label: 'Practice 2 · Warm-up',
      passed: 14,
      of: 19,
      missed: ['name first', 'setup', 'pace cue'],
    },
  ],
}

export const PROGRESS_DAY_ONE_FIXTURE: ProgressData = {
  name: 'Coach Alex',
  title: 'Starter',
  avatarUrl: '/api/avatar',
  practiceSessions: { done: 0, of: 3 },
  practiceClasses: { done: 0, of: 10 },
  readiness: [],
  isDayOne: true,
}
