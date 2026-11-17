import type { LandingGuard } from '../tap-guard'

export type SoundsToggleDeps = {
  save: (on: boolean) => void

  preload: () => void
  voice: { stopCue: () => void; preview: (id: 'right') => Promise<unknown> }
  guard: LandingGuard
}

export function toggleSounds(on: boolean, deps: SoundsToggleDeps): boolean {
  if (!deps.guard.counts()) return on
  deps.guard.arm()
  const next = !on
  deps.save(next)
  if (!next) {
    deps.voice.stopCue()
    return next
  }

  deps.preload()
  void deps.voice.preview('right')
  return next
}
