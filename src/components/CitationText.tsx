import { curly } from '@/lib/text/curly'
import { citationLines, flatText } from '@/lib/text/lines'

import { Bracketed } from './study/Bracketed'
import styles from './CitationText.module.css'
import { Text } from './Text'

export function CitationText({
  text,
  after = '',
  keepBrackets = true,
}: {
  text: string
  after?: string
  keepBrackets?: boolean
}) {
  const lines = citationLines(text)
  const show = (words: string) => (keepBrackets ? <Bracketed text={words} /> : curly(words))
  if (lines.length <= 1) return <>{show(`${flatText(text)}${after}`)}</>
  return (
    <>
      {lines.map((line, index) => {
        const last = index === lines.length - 1
        const words = `${line.text}${last ? after : ''}`
        const breakAfter = last ? null : '\n'
        if (line.label) {
          return (
            <Text
              key={index}
              variant="label"
              tone="text-muted"
              className={`${styles.line} ${styles.label}`}
              data-citation-label=""
            >
              {show(words)}
              {breakAfter}
            </Text>
          )
        }
        const indent = line.indent > 0 ? styles.indent : undefined
        return (
          <span key={index} className={[styles.line, indent].filter(Boolean).join(' ')}>
            {show(words)}
            {breakAfter}
          </span>
        )
      })}
    </>
  )
}
