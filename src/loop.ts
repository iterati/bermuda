// Loops: a scene with a loop plays with every modulator period snapped to the loop's length over a whole k, the ks
// of different periods kept coprime, its ramps on knobs that come round made whole periods, and its running ring
// phase, palette index and dots' crawl made whole over the loop, so its last frame runs into its first.
import { hardRange, kindOf, PERIOD, type Scene } from './scene'

export const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)

// The scene as it plays at bpm: as it is without a loop, else snapped to its loop.
export function snapLoop(scene: Scene, bpm: number): Scene {
  if (!scene.loop) return scene
  const length = (scene.loop.seconds * bpm) / 60 // in beats, the clock periods count in
  const out = structuredClone(scene)
  const ks = new Map<number, number>() // each period as written and its k
  for (const m of out.modulators) {
    let k = ks.get(m.period)
    if (k === undefined) {
      // the k nearest the period that shares no factor with another period's
      const want = length / m.period
      const taken = [...ks.values()]
      k = 1
      for (let c = Math.max(2, Math.floor(want / 2)); c <= Math.ceil(want) * 2 + 1; c++)
        if (taken.every((t) => gcd(c, t) === 1) && Math.abs(Math.log(c / want)) < Math.abs(Math.log(k / want))) k = c
      ks.set(m.period, k)
    }
    m.period = length / k
    if (m.harmonics) m.harmonics = [Math.round(m.harmonics[0]), Math.round(m.harmonics[1])]
    if (m.wave === 'ramp')
      for (const t of m.targets) {
        // a ramp jumps by twice its depth at the end of each period: a whole number of periods, at least one
        const half = PERIOD[kindOf(t.knob)] / 2
        if (half) t.depth = half * (Math.round(t.depth / half) || Math.sign(t.depth))
      }
  }
  // the rings repeat every half turn of their phase, the palette once round its index, the dots every dot: each runs
  // the whole number of those nearest its rate over the loop, inside its hard range
  const whole = (v: number, unit: number, [lo, hi]: [number, number]) => {
    const n = Math.round(v / unit)
    return n * unit > hi || n * unit < lo ? (n - Math.sign(n)) * unit : n * unit
  }
  out.contour.drift.value = whole(out.contour.drift.value, Math.PI / length, hardRange('contour.drift'))
  out.palette.time.value = whole(out.palette.time.value, 1 / length, hardRange('palette.time'))
  if (out.line.dots)
    out.line.dots.crawl.value = whole(out.line.dots.crawl.value, 1 / length, hardRange('line.dots.crawl'))
  return out
}
