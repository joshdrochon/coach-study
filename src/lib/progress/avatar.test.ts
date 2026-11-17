import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  AVATAR_MAX_BASE64,
  AVATAR_SIDE,
  AvatarError,
  firstThatFits,
  outputSide,
  squareCrop,
  toAvatarJpeg,
} from './avatar'

function fakeBrowser({
  width = 4000,
  height = 3000,
  decodes = true,
  hasContext = true,
  jpegLength = 2000,
} = {}) {
  const drawImage = vi.fn()
  const close = vi.fn()
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => (hasContext ? { drawImage } : null),
    toDataURL: (type: string) => `data:${type};base64,${'A'.repeat(jpegLength)}`,
  }
  vi.stubGlobal('createImageBitmap', () =>
    decodes ? Promise.resolve({ width, height, close }) : Promise.reject(new Error('bad image')),
  )
  vi.stubGlobal('document', { createElement: () => canvas })
  return { drawImage, close, canvas }
}

describe('toAvatarJpeg', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('crops the photo square, scales it to 480 and encodes JPEG', async () => {
    const { drawImage, close, canvas } = fakeBrowser()
    const jpeg = await toAvatarJpeg(new Blob(['x']))
    expect(jpeg).toHaveLength(2000)
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 500, 0, 3000, 3000, 0, 0, 480, 480)
    expect([canvas.width, canvas.height]).toEqual([480, 480])
    expect(close).toHaveBeenCalled()
  })

  it('reports a file that is not a photo it can read', async () => {
    fakeBrowser({ decodes: false })
    const failed = toAvatarJpeg(new Blob(['x']))
    await expect(failed).rejects.toBeInstanceOf(AvatarError)
    await expect(failed).rejects.toMatchObject({ reason: 'unreadable' })
  })

  it('reports a browser without a 2D canvas', async () => {
    fakeBrowser({ hasContext: false })
    await expect(toAvatarJpeg(new Blob(['x']))).rejects.toMatchObject({ reason: 'unreadable' })
  })

  it('reports a photo that stays over 300 KB at every quality', async () => {
    fakeBrowser({ jpegLength: AVATAR_MAX_BASE64 + 1 })
    await expect(toAvatarJpeg(new Blob(['x']))).rejects.toMatchObject({ reason: 'too-large' })
  })
})

describe('squareCrop', () => {
  it('takes the middle of a landscape photo', () => {
    expect(squareCrop(4000, 3000)).toEqual({ sx: 500, sy: 0, side: 3000 })
  })

  it('takes a portrait photo from a third of the way down, where the face is', () => {
    expect(squareCrop(3000, 4200)).toEqual({ sx: 0, sy: 400, side: 3000 })
  })

  it('keeps a square photo whole', () => {
    expect(squareCrop(480, 480)).toEqual({ sx: 0, sy: 0, side: 480 })
  })
})

describe('outputSide', () => {
  it('scales big photos down to 480 and never scales small ones up', () => {
    expect(outputSide(squareCrop(4000, 3000))).toBe(AVATAR_SIDE)
    expect(outputSide(squareCrop(200, 300))).toBe(200)
  })
})

describe('firstThatFits', () => {
  it('keeps the best quality that fits under 300 KB', () => {
    const tried: number[] = []
    const result = firstThatFits((quality) => {
      tried.push(quality)
      const size = quality > 0.6 ? AVATAR_MAX_BASE64 + 10 : 1000
      return `data:image/jpeg;base64,${'A'.repeat(size)}`
    })
    expect(tried).toEqual([0.85, 0.7, 0.55])
    expect(result).toHaveLength(1000)
  })

  it('gives up when nothing fits', () => {
    expect(
      firstThatFits(() => `data:image/jpeg;base64,${'A'.repeat(AVATAR_MAX_BASE64 + 1)}`),
    ).toBeNull()
  })

  it('refuses a browser that falls back to PNG', () => {
    expect(firstThatFits(() => 'data:image/png;base64,AAAA')).toBeNull()
  })
})
