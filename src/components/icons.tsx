import styles from './icons.module.css'

type Size = 's' | 'm' | 'l' | 'xl'
type IconProps = { size?: Size }

const CLASS: Record<Size, string | undefined> = {
  s: styles.s,
  m: styles.m,
  l: styles.l,
  xl: styles.xl,
}

function Svg({ size = 'm', children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={CLASS[size]}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={size === 's' || size === 'm' ? 2.2 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export function MicIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </Svg>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  )
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Svg>
  )
}

export function SpeakerOffIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 9h4l5-4v14l-5-4H4z" />
      <path d="M17 9l4 6M21 9l-4 6" />
    </Svg>
  )
}

export function SpeakerIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 9h4l5-4v14l-5-4H4z" />
      <path d="M17 9a4 4 0 0 1 0 6" />
    </Svg>
  )
}
