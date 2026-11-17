import { STUDY_SOUND_IDS, soundLengthMs, soundPath, type SoundId } from './catalog'
import { soundsOn } from './settings'

export type SoundBankDeps = {
  fetch: (url: string) => Promise<Response>
  objectUrl: { create: (blob: Blob) => string }
  path: (id: SoundId) => string | null
  lengthMs: (id: SoundId) => number

  on: () => boolean
}

export class SoundBank {
  private loading: Map<SoundId, Promise<string | null>> | null = null

  constructor(private readonly deps: SoundBankDeps) {}

  preload(ids: readonly SoundId[] = STUDY_SOUND_IDS): void {
    const loading = this.loading ?? new Map<SoundId, Promise<string | null>>()
    this.loading = loading
    for (const id of ids) if (!loading.has(id)) loading.set(id, this.load(id))
  }

  on(): boolean {
    return this.deps.on()
  }

  url(id: SoundId): Promise<string | null> {
    if (!this.deps.on()) return Promise.resolve(null)
    if (!this.loading) this.preload()
    const loading = this.loading ?? new Map<SoundId, Promise<string | null>>()
    this.loading = loading
    let url = loading.get(id)
    if (!url) {
      url = this.load(id)
      loading.set(id, url)
    }
    return url
  }

  lengthMs(id: SoundId): number {
    return this.deps.lengthMs(id)
  }

  private async load(id: SoundId): Promise<string | null> {
    const path = this.deps.path(id)
    if (path === null) return null
    let response: Response
    try {
      response = await this.deps.fetch(path)
    } catch {
      this.loading?.delete(id)
      return null
    }
    try {
      if (!response.ok) return null
      if (!(response.headers.get('Content-Type') ?? '').startsWith('audio/')) return null
      return this.deps.objectUrl.create(await response.blob())
    } catch {
      return null
    }
  }
}

let bank: SoundBank | undefined

export function appSounds(): SoundBank {
  bank ??= new SoundBank({
    fetch: (url) => window.fetch(url),
    objectUrl: { create: (blob) => URL.createObjectURL(blob) },
    path: (id) => soundPath(id),
    lengthMs: (id) => soundLengthMs(id),
    on: () => soundsOn(),
  })
  return bank
}
