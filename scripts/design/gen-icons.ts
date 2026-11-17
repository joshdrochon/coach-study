// pnpm icons: renders the app icons. --check fails when a committed icon is stale.

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { deflateSync } from 'node:zlib'

import { COLOR_VALUES } from '../../src/styles/tokens'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const check = process.argv.includes('--check')

// The mark is a plain ring: a disc with a centered hole, in a unit square.
const OUTER = 0.5
const INNER = 0.28

function inRing(u: number, v: number): boolean {
  const d = Math.hypot(u - 0.5, v - 0.5)
  return d <= OUTER && d >= INNER
}

const hex = (color: string): [number, number, number] => [
  Number.parseInt(color.slice(1, 3), 16),
  Number.parseInt(color.slice(3, 5), 16),
  Number.parseInt(color.slice(5, 7), 16),
]

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(bytes: Buffer): number {
  let c = 0xffffffff
  for (const byte of bytes) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const out = Buffer.alloc(body.length + 8)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), body.length + 4)
  return out
}
function png(size: number, rgba: Buffer): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header.set([8, 6, 0, 0, 0], 8)
  const rows = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y += 1) {
    rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const SAMPLES = 4

// Supersampled so the ring's edge is smooth at every size.
function render(size: number, fill: number, ink: string, background: string | null): Buffer {
  const side = size * fill
  const offset = (size - side) / 2
  const [ir, ig, ib] = hex(ink)
  const [br, bg, bb] = hex(background ?? ink)
  const out = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let covered = 0
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const u = (x + (sx + 0.5) / SAMPLES - offset) / side
          const v = (y + (sy + 0.5) / SAMPLES - offset) / side
          if (inRing(u, v)) covered += 1
        }
      }
      const a = covered / (SAMPLES * SAMPLES)
      const at = (y * size + x) * 4
      if (background === null) {
        out.set([ir, ig, ib, Math.round(a * 255)], at)
      } else {
        out.set(
          [
            Math.round(ir * a + br * (1 - a)),
            Math.round(ig * a + bg * (1 - a)),
            Math.round(ib * a + bb * (1 - a)),
            255,
          ],
          at,
        )
      }
    }
  }
  return png(size, out)
}

function svg(): string {
  const ring = 'M500 0A500 500 0 1 1 500 1000A500 500 0 1 1 500 0Z' +
    'M500 220A280 280 0 1 0 500 780A280 280 0 1 0 500 220Z'
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">\n` +
    `<style>path{fill:${COLOR_VALUES.bg}}@media (prefers-color-scheme:dark){path{fill:${COLOR_VALUES.text}}}</style>\n` +
    `<path fill-rule="evenodd" d="${ring}"/>\n</svg>\n`
  )
}

const outputs: [file: string, content: Buffer | string][] = [
  ['src/app/icon1.png', render(32, 0.9, COLOR_VALUES.bg, null)],
  ['src/app/icon2.svg', svg()],
  ['src/app/apple-icon.png', render(180, 0.6, COLOR_VALUES.bg, COLOR_VALUES.text)],
  ['public/app-icon-192.png', render(192, 0.6, COLOR_VALUES.bg, COLOR_VALUES.text)],
  ['public/app-icon-512.png', render(512, 0.6, COLOR_VALUES.bg, COLOR_VALUES.text)],
]

let stale = 0
for (const [file, content] of outputs) {
  const target = path.join(ROOT, file)
  if (check) {
    let current: Buffer | null = null
    try {
      current = readFileSync(target)
    } catch {
      current = null
    }
    if (!current?.equals(Buffer.from(content))) {
      stale += 1
      console.error(`stale: ${file}`)
    }
  } else {
    writeFileSync(target, content)
    console.log(`wrote ${file}`)
  }
}
if (stale > 0) {
  console.error('pnpm icons rewrites them')
  process.exit(1)
}
