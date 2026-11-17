export const AVATAR_SIDE = 480

export const AVATAR_MAX_BASE64 = 300 * 1024

const QUALITIES = [0.85, 0.7, 0.55, 0.4] as const

export type Crop = { sx: number; sy: number; side: number }

export function squareCrop(width: number, height: number): Crop {
  const side = Math.min(width, height)
  return {
    sx: Math.round((width - side) / 2),
    sy: Math.round((height - side) / 3),
    side,
  }
}

export function outputSide(crop: Crop): number {
  return Math.min(AVATAR_SIDE, crop.side)
}

export function firstThatFits(encode: (quality: number) => string): string | null {
  for (const quality of QUALITIES) {
    const dataUrl = encode(quality)
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    if (dataUrl.startsWith('data:image/jpeg') && base64.length <= AVATAR_MAX_BASE64) return base64
  }
  return null
}

export class AvatarError extends Error {
  constructor(readonly reason: 'unreadable' | 'too-large') {
    super(reason)
  }
}

export async function toAvatarJpeg(file: Blob): Promise<string> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new AvatarError('unreadable')
  }
  const crop = squareCrop(bitmap.width, bitmap.height)
  const side = outputSide(crop)
  const canvas = document.createElement('canvas')
  canvas.width = side
  canvas.height = side
  const context = canvas.getContext('2d')
  if (!context || crop.side === 0) throw new AvatarError('unreadable')
  context.drawImage(bitmap, crop.sx, crop.sy, crop.side, crop.side, 0, 0, side, side)
  bitmap.close()
  const base64 = firstThatFits((quality) => canvas.toDataURL('image/jpeg', quality))
  if (base64 === null) throw new AvatarError('too-large')
  return base64
}
