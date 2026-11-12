import { describe, expect, it } from 'vitest'
import { moveLevel, removeLevel } from './edit'
import { level, LOOKS, mod, scene, star } from './looks'
import { gcd } from './loop'
import { advance, applyPreset, capturePreset, detunePeriods, newLive, setMacro, update, wave } from './motion'
import { FEATURES, hardRange, knobsOf, resolve, type Listen, type Modulator, type Scene } from './scene'
import type { Heard } from './music'

const base = () =>
  scene({
    name: 'test',
    levels: [
      level('a', { scale: { value: 2, spread: 1, play: [1.5, 2.5] }, shape: star(6, 2, 0.4) }),
      level('b', { link: 'a', scale: 7 }),
    ],
  })

describe('motion', () => {
  it('waves run 0 to 1, cos and tri starting at 1', () => {
    const m = mod('m', 'cos', 1, [])
    expect(wave(m, 0)).toBeCloseTo(1)
    expect(wave(m, 0.5)).toBeCloseTo(0)
    expect(wave({ ...m, wave: 'tri' }, 0)).toBeCloseTo(1)
    expect(wave({ ...m, wave: 'ramp' }, 0.25)).toBeCloseTo(0.25)
    expect(wave({ ...m, wave: 'steps', steps: [0, 0.5, 1] }, 0.5)).toBe(0.5)
  })

  it('a linked level shares its leader knobs, with the spread across the group', () => {
    const shown = advance(base(), newLive(), 0, 60)
    expect(shown.levels[0].affine.scale.value).toBe(2)
    expect(shown.levels[1].affine.scale.value).toBe(2.5)
  })

  it('a linked level plays its leader structure, and keeps what it showed when its leader goes', () => {
    const s = update(base(), (d) => (d.levels[0].variants[0].shape.n = 9))
    expect(advance(s, newLive(), 0, 60).levels[1].variants[0].shape.n).toBe(9)
    const gone = update(s, (d) => removeLevel(d, 'a'))
    expect(gone.levels[0].link).toBeUndefined()
    expect(gone.levels[0].variants[0].shape.n).toBe(9)
    expect(gone.levels[0].affine.scale.value).toBe(2.5)
  })

  it('a linked level moved above its leader unlinks with the values it showed', () => {
    const moved = update(base(), (d) => moveLevel(d, 'b', -1))
    expect(moved.levels.map((l) => [l.id, l.link])).toEqual([
      ['b', undefined],
      ['a', undefined],
    ])
    expect(moved.levels[0].affine.scale.value).toBe(2.5)
  })

  it('a modulator keeps to the play range, and its phase runs on when its period changes', () => {
    const s = update(base(), (d) => d.modulators.push(mod('m', 'tri', 4, [['levels[a].affine.scale', 3]])))
    const live = newLive()
    expect(advance(s, live, 0, 60).levels[0].affine.scale.value).toBe(2.5)
    advance(s, live, 1, 60)
    expect(live.phases.get('m')).toBeCloseTo(0.25)
    const slower = update(s, (d) => (d.modulators[0].period = 8))
    advance(slower, live, 1, 60)
    expect(live.phases.get('m')).toBeCloseTo(0.375)
    expect(advance(slower, live, 0, 120).levels[0].affine.scale.value).toBeGreaterThanOrEqual(1.5)
  })

  it('a glide eases a knob toward a new value', () => {
    const s = update(base(), (d) => (d.levels[0].weight.glide = 1))
    const live = newLive()
    advance(s, live, 0.1, 60)
    const half = advance(
      update(s, (d) => (d.levels[0].weight.value = 0)),
      live,
      Math.LN2,
      60,
    )
    expect(half.levels[0].weight.value).toBeCloseTo(0.5)
  })

  it('a macro sets its knobs between from and to, inside their play ranges', () => {
    const s = update(base(), (d) => {
      d.macros.push({ id: 'x', name: 'X', value: 0, targets: [{ knob: 'levels[a].affine.scale', from: 1, to: 3 }] })
      setMacro(d, 'x', 0.5)
    })
    expect(s.levels[0].affine.scale.value).toBe(2)
    expect(update(s, (d) => setMacro(d, 'x', 1)).levels[0].affine.scale.value).toBe(2.5)
  })

  it('a preset captures every knob and puts them back', () => {
    const s = base()
    const p = capturePreset(s, 'p')
    const moved = update(s, (d) => (d.frame.zoom.value = 3))
    expect(applyPreset(moved, p)).toEqual(s)
  })
})

// what the music gives a frame: no feature heard but those given, the beat felt as it is unless given
const heard = (beat: number, o: Partial<Heard> = {}): Heard => ({
  bpm: 120,
  locked: true,
  beat,
  felt: beat,
  snap: 0,
  rate: 1,
  ...o,
  features: { ...(Object.fromEntries(FEATURES.map((f) => [f, 0])) as Heard['features']), ...o.features },
})

describe('music', () => {
  const scale = (s: Scene) => s.levels[0].affine.scale.value
  const listening = (listen: Listen, depth: number, o: Partial<Modulator> = {}) =>
    update(base(), (d) =>
      d.modulators.push({
        ...mod('m', 'steps', 2, [['levels[a].affine.scale', depth]], { steps: [0, 1], listen }),
        ...o,
      }),
    )

  it('runs the clock on the felt beat at its rate while music plays, not on the seconds', () => {
    const s = update(base(), (d) => d.modulators.push(mod('m', 'ramp', 4, [])))
    const live = newLive()
    // the seconds until the music's tempo is found
    advance(s, live, 1, 60, heard(9, { locked: false }))
    expect(live.phases.get('m')).toBeCloseTo(0.25)
    live.phases.set('m', 0)
    advance(s, live, 1, 60, heard(10))
    expect(live.phases.get('m')).toBe(0)
    advance(s, live, 1, 60, heard(11, { rate: 0.5 }))
    expect(live.phases.get('m')).toBeCloseTo(0.125)
    advance(s, live, 1, 60, heard(11.5, { felt: 11.9 }))
    expect(live.phases.get('m')).toBeCloseTo(0.35)
    // the seconds again once the music stops
    advance(s, live, 1, 60)
    expect(live.phases.get('m')).toBeCloseTo(0.6)
  })

  it('a modulator on the beats plays its wave at the felt beat, a step a beat, and rests with no music', () => {
    const s = listening('beats', 0.5)
    expect(scale(advance(s, newLive(), 0, 60, heard(4.5)))).toBe(1.5)
    expect(scale(advance(s, newLive(), 0, 60, heard(5.2)))).toBe(2.5)
    expect(scale(advance(s, newLive(), 0, 60, heard(5.9, { felt: 6.1 })))).toBe(1.5)
    expect(scale(advance(s, newLive(), 0, 60))).toBe(2)
    expect(scale(advance(s, newLive(), 0, 60, heard(5.2, { locked: false })))).toBe(2)
  })

  it('a modulator on a feature pushes its knobs up by depth at 1, and falls back with no music', () => {
    const s = listening('bass', 0.4)
    expect(scale(advance(s, newLive(), 0, 60, heard(0, { features: { bass: 1 } as Heard['features'] })))).toBe(2.4)
    expect(scale(advance(s, newLive(), 0, 60, heard(0, { features: { bass: 0.5 } as Heard['features'] })))).toBeCloseTo(
      2.2,
    )
    const glided = listening('bass', 0.4, { glide: 1 })
    const live = newLive()
    advance(glided, live, 0, 60, heard(0, { features: { bass: 1 } as Heard['features'] }))
    expect(scale(advance(glided, live, Math.LN2, 60))).toBeCloseTo(2.2)
  })

  it("a macro on a feature takes its value while music plays, inside the play ranges, and is the hand's without", () => {
    const s = update(base(), (d) =>
      d.macros.push({
        id: 'x',
        name: 'X',
        value: 0,
        listen: 'tone',
        targets: [{ knob: 'levels[a].affine.scale', from: 1.5, to: 3.5 }],
      }),
    )
    const shown = advance(s, newLive(), 0, 60, heard(0, { features: { tone: 0.25 } as Heard['features'] }))
    expect(scale(shown)).toBe(2)
    expect(shown.macros[0].value).toBe(0.25)
    expect(scale(advance(s, newLive(), 0, 60, heard(0, { features: { tone: 1 } as Heard['features'] })))).toBe(2.5)
    expect(scale(advance(s, newLive(), 0, 60))).toBe(2)
    expect(s.macros[0].value).toBe(0)
  })
})

describe('detune to coprimes', () => {
  it("nudges each period to the nearest whole number coprime with the shorter ones: Tapestry 1's 119 is 7 × 17", () => {
    const t1 = LOOKS.find((l) => l.name.startsWith('Tapestry 1'))!
    // the clock's: those that listen to the music keep their periods
    const clocked = (s: Scene) => s.modulators.filter((m) => !m.listen).map((m) => m.period)
    expect(clocked(t1)).toEqual([119, 17, 69])
    expect(clocked(update(t1, detunePeriods))).toEqual([118, 17, 69])
    expect(update(t1, detunePeriods).modulators.filter((m) => m.listen)).toEqual(t1.modulators.filter((m) => m.listen))
  })

  it('leaves a period under a clock unit as it was', () => {
    const s = update(base(), (d) => d.modulators.push(mod('fast', 'cos', 0.25, []), mod('slow', 'cos', 12.4, [])))
    expect(update(s, detunePeriods).modulators.map((m) => m.period)).toEqual([0.25, 12])
  })

  it('takes the nearer neighbour first when its own whole period is taken', () => {
    // 15 shares 3 with the shorter period; 14 is nearer to 14.6 than 16
    const s = update(base(), (d) => d.modulators.push(mod('a', 'cos', 3, []), mod('b', 'cos', 14.6, [])))
    expect(update(s, detunePeriods).modulators.map((m) => m.period)).toEqual([3, 14])
  })

  it('leaves every pair coprime, whole and near where it was', () => {
    for (const look of LOOKS) {
      const clocked = (s: Scene) => s.modulators.filter((m) => !m.listen)
      const periods = clocked(update(look, detunePeriods)).map((m) => m.period)
      periods.forEach((p, i) => {
        expect(Number.isInteger(p) && p >= 1, look.name).toBe(true)
        expect(Math.abs(p - clocked(look)[i].period), look.name).toBeLessThan(4)
        for (const q of periods.slice(i + 1)) expect(gcd(p, q), `${look.name}: ${p}, ${q}`).toBe(1)
      })
    }
  })
})

describe('the built-in looks', () => {
  it('share no knob objects between levels', () => {
    for (const look of LOOKS) {
      const knobs = knobsOf(look).map((k) => k.knob)
      expect(new Set(knobs).size, look.name).toBe(knobs.length)
    }
  })

  it('have 3 to 5 macros each', () => {
    for (const look of LOOKS) expect(look.macros.length, look.name).toSatisfy((n: number) => n >= 3 && n <= 5)
  })

  // the default macros, Breathing lattice's and Square to hex's, and the music's tone
  const DEFAULTS = ['breathe', 'morph', 'character', 'size', 'hue', 'gain', 'lattice', 'music-tone']

  it('move nothing at their own values, the defaults and Square to hex', () => {
    for (const look of LOOKS)
      for (const m of look.macros.filter((m) => DEFAULTS.includes(m.id))) {
        const moved = update(look, (d) => setMacro(d, m.id, m.value))
        for (const { knob } of m.targets) {
          const [lo, hi] = hardRange(knob)
          expect(
            Math.abs(resolve(moved, knob)!.value - resolve(look, knob)!.value),
            `${look.name}: ${m.name}, ${knob}`,
          ).toBeLessThan((hi - lo) / 1000)
        }
      }
  })

  it('aim no macro at a linked level, which plays its leader knobs', () => {
    for (const look of LOOKS) {
      const at = new Map(knobsOf(look).map((k) => [k.address, k]))
      for (const m of look.macros)
        for (const { knob } of m.targets)
          expect(at.get(knob)!.level?.level.link, `${look.name}: ${knob}`).toBeUndefined()
    }
  })
})
