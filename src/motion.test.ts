import { describe, expect, it } from 'vitest'
import { moveLevel, removeLevel } from './edit'
import { level, LOOKS, mod, scene, star } from './looks'
import { gcd } from './loop'
import { advance, applyPreset, capturePreset, detunePeriods, newLive, setMacro, update, wave } from './motion'
import { knobsOf } from './scene'

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

describe('detune to coprimes', () => {
  it("nudges each period to the nearest whole number coprime with the shorter ones: Tapestry 1's 119 is 7 × 17", () => {
    const t1 = LOOKS.find((l) => l.name.startsWith('Tapestry 1'))!
    expect(t1.modulators.map((m) => m.period)).toEqual([119, 17, 69])
    expect(update(t1, detunePeriods).modulators.map((m) => m.period)).toEqual([118, 17, 69])
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
      const periods = update(look, detunePeriods).modulators.map((m) => m.period)
      periods.forEach((p, i) => {
        expect(Number.isInteger(p) && p >= 1, look.name).toBe(true)
        expect(Math.abs(p - look.modulators[i].period), look.name).toBeLessThan(4)
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
})
