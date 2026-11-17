import Link from 'next/link'
import type { ReactNode } from 'react'

import { Text } from '../Text'

import styles from './TextLink.module.css'

type Props = {
  children: ReactNode

  citation?: boolean

  flag?: boolean

  edge?: 'start' | 'end'
} & ({ href: string; onClick?: undefined } | { href?: undefined; onClick: () => void })

export function TextLink(props: Props) {
  const label = <Text variant="body-strong">{props.children}</Text>
  const edge = props.edge === undefined ? '' : ` ${styles[props.edge] ?? ''}`
  const marks = {
    className: `${styles.link ?? ''}${edge}`,
    'data-component': 'text-link',
    'data-citation': props.citation ? 'true' : undefined,
    'data-flag': props.flag ? 'true' : undefined,
  }
  if (props.href !== undefined) {
    return (
      <Link href={props.href} {...marks}>
        {label}
      </Link>
    )
  }
  return (
    <button type="button" onClick={props.onClick} {...marks}>
      {label}
    </button>
  )
}
