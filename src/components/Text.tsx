// All text goes through this component, so type styles come only from the design tokens.

import { Children, type ComponentPropsWithoutRef, type ElementType, type ReactNode } from 'react'

import type { TypeStyle } from '@/styles/tokens'

import styles from './Text.module.css'
import typeStyles from './text-styles.module.css'

export type TextTone =
  | 'text'
  | 'text-2'
  | 'text-muted'
  | 'text-subtle'
  | 'on-accent'
  | 'accent-text'
  | 'accent-text-strong'
  | 'warn-text'
  | 'warn-text-muted'
  | 'inherit'

const HEADLINES = new Set<TypeStyle>(['headline-xl', 'headline-l', 'headline-m', 'question-xl'])

export function LastWordsTogether({ text }: { text: string }) {
  const match = /^(\s*\S[\s\S]*\s)(\S+\s+\S+)(\s*)$/.exec(text)
  if (!match) return text
  const [, head = '', last = '', tail = ''] = match
  return (
    <>
      {head}
      <span className={styles.keepWhole} data-keep-whole="true">
        {last}
      </span>
      {tail}
    </>
  )
}

function lastWordsTogether(children: ReactNode): ReactNode {
  const parts = Children.toArray(children)
  if (parts.length === 0) return children
  if (!parts.every((part) => typeof part === 'string' || typeof part === 'number')) return children
  return <LastWordsTogether text={parts.join('')} />
}

export function typeClass(variant: TypeStyle): string {
  const name = typeStyles[variant]
  if (!name) throw new Error(`Unknown type style: ${variant}`)
  return name
}

type TextProps<E extends ElementType> = {
  variant: TypeStyle
  as?: E
  tone?: TextTone

  nowrap?: boolean
  children: ReactNode
} & Omit<ComponentPropsWithoutRef<E>, 'style' | 'children'>

export function Text<E extends ElementType = 'span'>({
  variant,
  as,
  tone = 'inherit',
  nowrap = false,
  className,
  children,
  ...rest
}: TextProps<E>) {
  const Component: ElementType = as ?? 'span'
  const headline = HEADLINES.has(variant) || Component === 'h1'
  const classes = [
    typeClass(variant),
    styles[`tone-${tone}`],

    headline ? styles.balance : undefined,
    nowrap ? styles.nowrap : undefined,
    typeof className === 'string' ? className : undefined,
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <Component data-text-style={variant} className={classes} {...rest}>
      {headline && !nowrap ? lastWordsTogether(children) : children}
    </Component>
  )
}
