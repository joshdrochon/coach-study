import {
  flaggedViewSchema,
  reviewedSchema,
  type FlaggedView,
  type Reviewed,
  type ReviewRequest,
} from '../study/flag-cases-contract'

import { getJson, postJson, type ApiResult, type Fetch } from './http'

export function fetchFlagged(fetchImpl?: Fetch): Promise<ApiResult<FlaggedView>> {
  return getJson('/api/admin/flagged', flaggedViewSchema, fetchImpl)
}

export function sendReview(
  request: ReviewRequest,
  fetchImpl?: Fetch,
): Promise<ApiResult<Reviewed>> {
  return postJson('/api/admin/flagged', request, reviewedSchema, fetchImpl)
}
