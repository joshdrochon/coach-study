// The latest review round decides whether a card is accepted.

export type ReviewVerdict = { id: string; verdict: 'accepted' | 'rejected'; round: number }

export function latestVerdicts<T extends ReviewVerdict>(reviews: Iterable<T>): Map<string, T> {
  const latest = new Map<string, T>()
  for (const review of reviews) {
    const prior = latest.get(review.id)
    if (!prior || review.round >= prior.round) latest.set(review.id, review)
  }
  return latest
}

export function acceptedIds(reviews: Iterable<ReviewVerdict>): Set<string> {
  return new Set(
    [...latestVerdicts(reviews).values()].flatMap((r) => (r.verdict === 'accepted' ? [r.id] : [])),
  )
}
