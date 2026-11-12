// Direct: a timeline's frame at any time of its song, and its export. Each key's scene plays at the playhead's time,
// its glides started as its edge starts (a key of the same look as the one before carries that one's on), stepped on
// a fixed grid so a frame is the same however it is reached: played, scrubbed or exported. An edge morphs the key
// before into its key, landing on it at its at; keys passed through back to back bend on a Catmull-Rom curve, as
// Play's transitions do. A curve sets its knob over its own span, under the knob's modulators.
import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat,
  type AudioCodec,
  type VideoCodec,
} from 'mediabunny'
import { snapLoop } from './loop'
import { morph, smooth } from './morph'
import { advance, copyLive, newLive, update, type Live } from './motion'
import { bend, bendOf, entryScene, tangent, valuesOf, type Bend } from './play'
import { createRenderer, type Toward } from './render'
import { clamp, hardRange, resolve, type Scene, type Timeline } from './scene'
import { needs, type Part } from './shader'

// the clock's grid, in seconds, and how many steps of it lie between the checkpoints a scrub starts from. A step
// is exact where its targets hold still (glides follow exponentially, phases and running rates are linear), and a
// frame between grid steps runs on from the one before it, meeting the next one, so the grid never shows.
export const STEP = 0.1
const MARK = 50

// what the picture draws at a time: the scene, its running phases, in an edge the far end the morph runs to, and the
// parts it draws with
export type Shot = {
  scene: Scene
  phases: Pick<Live, 'drift' | 'colour' | 'crawl'>
  toward?: Toward
  parts: Set<Part>
}

// The keys that name no look or preset among the looks.
export const missingKeys = (timeline: Timeline, looks: Scene[]) =>
  timeline.keys.filter((k) => !entryScene(looks, k.scene)).map((k) => k.scene)

// The timeline without its keys that name nothing among the looks, and what they named; none at all when no key is
// left.
export function pruneTimeline(timeline: Timeline, looks: Scene[]): { timeline: Timeline | null; gone: string[] } {
  const gone = missingKeys(timeline, looks)
  const keys = timeline.keys.filter((k) => !gone.includes(k.scene))
  return { timeline: keys.length ? { ...timeline, keys } : null, gone }
}

// The scene with every curve whose span holds t setting its knob there, inside the knob's hard range.
export function curved(scene: Scene, curves: Timeline['curves'], t: number): Scene {
  const on = curves.filter(
    ({ knob, points }) => points[0][0] <= t && t <= points[points.length - 1][0] && resolve(scene, knob),
  )
  if (!on.length) return scene
  return update(scene, (d) => {
    for (const { knob, points } of on) {
      const j = Math.max(
        1,
        points.findIndex(([at]) => at >= t),
      )
      const [[t0, v0], [t1, v1]] = [points[j - 1], points[j]]
      resolve(d, knob)!.value = clamp(v0 + ((v1 - v0) * (t - t0)) / (t1 - t0), hardRange(knob))
    }
  })
}

// A scene's clock from origin (song seconds): the scene to draw at t, at the playhead's time in beats, and its live
// state, stepped from the last grid step it reached, or back from the checkpoint at or before t's.
export type Clock = (t: number) => { scene: Scene; live: Live }
function clock(scene: Scene, origin: number, curves: Timeline['curves'], bpm: number): Clock {
  const marks = [newLive()]
  let head = { n: 0, live: newLive() }
  return (t: number) => {
    const e = Math.max(0, t - origin)
    const n = Math.floor(e / STEP + 1e-9)
    const m = Math.min(Math.floor(n / MARK), marks.length - 1)
    if (n < head.n || m * MARK > head.n) head = { n: m * MARK, live: copyLive(marks[m]) }
    while (head.n < n) {
      head.n++
      const at = origin + head.n * STEP
      advance(curved(scene, curves, at), head.live, (at * bpm) / 60, STEP)
      if (head.n % MARK === 0 && marks.length === head.n / MARK) marks.push(copyLive(head.live))
    }
    const live = copyLive(head.live)
    return { scene: advance(curved(scene, curves, t), live, (t * bpm) / 60, e - n * STEP), live }
  }
}

// The timeline's frame at any time t of its song, over the looks its keys name, and sets: the parts its frames draw
// with, each key's alone and before it its edge's, both ends' and the morph's. clocks: an earlier build's, by what
// each plays, so an edit that leaves a key's scene, start, tempo and curves as they were keeps its clock's steps;
// it is left holding this build's.
export function director(
  timeline: Timeline,
  looks: Scene[],
  clocks = new Map<string, Clock>(),
): ((t: number) => Shot) & { sets: Set<Part>[] } {
  const { keys, curves, bpm } = timeline
  const scenes = keys.map((k) => {
    const scene = entryScene(looks, k.scene)
    if (!scene) throw new Error(`${k.scene}: no look of that name`)
    return snapLoop(scene, bpm)
  })
  // where each key's edge starts: its seconds before it, but not before the key before
  const starts = keys.map((k, j) => (j ? Math.max(keys[j - 1].at, k.at - k.edge.seconds) : 0))
  const origins: number[] = []
  scenes.forEach((s, j) => origins.push(j && s.name === scenes[j - 1].name ? origins[j - 1] : starts[j]))
  const plays = JSON.stringify(curves)
  const ids = scenes.map((s, j) => `${origins[j]}|${bpm}|${JSON.stringify(s)}|${plays}`)
  const own = ids.map((id, j) => clocks.get(id) ?? clock(scenes[j], origins[j], curves, bpm))
  clocks.clear()
  ids.forEach((id, j) => clocks.set(id, own[j]))
  // key j is passed through when an edge lands on it and the next one sets off from it; the tangent there, for an
  // edge d seconds long at either side of it, is Catmull-Rom's over the two edges' lengths
  const length = (j: number) => keys[j].at - starts[j]
  const through = (j: number) => j > 0 && j + 1 < keys.length && starts[j] < keys[j].at && starts[j + 1] === keys[j].at
  const values = scenes.map(valuesOf)
  const none = new Map<string, number>()
  const tangentAt = (j: number, d: number) => {
    if (!through(j)) return none
    const f = (2 * d) / (length(j) + length(j + 1))
    return new Map([...tangent(values[j - 1], values[j + 1])].map(([k, v]) => [k, v * f]))
  }
  const bends: Bend[] = scenes.map((s, j) =>
    j
      ? bendOf(scenes[j - 1], s, tangentAt(j - 1, length(j)), tangentAt(j, length(j)))
      : { from: none, to: none, range: new Map() },
  )
  const alone = scenes.map((s) => needs(s))
  const edges = scenes.map((s, j) => (j ? needs(scenes[j - 1], s) : undefined))
  const shot = (t: number): Shot => {
    const i = Math.max(
      0,
      keys.findLastIndex((k) => k.at <= t),
    )
    const j = i + 1
    const a = own[i](t)
    if (j >= keys.length || t < starts[j]) return { scene: a.scene, phases: a.live, parts: alone[i] }
    const run = (t - starts[j]) / (keys[j].at - starts[j])
    const x = smooth(0, 1, run)
    if (x <= 0) return { scene: a.scene, phases: a.live, parts: alone[i] }
    const b = own[j](t)
    const { scene, toward } = morph(a.scene, b.scene, x, keys[j].edge, b.live)
    bend(scene, bends[j], run)
    return { scene, phases: a.live, toward, parts: edges[j]! }
  }
  return Object.assign(shot, { sets: alone.flatMap((parts, j) => [...(edges[j] ? [edges[j]] : []), parts]) })
}

// A song file decoded whole at 48 kHz, the rate the export's audio codecs all take.
export const decodeSong = (bytes: ArrayBuffer) => new OfflineAudioContext(1, 1, 48000).decodeAudioData(bytes)

// The containers an export can be, each with the codecs it may hold, the first the browser can encode taken.
export const FORMATS = {
  mp4: { video: ['avc', 'hevc', 'av1', 'vp9'], audio: ['aac', 'opus'] },
  webm: { video: ['vp9', 'av1', 'vp8'], audio: ['opus'] },
} satisfies Record<string, { video: VideoCodec[]; audio: AudioCodec[] }>
export type Format = keyof typeof FORMATS

export type ExportJob = {
  timeline: Timeline
  looks: Scene[]
  song: AudioBuffer
  from: number // the span of the song, in seconds
  to: number
  width: number
  height: number
  fps: number
  format: Format
  onFrame?: (done: number, total: number) => void
  signal?: AbortSignal
}

// The timeline's span rendered frame by frame at the size and rate asked, encoded with WebCodecs, the song's span
// muxed in: the file, and what it holds.
export async function exportVideo(job: ExportJob): Promise<{ file: Blob; video: VideoCodec; audio: AudioCodec }> {
  const { song, from, to, width, height, fps, format } = job
  const channels = song.numberOfChannels
  const [video, audio] = await Promise.all([
    getFirstEncodableVideoCodec(FORMATS[format].video, { width, height, frameRate: fps, quality: QUALITY_HIGH }),
    getFirstEncodableAudioCodec(FORMATS[format].audio, { numberOfChannels: channels, sampleRate: song.sampleRate }),
  ])
  if (!video) throw new Error(`this browser encodes none of ${FORMATS[format].video.join(', ')} at ${width}×${height}`)
  if (!audio) throw new Error(`this browser encodes none of ${FORMATS[format].audio.join(', ')}`)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const renderer = createRenderer(canvas)
  const output = new Output({
    format: format === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  })
  const frames = new CanvasSource(canvas, { codec: video, quality: QUALITY_HIGH })
  const sound = new AudioBufferSource({ codec: audio, quality: QUALITY_HIGH })
  output.addVideoTrack(frames, { frameRate: fps })
  output.addAudioTrack(sound)
  try {
    await output.start()
    const [s0, s1] = [Math.round(from * song.sampleRate), Math.round(to * song.sampleRate)]
    const span = new AudioBuffer({ length: s1 - s0, numberOfChannels: channels, sampleRate: song.sampleRate })
    for (let c = 0; c < channels; c++) span.copyToChannel(song.getChannelData(c).subarray(s0, s1), c)
    await sound.add(span)
    const shot = director(job.timeline, job.looks)
    // every program its frames draw on compiled and warmed before the first, so none draws on the fallback
    renderer.warm(shot.sets)
    while (renderer.step()) await new Promise((go) => setTimeout(go))
    const total = Math.round((to - from) * fps)
    for (let n = 0; n < total; n++) {
      job.signal?.throwIfAborted()
      const { scene, phases, toward, parts } = shot(from + n / fps)
      renderer.draw(scene, phases, toward, undefined, parts)
      await frames.add(n / fps, 1 / fps)
      job.onFrame?.(n + 1, total)
    }
    await output.finalize()
  } catch (err) {
    if (output.state !== 'finalized') await output.cancel()
    throw err
  } finally {
    renderer.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
  return { file: new Blob([output.target.buffer!], { type: output.format.mimeType }), video, audio }
}
