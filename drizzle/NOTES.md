# Migration notes

Schema changes are migrations with notes. One section per migration in `meta/_journal.json`,
named by its tag: what it changes, why, and what happens to rows already stored.
`src/lib/db/migration-notes.test.ts` fails when a migration has no section here.

## 0000_init

Creates every table from `src/lib/db/schema.ts`: spend and traces, counters, voice clips,
passcode lockouts, voice-test runs, study events and card states, practices and their verdicts,
disputes and flags, eval runs and drafts, the profile, baselines, reviewer feedback and reminders.
New tables only.
