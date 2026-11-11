import { describe, expect, it } from 'vitest'
import { snapLoop } from './loop'
import { LOOKS, mod } from './looks'
import { advance, newLive, update } from './motion'
import { knobsOf, type Scene } from './scene'

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)

// the first frame and the frame a loop on (after warm frames first): every knob's value and the running phases
function frames(look: Scene, bpm: number, seconds: number, warm = 0) {
  const dt = 0.1
  const steps = Math.round(seconds / dt)
  const s = snapLoop(look, bpm)
  const live = newLive()
  const shots: { values: number[]; drift: number; colour: number }[] = []
  for (let i = 1; i <= warm + steps + 1; i++) {
    const frame = advance(s, live, dt, bpm)
    if (i === warm + 1 || i === warm + steps + 1)
      shots.push({ values: knobsOf(frame).map((k) => k.knob.value), drift: live.drift, colour: live.colour })
  }
  return shots
}

function matches([first, last]: ReturnType<typeof frames>) {
  last.values.forEach((v, i) => expect(v).toBeCloseTo(first.values[i], 6))
  expect(turnsApart(last.drift, first.drift, Math.PI)).toBeLessThan(1e-6)
  expect(turnsApart(last.colour, first.colour, 1)).toBeLessThan(1e-6)
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
    const t6 = LOOKS.find((l) => l.name.startsWith('Tapestry 6'))!
    const s = snapLoop({ ...t6, loop: { seconds: 60 } }, 60)
    const ks = new Map(s.modulators.map((m, i) => [t6.modulators[i].period, 60 / m.period]))
    for (const k of ks.values()) expect(k).toBeCloseTo(Math.round(k), 9)
    const whole = [...ks.values()].map(Math.round)
    whole.forEach((k, i) => whole.slice(i + 1).forEach((k2) => expect(gcd(k, k2)).toBe(1)))
    // panX and panY share a period, so they keep their circle
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
})
