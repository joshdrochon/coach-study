// MP3 encode, decode and loudness through ffmpeg, for the sound maker (synth.ts).

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const RATE = 44_100

function ffmpeg(args: string[], input?: Uint8Array): { ok: boolean; out: Buffer; err: string } {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], {
    input,
    maxBuffer: 64 * 1024 * 1024,
  })
  return { ok: result.status === 0, out: result.stdout, err: result.stderr.toString() }
}

export function decodeMp3(mp3: Uint8Array): Float32Array {
  const done = ffmpeg(
    ['-i', 'pipe:0', '-f', 'f32le', '-ac', '1', '-ar', String(RATE), 'pipe:1'],
    mp3,
  )
  if (!done.ok) throw new Error(`ffmpeg could not decode: ${done.err.split('\n')[0] ?? ''}`)
  const copy = new Uint8Array(done.out)
  return new Float32Array(copy.buffer, copy.byteOffset, Math.floor(copy.byteLength / 4))
}

export function encodeMp3(samples: Float32Array): Uint8Array {
  const input = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
  const dir = mkdtempSync(path.join(tmpdir(), 'coach-study-sound-'))
  const file = path.join(dir, 'sound.mp3')
  try {
    const done = ffmpeg(
      [
        '-y',
        '-f',
        'f32le',
        '-ar',
        String(RATE),
        '-ac',
        '1',
        '-i',
        'pipe:0',
        '-ac',
        '1',
        '-ar',
        String(RATE),
        '-c:a',
        'libmp3lame',
        '-b:a',
        '128k',
        '-map_metadata',
        '-1',
        '-fflags',
        '+bitexact',
        '-flags:a',
        '+bitexact',
        file,
      ],
      input,
    )
    if (!done.ok) throw new Error(`ffmpeg could not encode: ${done.err.split('\n')[0] ?? ''}`)
    return new Uint8Array(readFileSync(file))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export function loudness(mp3: Uint8Array): { lufs: number | null; truePeakDb: number | null } {
  const done = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-nostats', '-i', 'pipe:0', '-af', 'ebur128=peak=true', '-f', 'null', '-'],
    { input: mp3 },
  )
  const text = done.stderr.toString()
  const summary = text.slice(text.lastIndexOf('Summary:'))
  const lufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1])
  const peak = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1])
  return {
    lufs: Number.isFinite(lufs) && lufs > -70 ? lufs : null,
    truePeakDb: Number.isFinite(peak) ? peak : null,
  }
}
