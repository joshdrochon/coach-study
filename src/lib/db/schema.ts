import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { REVIEW_EVENT_MODES } from './review-modes'

export const apiSpend = pgTable(
  'api_spend',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    day: date('day').notNull(),
    scope: text('scope', { enum: ['app', 'build'] }).notNull(),
    purpose: text('purpose').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    usd: real('usd').notNull(),
    traceId: text('trace_id'),
  },
  (table) => [index('api_spend_scope_day').on(table.scope, table.day)],
)

export const traces = pgTable(
  'traces',
  {
    id: text('id').primaryKey(),

    kind: text('kind', {
      enum: [
        'card-grade',
        'practice-grade',
        'practice-coaching',
        'explain',
        'chat',
        'dispute',
        'eval',
        'tts',

        'mic',
      ],
    }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    totalMs: integer('total_ms'),
    costUsd: real('cost_usd').notNull().default(0),
    outcome: text('outcome', { enum: ['ok', 'fallback', 'error'] }).notNull(),

    steps: jsonb('steps').notNull(),
    result: jsonb('result'),
    error: text('error'),
  },
  (table) => [index('traces_started').on(table.startedAt)],
)

export const counters = pgTable('counters', {
  key: text('key').primaryKey(),
  value: numeric('value', { precision: 14, scale: 6, mode: 'number' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

const bytea = customType<{ data: Uint8Array<ArrayBuffer>; driverData: Uint8Array | string }>({
  dataType: () => 'bytea',
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) =>
    new Uint8Array(
      typeof value === 'string' ? Buffer.from(value.replace(/^\\x/, ''), 'hex') : value,
    ),
})

export const ttsClips = pgTable('tts_clips', {
  id: text('id').primaryKey(),
  voiceKey: text('voice_key').notNull(),
  chars: integer('chars').notNull(),
  audio: bytea('audio').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const authLockouts = pgTable('auth_lockouts', {
  key: text('key').primaryKey(),
  failures: integer('failures').notNull().default(0),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull().defaultNow(),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
})

export const voiceTestRuns = pgTable('voice_test_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  mode: text('mode', { enum: ['safari-tab', 'home-screen'] }).notNull(),
  userAgent: text('user_agent').notNull(),
  sentencesTotal: integer('sentences_total').notNull(),
  sentencesHeard: integer('sentences_heard').notNull(),
  keyTermsTotal: integer('key_terms_total').notNull(),
  keyTermsMissed: integer('key_terms_missed').notNull(),
  errorRate: real('error_rate').notNull(),
  readAloudWorked: boolean('read_aloud_worked').notNull(),
  stalls: integer('stalls').notNull(),
  details: jsonb('details').notNull(),
})

export { REVIEW_EVENT_MODES }

export const reviewEvents = pgTable(
  'review_events',
  {
    id: uuid('id').primaryKey(),
    deviceId: text('device_id').notNull(),
    itemId: text('item_id').notNull(),
    mode: text('mode', { enum: REVIEW_EVENT_MODES }).notNull(),
    result: text('result', { enum: ['right', 'partial', 'wrong'] }).notNull(),

    rating: integer('rating').notNull(),
    proposedRating: integer('proposed_rating').notNull(),
    overridden: boolean('overridden').notNull().default(false),
    answerText: text('answer_text').notNull().default(''),
    answerMs: integer('answer_ms').notNull(),
    hintUsed: boolean('hint_used').notNull().default(false),

    hintImposed: boolean('hint_imposed').notNull().default(false),

    format: text('format', { enum: ['free', 'choices'] })
      .notNull()
      .default('free'),
    gradedBy: text('graded_by', { enum: ['tutor', 'self', 'code'] }).notNull(),
    traceId: text('trace_id'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull(),

    changedAt: timestamp('changed_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('review_events_item').on(table.itemId, table.reviewedAt),
    index('review_events_received').on(table.receivedAt),
  ],
)

export const cardStates = pgTable(
  'card_states',
  {
    itemId: text('item_id').primaryKey(),
    card: jsonb('card').notNull(),
    due: timestamp('due', { withTimezone: true }).notNull(),
    reps: integer('reps').notNull(),
    lapses: integer('lapses').notNull(),
    eventCount: integer('event_count').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('card_states_due').on(table.due)],
)

export const practices = pgTable(
  'practices',
  {
    id: uuid('id').primaryKey(),
    deviceId: text('device_id').notNull(),
    sceneKind: text('scene_kind').notNull(),
    scene: jsonb('scene').notNull(),
    transcript: jsonb('transcript').notNull(),
    selfReview: jsonb('self_review'),
    grade: jsonb('grade'),
    passed: boolean('passed'),
    gradedBy: text('graded_by', { enum: ['tutor', 'self'] }),
    traceId: text('trace_id'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    doneAt: timestamp('done_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('practices_done').on(table.doneAt)],
)

export const gateResults = pgTable(
  'gate_results',
  {
    practiceId: uuid('practice_id').notNull(),
    gateId: text('gate_id').notNull(),
    verdict: text('verdict', { enum: ['pass', 'miss', 'not-applicable'] }).notNull(),
  },
  (table) => [
    index('gate_results_gate').on(table.gateId),
    index('gate_results_practice').on(table.practiceId),
  ],
)

export const practicePhases = pgTable(
  'practice_phases',
  {
    practiceId: uuid('practice_id').primaryKey(),

    status: text('status', { enum: ['running', 'done', 'failed', 'single'] }).notNull(),

    coachingSha: text('coaching_sha').notNull(),

    silenceMs: integer('silence_ms').notNull(),

    gates: jsonb('gates').notNull(),
    answer: jsonb('answer'),
    traceId: text('trace_id'),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [index('practice_phases_started').on(table.startedAt)],
)

export const disputes = pgTable(
  'disputes',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    kind: text('kind', { enum: ['card', 'practice'] }).notNull(),
    itemId: text('item_id'),
    practiceId: uuid('practice_id'),
    gateId: text('gate_id'),
    note: text('note').notNull().default(''),
    regrade: jsonb('regrade'),
    outcome: text('outcome', { enum: ['pending', 'upheld', 'overturned', 'pulled'] })
      .notNull()
      .default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),

    flagId: uuid('flag_id'),
  },
  (table) => [uniqueIndex('disputes_flag_id').on(table.flagId)],
)

export const evalCaseDrafts = pgTable(
  'eval_case_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    disputeId: uuid('dispute_id').notNull(),
    flagId: uuid('flag_id'),
    itemId: text('item_id').notNull(),

    card: jsonb('card').notNull(),
    words: text('words').notNull(),

    wordsFrom: text('words_from', { enum: ['answer', 'note'] }).notNull(),

    entry: text('entry', { enum: ['voice', 'typed', 'choice'] }).notNull(),
    note: text('note').notNull().default(''),
    firstResult: text('first_result', { enum: ['right', 'partial', 'wrong'] }).notNull(),
    opusModel: text('opus_model').notNull(),
    opusResult: text('opus_result', { enum: ['right', 'partial', 'wrong'] }).notNull(),
    opusReason: text('opus_reason').notNull(),
    opusTraceId: text('opus_trace_id'),
    answeredAt: timestamp('answered_at', { withTimezone: true }).notNull(),
    flaggedAt: timestamp('flagged_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    status: text('status', { enum: ['draft', 'approved', 'fixed', 'rejected'] })
      .notNull()
      .default('draft'),

    expected: text('expected', { enum: ['right', 'partial', 'wrong'] }),
    expectedReason: text('expected_reason'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('eval_case_drafts_dispute').on(table.disputeId),
    index('eval_case_drafts_status').on(table.status, table.createdAt),
  ],
)

export const itemFlags = pgTable('item_flags', {
  itemId: text('item_id').primaryKey(),
  reason: text('reason', { enum: ['this-looks-wrong', 'dispute', 'reviewer'] }).notNull(),
  flaggedAt: timestamp('flagged_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolution: text('resolution'),
})

export const profile = pgTable('profile', {
  id: integer('id').primaryKey().default(1),
  title: text('title', {
    enum: ['Starter', 'Practitioner', 'Lead', 'Mentor'],
  })
    .notNull()
    .default('Starter'),
  practiceSessionsDone: integer('practice_sessions_done').notNull().default(0),
  practiceClassesDone: integer('practice_classes_done').notNull().default(0),
  avatarJpegBase64: text('avatar_jpeg_base64'),
  firstRunAt: timestamp('first_run_at', { withTimezone: true }),
  welcomedAt: timestamp('welcomed_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

  dataEpoch: integer('data_epoch').notNull().default(0),
})

export const reviewerFeedback = pgTable('reviewer_feedback', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionDate: date('session_date').notNull(),
  wentWell: text('went_well').notNull(),
  toWorkOn: text('to_work_on').notNull(),
  enteredAt: timestamp('entered_at', { withTimezone: true }).notNull().defaultNow(),
})

export const baselines = pgTable('baselines', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind', { enum: ['day-1', 'before-practice-day', 'before-first-class'] }).notNull(),
  takenAt: timestamp('taken_at', { withTimezone: true }).notNull().defaultNow(),
  results: jsonb('results').notNull(),
})

export const evalRuns = pgTable(
  'eval_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),

    set: text('set', {
      enum: ['golden', 'adversarial', 'heldout', 'ablation'],
    }).notNull(),
    grader: text('grader').notNull(),
    strategy: text('strategy').notNull(),
    rubric: text('rubric').notNull(),
    commit: text('commit').notNull(),
    cases: integer('cases').notNull(),
    agreement: real('agreement').notNull(),
    falsePasses: integer('false_passes').notNull(),
    categories: jsonb('categories').notNull(),
    costUsd: real('cost_usd').notNull(),
    passed: boolean('passed').notNull(),
  },
  (table) => [index('eval_runs_set_time').on(table.set, table.runAt)],
)

export const pushSubscriptions = pgTable('push_subscriptions', {
  endpoint: text('endpoint').primaryKey(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const nudges = pgTable(
  'nudges',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    day: date('day').notNull(),
    seq: integer('seq').notNull(),

    status: text('status', { enum: ['sending', 'sent', 'failed'] }).notNull(),

    reason: text('reason', { enum: ['not-studied', 'cards-left'] }).notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    cardsLeft: integer('cards_left').notNull(),
    delivered: integer('delivered').notNull().default(0),
    failed: integer('failed').notNull().default(0),

    removed: integer('removed').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('nudges_day_seq').on(table.day, table.seq),
    index('nudges_created').on(table.createdAt),
  ],
)
