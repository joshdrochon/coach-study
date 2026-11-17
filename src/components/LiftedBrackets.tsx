import styles from './LiftedBrackets.module.css'

export function LiftedBrackets({ text }: { text: string }) {
  return (
    <>
      {text.split(/([[\]])/).map((part, index) =>
        part === '[' || part === ']' ? (
          <span key={index} className={styles.lift}>
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  )
}
