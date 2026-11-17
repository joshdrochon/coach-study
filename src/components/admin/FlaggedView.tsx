'use client'

import { Fragment, useId, useState } from 'react'

import { Button } from '@/components/Button'
import { CancelButton } from '@/components/CancelButton'
import { Card } from '@/components/Card'
import { Text } from '@/components/Text'
import { TextArea } from '@/components/TextArea'
import { Placeholder } from '@/components/progress/Placeholder'
import { useLoad } from '@/components/progress/useLoad'
import { Picker, PickerOption } from '@/components/study/PickerOption'
import { fetchFlagged, sendReview } from '@/lib/dashboard/flagged'
import { formatCount } from '@/lib/dashboard/format'
import {
  REASON_MIN,
  RESULTS,
  type DraftCaseView,
  type FlaggedView as FlaggedData,
  type Result,
  type ReviewRequest,
} from '@/lib/study/flag-cases-contract'

import { AdminAlert } from './AdminAlert'
import styles from './FlaggedView.module.css'
import panels from './panels.module.css'

const RESULT_WORD: Record<Result, string> = { right: 'Right', partial: 'Partial', wrong: 'Wrong' }

const ENTRY_LABEL: Record<DraftCaseView['entry'], string> = {
  voice: 'Their words, as heard (exactly as recorded)',
  typed: 'Their words, as typed (exactly as recorded)',
  choice: 'Their choice (exactly as recorded)',
}

const DONE_WORD = { approved: 'Approved', fixed: 'Fixed', rejected: 'Rejected' } as const

function dateLabel(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.field}>
      <Text as="h4" variant="label" tone="text-muted">
        {label}
      </Text>
      {children}
    </div>
  )
}

function FixForm({
  draft,
  busy,
  onSave,
  onCancel,
}: {
  draft: DraftCaseView
  busy: boolean
  onSave: (expected: Result, reason: string) => void
  onCancel: () => void
}) {
  const [expected, setExpected] = useState<Result>(draft.opusResult)
  const [reason, setReason] = useState(draft.opusReason)
  const [tried, setTried] = useState(false)
  const pickerLabel = useId()
  const short = reason.trim().length < REASON_MIN
  return (
    <form
      className={styles.fix}
      aria-label="Fix the answer key"
      onSubmit={(event) => {
        event.preventDefault()
        setTried(true)
        if (!short) onSave(expected, reason)
      }}
    >
      <Text as="h4" id={pickerLabel} variant="label" tone="text-muted">
        Expected result
      </Text>
      <Picker labelledBy={pickerLabel} three>
        {RESULTS.map((result) => (
          <PickerOption
            key={result}
            selected={expected === result}
            onClick={() => {
              setExpected(result)
            }}
          >
            {RESULT_WORD[result]}
          </PickerOption>
        ))}
      </Picker>
      <TextArea
        id={`reason-${draft.id}`}
        label="Reason (cite the source text or video)"
        value={reason}
        rows={4}
        onChange={(event) => {
          setReason(event.target.value)
        }}
        error={tried && short ? `Write at least ${String(REASON_MIN)} characters.` : undefined}
      />
      <div className={styles.actions}>
        <Button variant="primary" type="submit" disabled={busy}>
          Save fix
        </Button>
        <CancelButton onCancel={onCancel} />
      </div>
    </form>
  )
}

function DraftCard({
  draft,
  onReview,
}: {
  draft: DraftCaseView
  onReview: (request: ReviewRequest) => Promise<boolean>
}) {
  const [fixing, setFixing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const run = async (request: ReviewRequest) => {
    setBusy(true)
    setFailed(false)
    const ok = await onReview(request)

    if (!ok) {
      setBusy(false)
      setFailed(true)
    }
  }
  const sources = draft.card.citations.map((citation) => citation.source).join(' · ')
  return (
    <Card as="article" label={`Flagged card: ${draft.card.prompt}`}>
      <div className={styles.draft}>
        <div className={panels.panelHead}>
          <Text as="h3" variant="body-l-strong">
            {draft.card.prompt}
          </Text>
          <Text variant="caption" tone="text-muted">
            Flagged {dateLabel(draft.flaggedAt)}
          </Text>
        </div>
        <Field label="The card’s answer">
          <Text as="p" variant="body">
            {draft.card.answer}
          </Text>
          {sources ? (
            <Text as="p" variant="caption" tone="text-muted">
              {sources}
            </Text>
          ) : null}
        </Field>
        <Field label={ENTRY_LABEL[draft.entry]}>
          <Text as="p" variant="body-l" className={styles.words} data-learner-words="true">
            {draft.words}
          </Text>
        </Field>
        <Field label="Their note">
          <Text as="p" variant="body" tone={draft.note.trim() ? 'text' : 'text-muted'}>
            {draft.note.trim() ? draft.note : 'No note.'}
          </Text>
        </Field>
        <div className={styles.grades}>
          <Field label="First grade">
            <Text as="p" variant="body-strong">
              {RESULT_WORD[draft.firstResult]}
            </Text>
          </Field>
          <Field label="Opus re-grade">
            <Text as="p" variant="body-strong">
              {RESULT_WORD[draft.opusResult]}
            </Text>
          </Field>
        </div>
        <Field label="Opus’s reason">
          <Text as="p" variant="body">
            {draft.opusReason}
          </Text>
        </Field>
        {failed ? (
          <Text as="p" variant="body-strong" tone="warn-text" role="alert">
            That didn’t save. It may have been reviewed in another tab: reload, or try again.
          </Text>
        ) : null}
        {fixing ? (
          <FixForm
            draft={draft}
            busy={busy}
            onSave={(expected, reason) => {
              void run({ id: draft.id, action: 'fix', expected, reason })
            }}
            onCancel={() => {
              setFixing(false)
            }}
          />
        ) : (
          <div className={styles.actions}>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                void run({ id: draft.id, action: 'approve' })
              }}
            >
              Approve
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setFixing(true)
              }}
            >
              Fix
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                void run({ id: draft.id, action: 'reject' })
              }}
            >
              Reject
            </Button>
          </div>
        )}
      </div>
    </Card>
  )
}

function reviewedLine(reviewed: FlaggedData['reviewed']): string {
  return `Reviewed so far: ${formatCount(reviewed.approved)} approved · ${formatCount(reviewed.fixed)} fixed · ${formatCount(reviewed.rejected)} rejected.`
}

export function FlaggedView() {
  const [state, retry] = useLoad(fetchFlagged)

  const [done, setDone] = useState<
    { id: string; status: keyof typeof DONE_WORD; prompt: string; returned: boolean }[]
  >([])
  if (state.status === 'error') {
    return <AdminAlert error={state.error} retry={retry} next="/admin/flagged" />
  }
  const data = state.status === 'ready' ? state.data : null
  const gone = new Set(done.map((entry) => entry.id))
  const drafts = data?.drafts.filter((draft) => !gone.has(draft.id)) ?? []
  const reviewed = data
    ? done.reduce((tally, entry) => ({ ...tally, [entry.status]: tally[entry.status] + 1 }), {
        ...data.reviewed,
      })
    : null
  const last = done.at(-1)

  const review = async (draft: DraftCaseView, request: ReviewRequest): Promise<boolean> => {
    const result = await sendReview(request)
    if (!result.ok) return false
    setDone((list) => [
      ...list,
      {
        id: draft.id,
        status: result.data.status,
        prompt: draft.card.prompt,
        returned: result.data.returned,
      },
    ])
    return true
  }

  return (
    <Fragment key={data ? 'loaded' : 'loading'}>
      <div className={styles.intro}>
        <Text as="h2" variant="title">
          Flagged cards
        </Text>
        <Text as="p" variant="body" tone="text-2">
          Cards the learner said looked wrong, once Opus re-graded them: each is a draft test case
          for the card grader. Approve, fix or reject it. Every outcome puts the card back in their
          deck, once no other note of theirs on it is waiting.
        </Text>
        <Text as="p" variant="caption" tone="text-muted">
          {reviewed ? reviewedLine(reviewed) : <Placeholder variant="caption" width="third" />}
        </Text>
      </div>
      <p role="status" className={styles.srOnly}>
        {state.status === 'loading'
          ? 'Loading flagged cards'
          : last
            ? `${DONE_WORD[last.status]}: ${last.prompt} ${
                last.returned
                  ? 'The card is back in their deck.'
                  : 'The card stays pulled: another note of theirs on it is waiting.'
              }`
            : ''}
      </p>
      {data === null ? (
        <Card>
          <div className={panels.list}>
            <Placeholder variant="body" />
            <Placeholder variant="body" />
          </div>
        </Card>
      ) : drafts.length === 0 ? (
        <Card>
          <Text as="p" variant="body" tone="text-muted">
            No flagged cards to review.
          </Text>
        </Card>
      ) : (
        <div className={styles.list}>
          {drafts.map((draft) => (
            <DraftCard
              key={draft.id}
              draft={draft}
              onReview={(request) => review(draft, request)}
            />
          ))}
        </div>
      )}
    </Fragment>
  )
}
