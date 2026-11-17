import Link from 'next/link'
import type { MouseEvent, ReactNode } from 'react'

import styles from './Button.module.css'
import { Text } from './Text'

type Variant = 'primary' | 'secondary' | 'hero'

type Common = {
  variant: Variant
  children: ReactNode
  icon?: ReactNode
  fullWidth?: boolean
}

type AsLink = Common & { href: string; onClick?: (event: MouseEvent<HTMLAnchorElement>) => void }
type AsButton = Common & {
  href?: undefined
  onClick?: () => void
  type?: 'button' | 'submit'
  disabled?: boolean
  form?: string
}

const COMPONENT: Record<Variant, string> = {
  primary: 'primary-button',
  secondary: 'secondary-button',
  hero: 'hero-button',
}

export function Button(props: AsLink | AsButton) {
  const { variant, children, icon, fullWidth = false } = props
  const className = [styles.button, styles[variant], fullWidth ? styles.full : undefined]
    .filter(Boolean)
    .join(' ')
  const content = (
    <>
      {icon}
      <Text variant={variant === 'hero' ? 'button-l' : 'button'}>{children}</Text>
    </>
  )
  if (props.href !== undefined) {
    return (
      <Link
        href={props.href}
        className={className}
        data-component={COMPONENT[variant]}
        onClick={props.onClick}
      >
        {content}
      </Link>
    )
  }
  return (
    <button
      type={props.type ?? 'button'}
      className={className}
      data-component={COMPONENT[variant]}
      onClick={props.onClick}
      disabled={props.disabled}
      form={props.form}
    >
      {content}
    </button>
  )
}
