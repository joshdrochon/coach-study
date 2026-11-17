export const ANSWER_ENTRIES = ['voice', 'typed', 'choice'] as const
export type AnswerEntry = (typeof ANSWER_ENTRIES)[number]
