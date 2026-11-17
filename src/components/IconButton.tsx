import Link from 'next/link'
import type { ReactNode } from 'react'

import styles from './IconButton.module.css'
import { Text } from './Text'

type Props = {
  label: string
  children: ReactNode

  labelAs?: 'aria' | 'text'
} & ({ href: string; onClick?: undefined } | { href?: undefined; onClick: () => void })

export function IconButton(props: Props) {
  const named = props.labelAs === 'text'
  const content = named ? (
    <>
      {props.children}
      <Text variant="button" className={styles.label}>
        {props.label}
      </Text>
    </>
  ) : (
    props.children
  )
  if (props.href !== undefined) {
    return (
      <Link
        href={props.href}
        aria-label={props.label}
        className={styles.iconButton}
        data-component="icon-button"
      >
        {content}
      </Link>
    )
  }
  return (
    <button
      type="button"
      aria-label={props.label}
      className={styles.iconButton}
      data-component="icon-button"
      onClick={props.onClick}
    >
      {content}
    </button>
  )
}
