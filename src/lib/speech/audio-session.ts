export type AudioSessionPort = {
  forMic: () => void

  afterMic: () => void
}

type AudioSessionType =
  'auto' | 'playback' | 'transient' | 'transient-solo' | 'ambient' | 'play-and-record'

type AudioSessionLike = { type: AudioSessionType }

export const NO_AUDIO_SESSION: AudioSessionPort = {
  forMic: () => undefined,
  afterMic: () => undefined,
}

export function audioSessionPort(session: () => AudioSessionLike | undefined): AudioSessionPort {
  let armed = false
  const set = (type: AudioSessionType) => {
    try {
      const target = session()
      if (target && target.type !== type) target.type = type
    } catch {}
  }
  return {
    forMic: () => {
      armed = true
      set('auto')
    },
    afterMic: () => {
      if (!armed) return
      armed = false
      set('playback')
    },
  }
}

export function browserAudioSession(): AudioSessionPort {
  return audioSessionPort(() => {
    const nav: unknown = typeof navigator === 'undefined' ? undefined : navigator
    if (typeof nav !== 'object' || nav === null || !('audioSession' in nav)) return undefined
    const session = nav.audioSession
    return isAudioSession(session) ? session : undefined
  })
}

function isAudioSession(value: unknown): value is AudioSessionLike {
  return typeof value === 'object' && value !== null && 'type' in value
}
