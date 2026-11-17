'use client'

import { useRouter } from 'next/navigation'
import { useState, useSyncExternalStore } from 'react'

import { Button } from '../Button'
import { IconButton } from '../IconButton'
import { CloseIcon } from '../icons'
import { RailScreen } from '../progress/RailScreen'
import { Text } from '../Text'

import styles from './Choose.module.css'

import type { CategoryChoice } from './categories'
import { categoryIcon } from './category-icons'
import { bestFor } from './copy'
import { Picker, PickerOption } from './PickerOption'
import { primeSpeech } from './speech'

type Plan =
  { kind: 'everything' } | { kind: 'focus'; categories: string[] } | { kind: 'mic-practice' }

const RECOMMENDED: Plan = { kind: 'everything' }

const noSubscription = () => () => undefined
const best = () => bestFor(new Date())
const recommended = () => 'Recommended'

export function startPath(plan: Plan): string {
  if (plan.kind === 'mic-practice') return '/practice'
  if (plan.kind === 'everything') return '/study?mode=together'
  const params = new URLSearchParams({ mode: 'focus', categories: plan.categories.join(',') })
  return `/study?${params.toString()}`
}

export function Choose({ categories }: { categories: CategoryChoice[] }) {
  const router = useRouter()
  const [plan, setPlan] = useState<Plan | null>(null)
  const everythingDetail = useSyncExternalStore(noSubscription, best, recommended)

  const toggle = (name: string) => {
    setPlan((current) => {
      const chosen = current?.kind === 'focus' ? current.categories : []
      const next = chosen.includes(name)
        ? chosen.filter((category) => category !== name)
        : [...chosen, name]

      return next.length === 0 ? null : { kind: 'focus', categories: next }
    })
  }

  const start = () => {
    primeSpeech()
    router.push(startPath(plan ?? RECOMMENDED))
  }

  return (
    <RailScreen current="practice" layout="sheet">
      <header className={styles.header}>
        <Button variant="secondary" href="/voice-test" icon={categoryIcon('Voice test')}>
          Voice test
        </Button>
        <IconButton label="Back to Home" href="/">
          <CloseIcon />
        </IconButton>
      </header>
      <main className={styles.sheet}>
        <Text as="h1" variant="headline-l" id="choose-title">
          What do you want to work on?
        </Text>
        <Picker labelledBy="choose-title" loose landscapeThree>
          <PickerOption
            selected={plan?.kind === 'everything'}
            detail={everythingDetail}
            icon={categoryIcon('Everything')}
            onClick={() => {
              setPlan({ kind: 'everything' })
            }}
          >
            Everything
          </PickerOption>
          <PickerOption
            selected={plan?.kind === 'mic-practice'}
            detail="Coach a sequence out loud"
            icon={categoryIcon('Mic practice')}
            onClick={() => {
              setPlan({ kind: 'mic-practice' })
            }}
          >
            Mic practice
          </PickerOption>
          {categories.map((category) => (
            <PickerOption
              key={category.name}
              selected={plan?.kind === 'focus' && plan.categories.includes(category.name)}
              detail={category.detail}
              icon={categoryIcon(category.name)}
              onClick={() => {
                toggle(category.name)
              }}
            >
              {category.name}
            </PickerOption>
          ))}
        </Picker>
        <Button variant="primary" onClick={start} fullWidth>
          Start
        </Button>
      </main>
    </RailScreen>
  )
}
