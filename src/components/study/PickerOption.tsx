import type { ReactNode } from 'react'

import { Text } from '../Text'

import styles from './PickerOption.module.css'

type Props = {
  onClick: () => void

  selected?: boolean

  current?: boolean

  detail?: string

  start?: boolean

  icon?: ReactNode
  children: ReactNode
}

export function PickerOption({
  onClick,
  selected,
  current = false,
  detail,
  start = false,
  icon,
  children,
}: Props) {
  const tone = selected ? 'on-accent' : undefined
  const layout =
    detail !== undefined
      ? styles.double
      : start
        ? `${styles.double} ${styles.start}`
        : styles.single
  return (
    <button
      type="button"
      className={`${styles.option} ${layout}`}
      aria-pressed={selected}
      aria-current={current ? 'true' : undefined}
      data-component="picker-option"
      onClick={onClick}
    >
      {detail === undefined ? (
        <Text variant="button" tone={tone}>
          {children}
        </Text>
      ) : (
        <Detailed icon={icon} tone={tone} detail={detail}>
          {children}
        </Detailed>
      )}
    </button>
  )
}

function Detailed({
  icon,
  tone,
  detail,
  children,
}: {
  icon: ReactNode
  tone: 'on-accent' | undefined
  detail: string
  children: ReactNode
}) {
  const words = (
    <>
      <Text variant="body-l-strong" tone={tone}>
        {children}
      </Text>
      <Text variant="body" tone={tone ?? 'text-muted'}>
        {detail}
      </Text>
    </>
  )
  if (icon === undefined) return words
  return (
    <span className={styles.withIcon} data-icon-slot={icon === null ? 'empty' : 'icon'}>
      {icon}
      <span className={styles.words}>{words}</span>
    </span>
  )
}

export function Picker({
  labelledBy,
  label,
  loose = false,
  single = false,
  three = false,
  landscapeThree = false,
  children,
}: {
  labelledBy?: string
  label?: string
  loose?: boolean
  single?: boolean
  three?: boolean
  landscapeThree?: boolean
  children: ReactNode
}) {
  const classes = [
    styles.picker,
    loose ? styles.loose : '',
    single ? styles.oneColumn : '',
    three ? styles.threeColumns : '',
    landscapeThree ? styles.landscapeThree : '',
  ]
  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      aria-label={label}
      className={classes.filter(Boolean).join(' ')}
      data-picker="true"
    >
      {children}
    </div>
  )
}
