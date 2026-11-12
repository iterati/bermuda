// Direct: a timeline round-trips as JSON and its parse refuses what is off its shape; the frame at a key is that
// key's scene at the playhead's time; an edge morphs into its key and a key of the same look carries its glides on;
// curves set their knob over their own span; a frame is the same however it is reached; each frame carries the parts
// it draws with, a key's alone and an edge's both ends' and the morph's. And in headless Chrome, an export
// of a few seconds of a test tone is a file of that duration holding one video and one audio track.
import { execFileSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { build, type Rollup } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { curved, director, missingKeys, pruneTimeline, STEP, type Format, type Shot } from './direct'
import { snapLoop } from './loop'
import { LOOKS } from './looks'
import { advance, newLive } from './motion'
import { entryScene } from './play'
import { parseTimeline, resolve, type Edge, type Scene, type Timeline } from './scene'
import { needs } from './shader'

declare global {
  interface Window {
    Direct: typeof import('./direct')
  }
}

const edge = (seconds: number): Edge => ({ seconds, stagger: 0.4, deepFirst: false })
const T1 = 'Tapestry 1 - Rainbow hex rings'
const T4 = 'Tapestry 4 - You spin me right round'
const T7 = 'Tapestry 7 - Hexes'
const timeline: Timeline = {
  song: 'tone.wav',
  bpm: 96,
  keys: [
    { at: 0, scene: T1, edge: edge(0) },
    { at: 4, scene: T4, edge: edge(2) },
    { at: 7, scene: T7, edge: edge(3) },
    { at: 9, scene: `${T7} / Ice`, edge: edge(1) },
  ],
  curves: [
    {
      knob: 'frame.zoom',
      points: [
        [10, 1],
        [12, 3],
      ],
    },
  ],
}

// the key's scene played alone from its start to the playhead's t, frame by frame on the clock's grid
function alone(entry: string, bpm: number, start: number, t: number) {
  const scene = snapLoop(entryScene(LOOKS, entry)!, bpm)
  const live = newLive()
  const n = Math.floor((t - start) / STEP + 1e-9)
  for (let i = 1; i <= n; i++) advance(scene, live, ((start + i * STEP) * bpm) / 60, STEP)
  return { scene: advance(scene, live, (t * bpm) / 60, t - start - n * STEP), phases: live, parts: needs(scene) }
}

describe('a timeline', () => {
  it('round-trips as JSON', () => {
    const text = JSON.stringify(timeline)
    expect(parseTimeline(text)).toEqual(timeline)
    expect(JSON.stringify(parseTimeline(JSON.parse(text)))).toBe(text)
  })

  it('refuses keys out of order, a curve twice on a knob, values off the knob and points out of order', () => {
    const off = (fn: (t: Timeline) => void) => {
      const t = structuredClone(timeline)
      fn(t)
      return () => parseTimeline(t)
    }
    expect(off((t) => (t.keys[2].at = 3))).toThrow('keys[2].at: must be at or after the key before it')
    expect(off((t) => t.curves.push(structuredClone(t.curves[0])))).toThrow('frame.zoom has a curve already')
    expect(off((t) => (t.curves[0].points[1][1] = 9))).toThrow('curves[0].points[1][1]: 9 is outside 0.1 to 8')
    expect(off((t) => (t.curves[0].points[1][0] = 10))).toThrow('must come after the point before it')
    expect(off((t) => (t.curves[0].knob = 'frame.nope'))).toThrow('frame.nope names no knob kind')
    expect(off((t) => (t.keys = []))).toThrow('keys: must hold 1 to 4096 items')
    expect(off((t) => delete (t as Partial<Timeline>).bpm)).toThrow('bpm: is missing')
  })

  it('names the keys whose scene is not among the looks, and drops them', () => {
    const t = { ...timeline, keys: [...timeline.keys, { at: 20, scene: 'Gone', edge: edge(1) }] }
    expect(missingKeys(t, LOOKS)).toEqual(['Gone'])
    expect(() => director(t, LOOKS)).toThrow('Gone: no look of that name')
    expect(pruneTimeline(t, LOOKS)).toEqual({ timeline, gone: ['Gone'] })
    expect(pruneTimeline(t, [])).toEqual({ timeline: null, gone: t.keys.map((k) => k.scene) })
  })
})

describe('the frame at a time', () => {
  const shot = director(timeline, LOOKS)

  it("at a key is that key scene at the playhead's time, its glides started as its edge started", () => {
    expect(shot(4)).toEqual(alone(T4, 96, 2, 4))
    expect(shot(0)).toEqual(alone(T1, 96, 0, 0))
    // the edge into T7 starts at 4 as T4 lands, its 3 seconds cut to the 3 since
    expect(shot(7)).toEqual(alone(T7, 96, 4, 7))
  })

  it("plays a key's modulators at the playhead's time, however late its edge started", () => {
    // T4's spin: its edge started at 2, and alone it plays from 0
    const only = director({ ...timeline, keys: [{ at: 0, scene: T4, edge: edge(0) }], curves: [] }, LOOKS)
    const turn = (s: Shot) => resolve(s.scene, 'frame.turn')!.value
    expect(turn(shot(4))).toBeCloseTo(turn(only(4)), 9)
    // not as far as the 2 seconds since its edge started
    expect(turn(shot(4))).not.toBeCloseTo(turn(only(2)), 1)
  })

  it('in an edge is the morph from the key before into its key', () => {
    expect(shot(3).scene.name).toBe(`${T1} → ${T4}`)
    expect(shot(3).toward?.at).toBeCloseTo(0.5)
    expect(shot(1.9)).toEqual(alone(T1, 96, 0, 1.9))
  })

  it("carries a look's glides on into a key of its preset", () => {
    // T7's glides started at 4, and Ice plays them on
    const ice = alone(`${T7} / Ice`, 96, 4, 9)
    expect(shot(9)).toEqual(ice)
    expect(ice.scene.palette.stops).not.toEqual(shot(7.5).scene.palette.stops)
  })

  it('is the same however it is reached', () => {
    const scrubbed = director(timeline, LOOKS)
    for (const t of [11, 1, 6.5, 2.2]) scrubbed(t)
    expect(scrubbed(5.3)).toEqual(director(timeline, LOOKS)(5.3))
    expect(scrubbed(5.3)).toEqual(shot(5.3))
  })

  it("carries each key's parts, and in an edge both ends' and the morph's", () => {
    const at = (entry: string) => needs(entryScene(LOOKS, entry)!)
    expect(shot(0).parts).toEqual(at(T1))
    expect(shot(3).parts).toEqual(needs(entryScene(LOOKS, T1)!, entryScene(LOOKS, T4)!))
    expect(shot(3).parts.has('morph')).toBe(true)
    expect(shot(4).parts).toEqual(at(T4))
    expect(shot(9.5).parts).toEqual(at(`${T7} / Ice`))
    // the sets the app warms while the timeline is loaded: each key's, its edge's before it
    const [s1, s4, s7, ice] = [T1, T4, T7, `${T7} / Ice`].map((e) => entryScene(LOOKS, e)!)
    expect(shot.sets).toEqual([
      needs(s1),
      needs(s1, s4),
      needs(s4),
      needs(s4, s7),
      needs(s7),
      needs(s7, ice),
      needs(ice),
    ])
  })

  it('takes each curve over its own span, straight between its points', () => {
    const ice = `${T7} / Ice`
    expect(resolve(shot(11).scene, 'frame.zoom')!.value).toBeCloseTo(2)
    expect(resolve(curved(entryScene(LOOKS, ice)!, timeline.curves, 11.5), 'frame.zoom')!.value).toBeCloseTo(2.5)
    expect(shot(9.5)).toEqual(alone(ice, 96, 4, 9.5))
    expect(shot(13)).toEqual(alone(ice, 96, 4, 13))
    const t4: Scene = entryScene(LOOKS, T4)!
    expect(curved(t4, [{ knob: 'levels[nope].weight', points: timeline.curves[0].points }], 11)).toBe(t4)
  })
})

// a mono 16-bit WAV of a sine tone, seconds long at rate
function tone(seconds: number, rate: number): Buffer {
  const n = Math.round(seconds * rate)
  const wav = Buffer.alloc(44 + 2 * n)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + 2 * n, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(rate, 24)
  wav.writeUInt32LE(rate * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(2 * n, 40)
  for (let i = 0; i < n; i++) wav.writeInt16LE(Math.round(12000 * Math.sin((2 * Math.PI * 440 * i) / rate)), 44 + 2 * i)
  return wav
}

describe('the export', () => {
  let browser: Browser
  let page: Page
  let server: Server

  beforeAll(async () => {
    const out = (await build({
      configFile: false,
      logLevel: 'silent',
      build: {
        write: false,
        minify: false,
        lib: { entry: fileURLToPath(new URL('./direct.ts', import.meta.url)), formats: ['iife'], name: 'Direct' },
      },
    })) as Rollup.RollupOutput[]
    const code = out[0].output[0].code
    // WebCodecs only runs in a secure context: the page comes from localhost
    server = createServer((_, res) => res.end(`<script>${code.replace(/<\/script/g, '<\\/script')}</script>`))
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const chrome = execFileSync('sh', ['-c', 'command -v chromium'], { encoding: 'utf8' }).trim()
    browser = await puppeteer.launch({
      executablePath: chrome,
      args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    })
    page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`)
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    server?.close()
  })

  // the timeline's span from..to exported over the tone, and what the file holds
  async function exported(format: Format, from: number, to: number) {
    const job = { timeline, looks: LOOKS, from, to, width: 128, height: 72, fps: 12, format }
    const { bytes, video, audio } = await page.evaluate(
      async (job, wav) => {
        const song = await window.Direct.decodeSong(Uint8Array.from(atob(wav), (c) => c.charCodeAt(0)).buffer)
        const { file, video, audio } = await window.Direct.exportVideo({ ...job, song })
        return { bytes: Array.from(new Uint8Array(await file.arrayBuffer())), video, audio }
      },
      job,
      tone(12, 44100).toString('base64'),
    )
    const input = new Input({ source: new BufferSource(new Uint8Array(bytes)), formats: ALL_FORMATS })
    const [videos, audios] = [await input.getVideoTracks(), await input.getAudioTracks()]
    return {
      video,
      audio,
      duration: await input.computeDuration(),
      tracks: (await input.getTracks()).length,
      videos: await Promise.all(videos.map(async (t) => [await t.computeDuration(), t.codec])),
      audios: await Promise.all(audios.map(async (t) => [await t.computeDuration(), t.codec])),
    }
  }

  it.each(['mp4', 'webm'] as const)(
    'of a few seconds of a test tone is a %s file of that duration, one video and one audio track',
    async (format) => {
      const got = await exported(format, 2.5, 5.5)
      expect(got.tracks).toBe(2)
      expect(got.videos).toEqual([[expect.closeTo(3, 1), got.video]])
      expect(got.audios).toEqual([[expect.closeTo(3, 1), got.audio]])
      expect(got.duration).toBeCloseTo(3, 1)
    },
    120_000,
  )
})
