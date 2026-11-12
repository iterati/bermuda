// The analysis of synthetic sound: click tracks at known tempi give their tempo and where their beats fall, tones
// at known pitches light their own band and read dark or light, a fast sharp click drives where a slow soft swell
// grooves, and silence reads as none; the felt beat snaps each beat's move to its start. The tap loads from a file
// of its own, as a page whose policy refuses blob: and data: scripts (the board viewer's) would refuse it.
import { describe, expect, it } from 'vitest'
import { felt, hear, heardAt, newEar, TAP, type Ear } from './music'
import { BANDS } from './scene'

const RATE = 44100

// seconds of sound, sample by sample, fed in blocks as the worklet posts them
function play(seconds: number, sample: (t: number) => number, ear = newEar(RATE)): Ear {
  const block = new Float32Array(1024)
  for (let i = 0; i < seconds * RATE; i += block.length) {
    for (let j = 0; j < block.length; j++) block[j] = sample((i + j) / RATE)
    hear(ear, block)
  }
  return ear
}

// a click on every beat from the first, at bpm: a 2 kHz burst dying away over about 10 ms
const clicks =
  (bpm: number, first = 0.1) =>
  (t: number) => {
    const since = (t - first) % (60 / bpm)
    return t < first ? 0 : 0.8 * Math.exp(-since / 0.01) * Math.sin(2 * Math.PI * 2000 * since)
  }

// the beat's distance from where the clicks put it, in beats, -0.5 to 0.5
const off = (ear: Ear, bpm: number, first = 0.1) => {
  const { beat } = heardAt(ear, ear.time)
  const d = beat - (ear.time - first) * (bpm / 60)
  return d - Math.round(d)
}

describe('music', () => {
  it.each([90, 120, 140])('hears a click track at %i bpm: its tempo and where its beats fall', (bpm) => {
    const ear = play(12, clicks(bpm))
    expect(ear.locked).toBe(true)
    expect(ear.bpm).toBeCloseTo(bpm, 0)
    expect(Math.abs(off(ear, bpm))).toBeLessThan(0.05)
  })

  it('follows a tempo that changes', () => {
    const ear = play(10, clicks(100))
    play(10, (t) => clicks(130, 0)(t), ear)
    expect(Math.abs(ear.bpm - 130)).toBeLessThan(1.5)
  })

  it.each([
    [50, 'sub'],
    [100, 'bass'],
    [220, 'low'],
    [440, 'lowmid'],
    [1000, 'mid'],
    [2500, 'highmid'],
    [5000, 'presence'],
    [10000, 'air'],
  ])('a tone at %i Hz fills the %s band and leaves the rest', (hz, band) => {
    const { features } = play(2, (t) => 0.5 * Math.sin(2 * Math.PI * hz * t))
    expect(features[band as (typeof BANDS)[number]]).toBeGreaterThan(0.95)
    for (const b of BANDS) if (b !== band) expect(features[b]).toBeLessThan(0.6)
    expect(features.level).toBeGreaterThan(0.9)
  })

  it('a low tone reads dark and a high one light, and noise as loud in each band sits between', () => {
    const tone = (hz: number) => play(6, (t) => 0.5 * Math.sin(2 * Math.PI * hz * t)).features.tone
    expect(tone(120)).toBeLessThan(0.15)
    expect(tone(6000)).toBeGreaterThan(0.85)
    // pink noise by Paul Kellet's filter of white noise
    let [b0, b1, b2, seed] = [0, 0, 0, 1]
    const pink = play(6, () => {
      seed = (seed * 16807) % 2147483647
      const white = seed / 1073741823.5 - 1
      b0 = 0.99765 * b0 + white * 0.099046
      b1 = 0.963 * b1 + white * 0.2965164
      b2 = 0.57 * b2 + white * 1.0526913
      return 0.1 * (b0 + b1 + b2 + white * 0.1848)
    })
    expect(Math.abs(pink.features.tone - 0.5)).toBeLessThan(0.15)
  })

  it('a fast sharp click drives, a slow soft swell grooves', () => {
    const fast = play(12, clicks(150))
    const swell = play(12, (t) => 0.4 * Math.sin(Math.PI * ((t * 75) / 60)) ** 8 * Math.sin(2 * Math.PI * 330 * t))
    expect(swell.locked).toBe(true)
    expect(fast.features.drive).toBeGreaterThan(0.7)
    expect(swell.features.drive).toBeLessThan(0.35)
    expect(heardAt(fast, fast.time).snap).toBeGreaterThan(heardAt(swell, swell.time).snap)
  })

  it('silence reads as none, and the beat runs on at the tempo it last heard', () => {
    const ear = play(8, clicks(120))
    const before = ear.beat
    play(4, () => 0, ear)
    expect(ear.features.level).toBe(0)
    for (const b of BANDS) expect(ear.features[b]).toBeLessThan(0.01)
    expect(ear.beat - before).toBeCloseTo(8, 1)
  })

  it('the felt beat is the beat at snap 0, and at snap 1 makes most of each move at its start', () => {
    expect(felt(3.25, 0)).toBeCloseTo(3.25)
    expect(felt(3.25, 1) - 3).toBeGreaterThan(0.85)
    expect(felt(4, 1)).toBe(4)
  })
})

describe('the tap', () => {
  it('loads from a file of its own, never a blob: or data: URL', () => {
    expect(TAP).not.toMatch(/^(blob|data):/)
    expect(TAP).toMatch(/tap[\w.-]*\.js/)
  })
})
