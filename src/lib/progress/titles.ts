export const TITLES = ['Starter', 'Practitioner', 'Mentor'] as const
export type CoachTitle = (typeof TITLES)[number]

export function isCoachTitle(value: string): value is CoachTitle {
  return TITLES.some((title) => title === value)
}

export function isPromotion(from: CoachTitle, to: CoachTitle): boolean {
  return TITLES.indexOf(to) > TITLES.indexOf(from)
}
