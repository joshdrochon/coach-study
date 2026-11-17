// The short spoken line after a grade: the result word first, then the fix.

export type ResultWord = 'right' | 'partial' | 'wrong'

export const RESULT_WORDS: Record<ResultWord, string> = {
  right: 'Got it',
  partial: 'Almost',
  wrong: 'Not quite',
}

export const RESULT_ORDER: readonly ResultWord[] = ['right', 'partial', 'wrong']

export type RevealWord = 'okay' | 'shown'

export type HeadingWord = ResultWord | RevealWord

export const HEADING_WORDS: Record<HeadingWord, string> = {
  ...RESULT_WORDS,
  okay: 'That’s okay',
  shown: 'Here’s the answer',
}

export function isRevealWord(word: HeadingWord): word is RevealWord {
  return word === 'okay' || word === 'shown'
}

export function revealLine(word: RevealWord, answer: string): string {
  if (word === 'shown') return `Here’s the answer. ${answer}`
  const said = answer.trim()
  const ended = /[.!?]["'”’)\]]*$/.test(said) ? said : `${said}.`
  return `That’s okay. The answer is: ${ended} We’ll come back to this one soon.`
}

const OPENER = /^\s*(?:got it|almost there|almost|not quite)(?:\s*[.,!:;]+\s*|\s*$)/i

export function stripOpener(fix: string): string {
  return fix.replace(OPENER, '').trim()
}

export function spokenLine(result: ResultWord, fix: string): string {
  const rest = stripOpener(fix)
  return rest === '' ? `${RESULT_WORDS[result]}.` : `${RESULT_WORDS[result]}. ${rest}`
}
