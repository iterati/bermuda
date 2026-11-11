import { describe, expect, it } from 'vitest'
import { level, mod, scene, star } from './looks'
import { advance, applyPreset, capturePreset, newLive, setMacro, update, wave } from './motion'

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
