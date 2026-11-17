import type { CardView } from '@/lib/study/client'

import { CitationText } from '../CitationText'
import { IconButton } from '../IconButton'
import { CloseIcon } from '../icons'
import { Screen } from '../Screen'
import { Text } from '../Text'

import styles from './screens.module.css'

export function SourceScreen({
  card,
  onClose,
}: {
  card: Pick<CardView, 'citation'>
  onClose: () => void
}) {
  return (
    <Screen
      layout="sheet"
      headerEnd={
        <IconButton label="Close the source" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      }
    >
      <Text as="h1" variant="headline-l">
        {card.citation.label}
      </Text>
      <Text as="blockquote" variant="subtitle" tone="text-2" className={styles.quote}>
        <CitationText text={card.citation.quote} />
      </Text>
    </Screen>
  )
}
