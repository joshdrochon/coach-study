
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { inflateSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import manifest from '../../src/app/manifest'

const ROOT = path.resolve(import.meta.dirname, '..', '..')

function readPng(file: string): { size: number; pixel: (x: number, y: number) => number[] } {
  const bytes = readFileSync(path.join(ROOT, file))
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG')
  const size = bytes.readUInt32BE(16)
  expect(bytes.readUInt32BE(20)).toBe(size)
  let at = 8
  const parts: Buffer[] = []
  while (at < bytes.length) {
    const length = bytes.readUInt32BE(at)
    if (bytes.subarray(at + 4, at + 8).toString('ascii') === 'IDAT') {
      parts.push(bytes.subarray(at + 8, at + 8 + length))
    }
    at += length + 12
  }
  const rows = inflateSync(Buffer.concat(parts))
  return {
    size,
    pixel: (x, y) => [...rows.subarray(y * (size * 4 + 1) + 1 + x * 4).subarray(0, 4)],
  }
}

function colors(file: string): Set<string> {
  const { size, pixel } = readPng(file)
  const seen = new Set<string>()
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) seen.add(pixel(x, y).slice(0, 3).join(','))
  }
  return seen
}

describe('app icons', () => {
  it('the Home Screen and manifest icons are an opaque dark ring on light, in grays only', () => {
    for (const [file, size] of [
      ['src/app/apple-icon.png', 180],
      ['public/app-icon-192.png', 192],
      ['public/app-icon-512.png', 512],
    ] as const) {
      const icon = readPng(file)
      expect(icon.size).toBe(size)
      expect(icon.pixel(0, 0)).toEqual([255, 255, 255, 255])
      expect(icon.pixel(size - 1, size - 1)).toEqual([255, 255, 255, 255])
      // The hole in the middle shows the background; the band around it is ink.
      expect(icon.pixel(Math.round(size / 2), Math.round(size / 2))).toEqual([255, 255, 255, 255])
      expect(icon.pixel(Math.round(size / 2), Math.round(size * (0.5 - 0.6 * 0.39)))).toEqual([
        0, 0, 0, 255,
      ])
      for (const rgb of colors(file)) {
        const [r, g, b] = rgb.split(',').map(Number)
        expect(r === g && g === b).toBe(true)
      }
    }
  })

  it('the tab icon PNG has no background and a clear center', () => {
    const icon = readPng('src/app/icon1.png')
    expect(icon.size).toBe(32)
    expect(icon.pixel(0, 0)[3]).toBe(0)
    expect(icon.pixel(31, 31)[3]).toBe(0)
    expect(icon.pixel(16, 16)[3]).toBe(0)
    expect(icon.pixel(16, 4)[3]).toBe(255)
  })

  it('the tab icon SVG is one ring path that flips with dark mode, with no background shape', () => {
    const svg = readFileSync(path.join(ROOT, 'src/app/icon2.svg'), 'utf8')
    expect(svg.match(/<path /g)).toHaveLength(1)
    expect(svg).toContain('fill-rule="evenodd"')
    expect(svg).not.toMatch(/<rect|<circle|<image/)
    expect(svg).toContain('path{fill:#000000}')
    expect(svg).toContain('@media (prefers-color-scheme:dark){path{fill:#FFFFFF}}')
  })

  it('the manifest lists the new icons, all of which exist', () => {
    const icons = manifest().icons ?? []
    expect(icons.map((icon) => icon.src)).toEqual([
      '/app-icon-192.png',
      '/app-icon-512.png',
      '/apple-icon.png',
    ])
    for (const icon of icons) {
      const file = icon.src === '/apple-icon.png' ? 'src/app/apple-icon.png' : `public${icon.src}`
      expect(readPng(file).size).toBe(Number.parseInt(icon.sizes ?? '', 10))
    }
  })

})
