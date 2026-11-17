import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { Card } from '@/components/Card'
import { Text } from '@/components/Text'
import { AdminFrame } from '@/components/admin/AdminFrame'
import { PlaySound } from '@/components/admin/PlaySound'
import { todayLabel } from '@/lib/dashboard/format'
import { soundViews } from '@/lib/dashboard/sounds'
import { SOUND_MANIFEST } from '@/lib/sound/catalog'

import styles from './page.module.css'

export const metadata: Metadata = { title: 'Admin · Sounds' }
export const dynamic = 'force-dynamic'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <Text as="p" variant="caption-strong" tone="text-muted">
        {label}
      </Text>
      <Text as="p" variant="body">
        {children}
      </Text>
    </div>
  )
}

function variantsLine(): string | null {
  const live = SOUND_MANIFEST.sounds.find((sound) => sound.made?.variant)?.made?.variant
  const others = SOUND_MANIFEST.alternates
  if (live === undefined || others.length === 0) return null
  const named = others.map((set) => `variant ${set.variant} (${set.label})`).join(' and ')
  return `Two versions of the same family. Each card’s first button plays what the app plays, variant ${live}. The next plays ${named}, only on this page, to compare. To switch, ask Claude to run pnpm sound:synth --live ${others[0]?.variant ?? ''}.`
}

export default function AdminSoundsPage() {
  const sounds = soundViews()
  const variants = variantsLine()
  return (
    <AdminFrame current="system" subPage today={todayLabel(new Date())}>
      <div className={styles.intro}>
        <Text as="h2" variant="title">
          Sounds
        </Text>
        <Text as="p" variant="body-l" tone="text-2">
          Listen to each sound before it ships. To approve one, set its approved field in
          design/sounds.json (who and the date), or ask Claude to.
        </Text>
        {variants ? (
          <Text as="p" variant="body-l" tone="text-2">
            {variants}
          </Text>
        ) : null}
        <Text as="p" variant="body" tone="text-muted">
          {SOUND_MANIFEST.voice.note}
        </Text>
      </div>
      <ul className={styles.sounds}>
        {sounds.map((sound) => (
          <li key={sound.id}>
            <Card label={`Sound ${sound.id}`}>
              <div className={styles.head}>
                <Text as="h3" variant="body-l-strong">
                  {sound.id}
                </Text>
                <Text as="p" variant="body" tone="text-2">
                  {sound.moment}
                </Text>
              </div>
              <PlaySound id={sound.id} src={sound.src} />
              <div className={styles.fields}>
                <Field label={sound.sourceLabel}>{sound.source}</Field>
                <Field label="Target">{sound.target}</Field>
                <Field label="Measured">{sound.measured ?? 'Not measured yet'}</Field>
                <Field label="Made">{sound.making ?? 'Not made yet'}</Field>
                <Field label="In the app">{sound.plays}</Field>
                <Field label="Approval">{sound.approval}</Field>
              </div>
              {sound.alternates.map((alt) => (
                <div key={alt.variant} className={styles.alternate}>
                  <Text as="p" variant="caption-strong" tone="text-muted">
                    {`Variant ${alt.variant}, ${alt.label}: only on this page`}
                  </Text>
                  <PlaySound
                    id={sound.id}
                    src={alt.src}
                    label={`Play ${sound.id}, variant ${alt.variant}`}
                  />
                  <div className={styles.fields}>
                    <Field label="Made from">{alt.source}</Field>
                    <Field label="Measured">{alt.measured}</Field>
                  </div>
                </div>
              ))}
            </Card>
          </li>
        ))}
      </ul>
    </AdminFrame>
  )
}
