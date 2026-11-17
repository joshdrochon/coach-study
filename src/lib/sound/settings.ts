export const SOUNDS_KEY = 'coach-study:sounds'

type Store = Pick<Storage, 'getItem' | 'setItem'>

function browserStore(): Store {
  return window.localStorage
}

let pageChoice: boolean | null = null

export function soundsOn(store: () => Store = browserStore): boolean {
  try {
    const stored = store().getItem(SOUNDS_KEY)
    if (stored !== null) return stored !== 'off'
  } catch {}
  return pageChoice ?? true
}

export function setSoundsOn(on: boolean, store: () => Store = browserStore): boolean {
  pageChoice = on
  try {
    store().setItem(SOUNDS_KEY, on ? 'on' : 'off')
    return true
  } catch {
    return false
  }
}
