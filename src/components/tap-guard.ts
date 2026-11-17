export const LANDING_TAP_GUARD_MS = 600

export function tapCounts(sinceLastTapMs: number | null, guardMs = LANDING_TAP_GUARD_MS): boolean {
  return sinceLastTapMs === null || sinceLastTapMs >= guardMs
}

export class LandingGuard {
  private at: number | null = null

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly guardMs = LANDING_TAP_GUARD_MS,
  ) {}

  arm(): void {
    this.at = this.now()
  }

  counts(): boolean {
    return tapCounts(this.at === null ? null : this.now() - this.at, this.guardMs)
  }
}
