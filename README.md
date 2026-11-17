# Coach Study

**An AI study and practice coach built to get new fitness coaches class-ready faster, with less
trainer time, and a readiness signal you can actually measure.**

Built for, and used by, a coach in training.

This public copy ships with **invented sample content** (a made-up "Sample Move" method, a small
sample guide and ~435 generated cards). The real training material stays private; the app is
designed so content and rules are data, and can be swapped without touching code.

---

## The problem

Studios that train their own coaches run into the same gaps:

| Gap                                                                                     | What it costs                                               |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| New coaches learn from a long manual, and practice depends on a senior coach being free | Trainer hours, slower ramp, uneven preparation              |
| "Is this coach ready?" is a judgment call                                               | Inconsistent standards, late surprises at evaluation        |
| Coaching a class is a spoken skill, but study tools are text-only                       | Coaches who know the material but can't deliver it out loud |
| AI tutors can be confidently wrong, and costs can drift                                 | Bad feedback learned as fact; unpredictable bills           |
| Training content changes                                                                | Hard-coded tools go stale or need a developer               |

## What Coach Study does about it

- **Daily, self-serve study.** Spaced repetition (FSRS) picks what to review each day, with a
  baseline check on day one, daily new-card caps and a difficulty band that keeps accuracy near
  target. Short sessions fit around a working schedule.
- **Practice out loud, graded.** In **Mic practice** the learner coaches a sequence aloud as if
  teaching a class. One rules engine grades the transcript against a must-pass checklist (what
  must be said, in what order, what to avoid, what to repeat), and an AI tutor gives one
  "went well" and one "work on" note.
- **A readiness signal, not a guess.** Progress tracks mastery of every check and a clear goal:
  every must-pass check met on N different sequences in a row.
- **AI feedback you can trust.** Grades are grounded in each card's source passage, returned as
  validated structured output, and a learner can flag "This looks wrong" for an independent
  re-grade. The practice tutor's pass only counts if it quotes the learner's actual words, and it
  cannot overrule the rules engine.
- **Costs under control.** A spend ledger and daily cap on model calls; text-to-speech clips are
  generated once and cached, under a daily character budget, with the device voice as fallback.
- **Content and rules as data.** Cards, passages, glossary, schedule and the practice method all
  live in validated JSON under `content/`. A new program is a data change, not a code change.
- **Works on studio Wi-Fi.** iPad-first, with a local outbox that keeps studying offline and syncs
  later.
- **Admin view.** Cost and latency, flagged grades, learner progress, and voice checks.

## How it's built

| Layer      | Choice                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| App        | Next.js 16 (App Router), React 19, TypeScript, CSS modules                                            |
| Data       | Drizzle ORM; Postgres (Neon) in production, PGlite in-process for dev and tests                       |
| AI         | Anthropic SDK: structured grading, re-grading, practice tutor, spend ledger and daily cap             |
| Scheduling | `ts-fsrs`, wrapped in `src/lib/scheduler`                                                             |
| Practice   | One data-driven rules engine (`src/lib/practice`) reading `content/method/*.json`                     |
| Voice      | Browser speech recognition in; ElevenLabs text-to-speech out, cached in the database                  |
| Offline    | Local outbox and IndexedDB copy, synced when online                                                   |
| Design     | Tokens in `design/tokens.json`, generated into CSS and TS; one `<Text>` component for all type styles |

**Design choices worth a look**

- **One engine, many rule sets.** The practice grader knows four rule kinds (say, avoid, repeat,
  tutor) and nothing about any specific method. The rules are validated at load, so a bad rule
  file fails at startup, not mid-session. The engine is about 1,300 lines including its UI.
- **Code and AI each do what they're good at.** Deterministic checks are decided in code; the
  model only judges what code can't, and gets the code's verdicts as fixed facts.
- **Prompt-injection hygiene.** Learner speech is fenced as data in every prompt.
- **Graceful degradation.** No API key, no network or no voice service: the app still grades
  (from the rules engine), still studies (offline) and still speaks (device voice).

Main folders:

- `src/app`: pages and API routes (`/api/study/*`, `/api/tutor/*`, `/api/practice/*`, `/api/tts`, admin)
- `src/lib/practice`, `src/lib/gates`: the practice rules engine and checklist schema
- `src/lib/grader`, `src/lib/tutor`: prompts, output schemas, model calls and retries
- `src/lib/scheduler`, `src/lib/study`: queue, session state machine, sync and progress
- `content/`: sample cards, passages and the method files under `content/method/`
- `drizzle/`: SQL migrations

## Run it with the sample data

Requirements: Node 22.12+ and pnpm 10.

```sh
pnpm install
pnpm fonts                   # optional: fetches the Switzer web fonts from Fontshare
cp .env.example .env.local   # set APP_PASSCODE (4 digits), ADMIN_PASSCODE (16+), SESSION_SECRET (32+)
pnpm dev                     # http://localhost:3000, PGlite database in .pglite-dev
```

The Switzer font's license does not allow committing it, so `pnpm fonts` downloads it into
`public/fonts/switzer/` (gitignored). Without it the app falls back to the system sans-serif.
The headline font (Nimbus Sans Narrow) ships under the AGPL with a font exception; its license
and `COPYING` are in `design/assets/fonts/` and `public/`.

AI grading needs `ANTHROPIC_API_KEY`; without it, practice is still graded by the rules engine.
Voice and reminders are optional. To use your own program, replace the files under `content/`;
the schemas validate them at load.

## Quality

```sh
pnpm typecheck   # next typegen + tsc
pnpm lint        # ESLint (typescript-eslint strict), zero warnings
pnpm test        # Vitest: 1,500+ unit and route tests on an in-memory Postgres
pnpm build
```

- API routes are tested end to end against in-memory Postgres with the real migrations.
- Coverage thresholds in `vitest.config.ts`, stricter for the scheduler, grader and rules engine.
- A guard stops tests and local dev from ever touching a production database.
- Pre-commit lint, pre-push type check and tests; CI runs lint, typecheck, tests with coverage,
  build and a dependency audit on every push.
