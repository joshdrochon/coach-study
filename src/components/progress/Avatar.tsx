import styles from './Avatar.module.css'

export type AvatarSize = 'size-control' | 'size-hero' | 'size-orb'

export function Avatar({ src, size }: { src: string | null; size: AvatarSize }) {
  const className = `${styles.avatar ?? ''} ${styles[size] ?? ''}`
  if (src === null) return <span className={className} aria-hidden="true" />
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="Coach Alex" className={className} data-component="avatar" />
  )
}
