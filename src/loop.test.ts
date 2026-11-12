import { describe, expect, it } from 'vitest'
import { snapLoop } from './loop'
import { LOOKS, mod } from './looks'
import { advance, newLive, update, type Live } from './motion'
import { knobsOf, type Scene } from './scene'

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)

// what a frame shows: every knob's value and the running phases
const shot = (frame: Scene, live: Live) => ({
  values: knobsOf(frame).map((k) => k.knob.value),
  drift: live.drift,
  colour: live.colour,
  crawl: live.crawl,
})

// the first frame and the frame a loop on (after warm frames first), from the clock's start
function frames(look: Scene, bpm: number, seconds: number, warm = 0) {
  const dt = 0.1
  const steps = Math.round(seconds / dt)
  const s = snapLoop(look, bpm)
  const live = newLive()
  const shots: ReturnType<typeof shot>[] = []
  for (let i = 1; i <= warm + steps + 1; i++) {
    const frame = advance(s, live, (i * dt * bpm) / 60, dt)
    if (i === warm + 1 || i === warm + steps + 1) shots.push(shot(frame, live))
  }
  return shots
}

function matches([first, last]: ReturnType<typeof frames>) {
  last.values.forEach((v, i) => expect(v).toBeCloseTo(first.values[i], 6))
  expect(turnsApart(last.drift, first.drift, Math.PI)).toBeLessThan(1e-6)
  expect(turnsApart(last.colour, first.colour, 1)).toBeLessThan(1e-6)
  expect(turnsApart(last.crawl, first.crawl, 1)).toBeLessThan(1e-6)
}

// a glided modulator starts on its wave and settles behind it, so its look loops from its second loop on
const glided = (look: Scene) => look.modulators.some((m) => m.glide > 0)

// a and b the same phase, round a period
const turnsApart = (a: number, b: number, period: number) => {
  const d = (((a - b) % period) + period) % period
  return Math.min(d, period - d)
}

describe('a loop', () => {
  const plays = (looks: Scene[]) => looks.flatMap((look) => [60, 97].map((bpm) => [look.name, bpm, look] as const))
  it.each(plays(LOOKS.filter((l) => !glided(l))))(
    '%s at %i bpm: its frame a loop on matches its first',
    (_, bpm, look) => matches(frames({ ...look, loop: { seconds: 30 } }, bpm, 30)),
  )
  it.each(plays(LOOKS.filter(glided)))(
    '%s at %i bpm, glided: its frame a loop on matches the one a loop before, from its second loop',
    (_, bpm, look) => matches(frames({ ...look, loop: { seconds: 30 } }, bpm, 30, 300)),
  )

  it.each(plays(LOOKS))(
    '%s at %i bpm, entered at a clock time T: draws as it does at T modulo its loop',
    (_, bpm, look) => {
      const s = snapLoop({ ...look, loop: { seconds: 30 } }, bpm)
      const length = (30 * bpm) / 60
      const at = (beats: number) => {
        const live = newLive()
        return shot(advance(s, live, beats, 0), live)
      }
      matches([at(3.3), at(7 * length + 3.3)])
    },
  )

  it('carries its phases on through a change of tempo, which snaps its periods afresh', () => {
    const look = { ...LOOKS[0], loop: { seconds: 30 } }
    const live = newLive()
    const rates = ['contour.drift', 'palette.time', 'line.dots.crawl']
    const at = (bpm: number, dt: number) => {
      const frame = advance(snapLoop(look, bpm), live, 47.3, dt)
      return {
        ...shot(frame, live),
        values: knobsOf(frame).flatMap((k) => (rates.includes(k.address) ? [] : [k.knob.value])),
      }
    }
    matches([at(60, 0.1), at(120, 0)])
  })

  it('wraps a ramp on a stop hue round the hue wheel, so it loops from its first frame', () => {
    const look = update(LOOKS[0], (d) => {
      d.loop = { seconds: 10 }
      d.modulators = [mod('hue', 'ramp', 3, [['palette.stops[0].lch[2]', 100]])]
      d.palette.stops[0].lch[2].value = 40
    })
    matches(frames(look, 60, 10))
  })

  it('is needed: without one, the frames 30 s apart differ', () => {
    const [first, last] = frames(LOOKS[0], 60, 30)
    expect(last.values).not.toEqual(first.values)
  })

  it('snaps periods to its length over whole ks, coprime between periods, one k for each period', () => {
    const atoms = LOOKS.find((l) => l.name === 'Atoms')!
    const s = snapLoop({ ...atoms, loop: { seconds: 60 } }, 60)
    // those that listen to the music keep to it
    expect(s.modulators.filter((m) => m.listen)).toEqual(atoms.modulators.filter((m) => m.listen))
    const ks = new Map(
      s.modulators.flatMap((m, i) => (m.listen ? [] : [[atoms.modulators[i].period, 60 / m.period] as const])),
    )
    for (const k of ks.values()) expect(k).toBeCloseTo(Math.round(k), 9)
    const whole = [...ks.values()].map(Math.round)
    whole.forEach((k, i) => whole.slice(i + 1).forEach((k2) => expect(gcd(k, k2)).toBe(1)))
    // orbitX and orbitY share a period, so they keep their circle
    expect(s.modulators[0].period).toBe(s.modulators[1].period)
  })

  it('makes ramps on turns and the running phases whole', () => {
    const look = update(LOOKS[0], (d) => {
      d.loop = { seconds: 10 }
      d.modulators.push(mod('spin', 'ramp', 3, [['palette.hue', 100]]))
      d.palette.time.value = 0.083
    })
    const s = snapLoop(look, 60)
    expect(s.modulators.at(-1)!.targets[0].depth).toBe(180)
    expect(s.palette.time.value).toBeCloseTo(0.1, 9)
    expect((s.contour.drift.value * 10) / Math.PI).toBeCloseTo(1, 9)
  })

  it("makes the dots' crawl whole dots over the loop", () => {
    const look = update(LOOKS[0], (d) => {
      d.loop = { seconds: 10 }
      d.line.kind = 'dots'
      d.line.dots = { count: { value: 12 }, size: { value: 0.3 }, crawl: { value: 0.37 } }
    })
    expect(snapLoop(look, 60).line.dots!.crawl.value).toBeCloseTo(0.4, 9)
    matches(frames(look, 60, 10))
  })
})
