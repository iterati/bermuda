import { describe, expect, it } from 'vitest'
import { moveLevel, removeLevel } from './edit'
import { level, LOOKS, mod, scene, star } from './looks'
import { gcd } from './loop'
import { morph } from './morph'
import {
  advance,
  applyPreset,
  capturePreset,
  detunePeriods,
  dice,
  learnMacro,
  keepTime,
  newLive,
  newTime,
  setMacro,
  update,
  wave,
  type Live,
} from './motion'
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
    const shown = advance(base(), newLive(), 0, 0)
    expect(shown.levels[0].affine.scale.value).toBe(2)
    expect(shown.levels[1].affine.scale.value).toBe(2.5)
  })

  it('a linked level plays its leader structure, and keeps what it showed when its leader goes', () => {
    const s = update(base(), (d) => (d.levels[0].variants[0].shape.n = 9))
    expect(advance(s, newLive(), 0, 0).levels[1].variants[0].shape.n).toBe(9)
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

  it("a modulator keeps to the play range and plays at the clock's time over its period, running on as it changes", () => {
    const s = update(base(), (d) => d.modulators.push(mod('m', 'tri', 4, [['levels[a].affine.scale', 3]])))
    expect(advance(s, newLive(), 0, 0).levels[0].affine.scale.value).toBe(2.5)
    const gentle = update(s, (d) => (d.modulators[0].targets[0].depth = 0.4))
    const scale = (s: Scene, live: Live, at: number) => advance(s, live, at, 0.1).levels[0].affine.scale.value
    const live = newLive()
    // a quarter round, the tri at 0.5
    expect(scale(gentle, live, 1)).toBeCloseTo(2)
    const slower = update(gentle, (d) => (d.modulators[0].period = 8))
    expect(scale(slower, live, 1)).toBeCloseTo(2)
    // an eighth on, the tri at 0.25
    expect(scale(slower, live, 2)).toBeCloseTo(1.8)
    // a look coming in afresh: 2 beats over 8
    expect(scale(slower, newLive(), 2)).toBeCloseTo(2)
  })

  // a look on side a since the clock started, run frame by frame to at
  const played = (s: Scene, at: number) => {
    const live = newLive()
    for (let t = 0; t < at; t += 0.1) advance(s, live, t, 0.1)
    return { scene: advance(s, live, at, 0.1), live }
  }
  const turning = (name: string, period: number) =>
    update(scene({ name, levels: [level('a', { shape: star(6, 2, 0.4) })] }), (d) => {
      d.modulators.push(mod('m', 'cos', period, [['frame.turn', 40]]))
      d.contour.drift.value = 0.3
    })

  it('a look loaded at the clock time T plays its modulators at T over their periods, not from their start', () => {
    const s = turning('loaded', 8)
    const fresh = advance(s, newLive(), 13, 0)
    // 13 beats over 8: 5/8 round the cos from where it starts
    expect(fresh.frame.turn.value).toBeCloseTo(40 * (2 * (0.5 + 0.5 * Math.cos(2 * Math.PI * (13 / 8))) - 1))
    expect(fresh.frame.turn.value).not.toBeCloseTo(advance(s, newLive(), 0, 0).frame.turn.value)
  })

  it('a look coming in at the clock time T shows as one that played all along to T', () => {
    const s = turning('incoming', 8)
    const along = played(s, 13)
    const live = newLive()
    const incoming = advance(s, live, 13, 0)
    expect(incoming.frame.turn.value).toBeCloseTo(along.scene.frame.turn.value, 9)
    expect(live.drift).toBeCloseTo(along.live.drift, 9)
  })

  it('two looks sharing a period are in phase across the fader mid-transition', () => {
    const [a, b] = [turning('a', 8), update(turning('b', 8), (d) => (d.frame.turn.value = 30))]
    const showing = played(a, 13)
    const incoming = advance(b, newLive(), 13, 0)
    const swing = showing.scene.frame.turn.value - a.frame.turn.value
    expect(Math.abs(swing)).toBeGreaterThan(1)
    expect(incoming.frame.turn.value - b.frame.turn.value).toBeCloseTo(swing, 9)
    const edge = { seconds: 2, stagger: 0, deepFirst: false }
    expect(morph(showing.scene, incoming, 0.5, edge, newLive()).scene.frame.turn.value).toBeCloseTo(15 + swing, 9)
  })

  it("a turn of a running rate moves its phase on from where it is, and a new look's starts at the clock's", () => {
    const s = turning('drift', 8)
    const live = newLive()
    advance(s, live, 10, 0)
    expect(live.drift).toBeCloseTo(3)
    const faster = update(s, (d) => (d.contour.drift.value = 0.5))
    advance(faster, live, 10, 0)
    expect(live.drift).toBeCloseTo(3)
    advance(faster, live, 12, 0.1)
    expect(live.drift).toBeCloseTo(4)
    const fresh = newLive()
    advance(faster, fresh, 12, 0)
    expect(fresh.drift).toBeCloseTo(6)
  })

  it('a glide eases a knob toward a new value', () => {
    const s = update(base(), (d) => (d.levels[0].weight.glide = 1))
    const live = newLive()
    advance(s, live, 0.1, 0.1)
    const half = advance(
      update(s, (d) => (d.levels[0].weight.value = 0)),
      live,
      0.1 + Math.LN2,
      Math.LN2,
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

  describe('dice', () => {
    const look = LOOKS.find((l) => l.name.startsWith('Tapestry 7 '))!
    const all = knobsOf(look).map((k) => k.address)
    const scale = 'levels[h1].affine.scale'
    const m = 'levels[h1].variants[0].shape.m'

    it('roll every knob with a play range inside it and leave the rest', () => {
      const rolled = update(look, (d) => dice(d, all, Math.random))
      for (const { address, knob } of knobsOf(rolled)) {
        const was = resolve(look, address)!
        if (was.play) expect(knob.value, address).toSatisfy((v: number) => v >= was.play![0] && v <= was.play![1])
        else expect(knob.value, address).toBe(was.value)
      }
    })

    it('land on the low end, the high end and the middle', () => {
      const at = (r: number) => update(look, (d) => dice(d, [scale, m], () => r))
      expect(resolve(at(0), scale)!.value).toBe(1.35)
      expect(resolve(at(1), scale)!.value).toBe(1.75)
      expect(resolve(at(0.5), scale)!.value).toBeCloseTo(1.55)
      expect(resolve(at(0), m)!.value).toBe(1.01)
      expect(resolve(at(1), m)!.value).toBe(6)
      expect(resolve(at(0.5), m)!.value).toBeCloseTo(3.505)
    })
  })

  describe('learnMacro', () => {
    const armed = () => update(base(), (d) => d.macros.push({ id: 'x', name: 'X', value: 0, targets: [] }))

    it('learns the knobs moved since it was armed, from before to after, at 1, and 0 puts them back', () => {
      const before = armed()
      const learned = update(before, (d) => {
        d.levels[0].affine.scale.value = 2.4
        d.frame.zoom.value = 3
        learnMacro(d, 'x', before)
      })
      expect(learned.macros[0].value).toBe(1)
      expect(learned.macros[0].targets).toEqual([
        { knob: 'frame.zoom', from: before.frame.zoom.value, to: 3 },
        { knob: 'levels[a].affine.scale', from: 2, to: 2.4 },
      ])
      const back = update(learned, (d) => setMacro(d, 'x', 0))
      expect(back.frame.zoom.value).toBe(before.frame.zoom.value)
      expect(back.levels[0].affine.scale.value).toBe(2)
    })

    it('keeps an earlier still target from, taking its value as to, and learns no knob moved back', () => {
      const before = update(armed(), (d) => {
        d.macros[0].targets.push({ knob: 'levels[a].weight', from: 0.2, to: 0.9 })
        d.levels[0].weight.value = 0.6
      })
      const learned = update(before, (d) => {
        d.frame.zoom.value = 3
        d.frame.zoom.value = before.frame.zoom.value
        d.levels[0].affine.scale.value = 1.8
        learnMacro(d, 'x', before)
      })
      expect(learned.macros[0].targets).toEqual([
        { knob: 'levels[a].weight', from: 0.2, to: 0.6 },
        { knob: 'levels[a].affine.scale', from: 2, to: 1.8 },
      ])
    })
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
    const time = newTime()
    // the seconds until the music's tempo is found
    keepTime(time, 1, 60, heard(9, { locked: false }))
    expect(time.beats).toBeCloseTo(1)
    keepTime(time, 1, 60, heard(10))
    expect(time.beats).toBeCloseTo(1)
    keepTime(time, 1, 60, heard(11, { rate: 0.5 }))
    expect(time.beats).toBeCloseTo(1.5)
    keepTime(time, 1, 60, heard(11.5, { felt: 11.9 }))
    expect(time.beats).toBeCloseTo(2.4)
    // never back, though the felt beat moves back
    keepTime(time, 1, 60, heard(11.8))
    expect(time.beats).toBeCloseTo(2.4)
    // the seconds again once the music stops
    keepTime(time, 1, 60)
    expect(time.beats).toBeCloseTo(3.4)
  })

  it('a modulator on the beats plays its wave at the felt beat, a step a beat, and rests with no music', () => {
    const s = listening('beats', 0.5)
    expect(scale(advance(s, newLive(), 0, 0, heard(4.5)))).toBe(1.5)
    expect(scale(advance(s, newLive(), 0, 0, heard(5.2)))).toBe(2.5)
    expect(scale(advance(s, newLive(), 0, 0, heard(5.9, { felt: 6.1 })))).toBe(1.5)
    expect(scale(advance(s, newLive(), 0, 0))).toBe(2)
    expect(scale(advance(s, newLive(), 0, 0, heard(5.2, { locked: false })))).toBe(2)
  })

  it('a modulator on a feature pushes its knobs up by depth at 1, and falls back with no music', () => {
    const s = listening('bass', 0.4)
    expect(scale(advance(s, newLive(), 0, 0, heard(0, { features: { bass: 1 } as Heard['features'] })))).toBe(2.4)
    expect(scale(advance(s, newLive(), 0, 0, heard(0, { features: { bass: 0.5 } as Heard['features'] })))).toBeCloseTo(
      2.2,
    )
    const glided = listening('bass', 0.4, { glide: 1 })
    const live = newLive()
    advance(glided, live, 0, 0, heard(0, { features: { bass: 1 } as Heard['features'] }))
    expect(scale(advance(glided, live, Math.LN2, Math.LN2))).toBeCloseTo(2.2)
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
    const shown = advance(s, newLive(), 0, 0, heard(0, { features: { tone: 0.25 } as Heard['features'] }))
    expect(scale(shown)).toBe(2)
    expect(shown.macros[0].value).toBe(0.25)
    expect(scale(advance(s, newLive(), 0, 0, heard(0, { features: { tone: 1 } as Heard['features'] })))).toBe(2.5)
    expect(scale(advance(s, newLive(), 0, 0))).toBe(2)
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
