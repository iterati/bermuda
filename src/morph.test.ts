import { describe, expect, it } from 'vitest'
import { paletteAt } from './colour'
import { level, scene, star } from './looks'
import { depthWindow, morph } from './morph'
import type { Edge, Scene } from './scene'

const together: Edge = { seconds: 2, stagger: 0, deepFirst: false }
const full = (a: Scene, b: Scene, x: number, edge = together) => morph(a, b, x, edge, { drift: 0, colour: 0 })
const at = (a: Scene, b: Scene, x: number, edge = together) => full(a, b, x, edge).scene
const ids = (s: Scene) => s.levels.map((l) => l.id)
const weights = (s: Scene) => s.levels.map((l) => l.weight.value)

describe('the morph', () => {
  it('pairs levels by depth and pads the shorter chain at the deep end, growing from weight 0', () => {
    const a = scene({ name: 'a', levels: [level('p', { scale: 2 }), level('q')] })
    const b = scene({ name: 'b', levels: [level('r', { scale: 4 }), level('s'), level('t')] })
    expect(ids(at(a, b, 0))).toEqual(['p', 'q', 't'])
    expect(weights(at(a, b, 0))).toEqual([1, 1, 0])
    expect(weights(at(a, b, 0.5))).toEqual([1, 1, 0.5])
    expect(at(a, b, 0.5).levels[0].affine.scale.value).toBe(3)
    // the drawn levels keep A's ids, and each cell turns over to B's picks in the shader
    expect(ids(at(a, b, 1))).toEqual(['p', 'q', 't'])
    expect(full(a, b, 1).toward.levels).toEqual([{ id: 'r', at: 1 }, { id: 's', at: 1 }, null])
    expect(weights(at(a, b, 1))).toEqual([1, 1, 1])
  })

  it('a reorder collapses the level where it was, then grows it where it goes', () => {
    const a = scene({ name: 'a', levels: [level('x'), level('y'), level('z')] })
    const b = scene({ name: 'b', levels: [level('y'), level('z'), level('x')] })
    expect(ids(at(a, b, 0))).toEqual(['x', 'y', 'z', 'x'])
    expect(weights(at(a, b, 0.25))).toEqual([0.5, 1, 1, 0])
    expect(weights(at(a, b, 0.5))).toEqual([0, 1, 1, 0])
    expect(weights(at(a, b, 0.75))).toEqual([0, 1, 1, 0.5])
    expect(weights(at(a, b, 1))).toEqual([0, 1, 1, 1])
  })

  it('a reorder with every depth staggered collapses wholly before it grows', () => {
    const a = scene({ name: 'a', levels: [level('x'), level('y'), level('z')] })
    const b = scene({ name: 'b', levels: [level('z'), level('x'), level('y')] })
    const edge = { ...together, stagger: 1 }
    expect(ids(at(a, b, 0, edge))).toEqual(['z', 'x', 'y', 'z'])
    expect(weights(at(a, b, 0.25, edge))).toEqual([0, 1, 1, 0.5])
    expect(weights(at(a, b, 0.5, edge))).toEqual([0, 1, 1, 0])
    expect(weights(at(a, b, 0.75, edge))).toEqual([0.5, 1, 1, 0])
  })

  it('swaps star n inside a circle dip', () => {
    const a = scene({ name: 'a', levels: [level('s', { shape: star(4, 2, 0.4) })] })
    const b = scene({ name: 'b', levels: [level('s', { shape: star(8, 3, 0.4) })] })
    const shape = (x: number) => at(a, b, x).levels[0].variants[0].shape
    expect(shape(0.05).n).toBe(4)
    expect(shape(0.05).round.value).toBeLessThan(0.1)
    expect(shape(0.45)).toMatchObject({ n: 4, round: { value: 1 } })
    expect(shape(0.55)).toMatchObject({ n: 8, round: { value: 1 } })
    expect(shape(1)).toMatchObject({ n: 8, round: { value: 0 } })
  })

  it('swaps parity where the cells do not turn', () => {
    const a = scene({ name: 'a', levels: [level('c', { cellTurn: 30 })] })
    const b = scene({ name: 'b', levels: [level('c', { by: 'parity', cellTurn: 30 })] })
    expect(at(a, b, 0.45).levels[0].cell).toMatchObject({ by: 'none', turn: { value: 0 } })
    expect(at(a, b, 0.55).levels[0].cell).toMatchObject({ by: 'parity', turn: { value: 0 } })
    expect(at(a, b, 1).levels[0].cell.turn.value).toBe(30)
  })

  it('morphs oblique into voronoi by its jitter, and swaps another lattice kind where the level weighs nothing', () => {
    const square = scene({ name: 'a', levels: [level('l')] })
    const organic = scene({ name: 'b', levels: [level('l', { lattice: 'voronoi', jitter: 0.8 })] })
    expect(at(square, organic, 0).levels[0].lattice).toMatchObject({ kind: 'voronoi', jitter: { value: 0 } })
    expect(at(square, organic, 0.5).levels[0].lattice).toMatchObject({ kind: 'voronoi', jitter: { value: 0.4 } })
    expect(at(square, organic, 0.5).levels[0].weight.value).toBe(1)
    expect(at(square, organic, 1).levels[0].lattice.jitter?.value).toBeCloseTo(0.8)
    const polar = scene({ name: 'a', levels: [level('l', { lattice: 'polar', sectors: 8 })] })
    const brick = scene({ name: 'b', levels: [level('l', { lattice: 'brick' })] })
    const lattice = (x: number) => at(polar, brick, x).levels[0]
    expect(lattice(0)).toMatchObject({ lattice: { kind: 'polar', sectors: 8 }, weight: { value: 1 } })
    expect(lattice(0.47)).toMatchObject({ lattice: { kind: 'polar' }, weight: { value: 0 } })
    expect(lattice(0.53).lattice).toEqual({ kind: 'brick', e2: expect.anything() })
    expect(lattice(0.53).weight.value).toBe(0)
    expect(lattice(1).weight.value).toBe(1)
  })

  it('runs a square pad into a hex one along the rhombic arc', () => {
    const square = scene({ name: 'a', levels: [level('l')] })
    const hex = scene({ name: 'b', levels: [level('l', { lattice: 'triangle', e2: [0.5, Math.sqrt(3) / 2] })] })
    for (const x of [0.25, 0.5, 0.75]) {
      const [e0, e1] = at(square, hex, x).levels[0].lattice.e2.map((k) => k.value)
      expect(Math.hypot(e0, e1), `at ${x}`).toBeCloseTo(1)
      expect((Math.atan2(e1, e0) * 180) / Math.PI, `at ${x}`).toBeCloseTo(90 - 30 * x)
    }
    expect(at(square, hex, 1).levels[0].lattice.e2.map((k) => k.value)).toEqual([0.5, Math.sqrt(3) / 2])
  })

  it('swaps a lattice kind where every cell runs on down its first variant, so its sub-chains do not jump', () => {
    const variants = [
      { share: 1, shape: star(6, 2, 0.4) },
      { share: 1, shape: star(4, 2, 0.4), below: [level('sub')] },
    ]
    const a = scene({ name: 'a', levels: [level('l', { lattice: 'polar', sectors: 6, variants })] })
    const b = scene({ name: 'b', levels: [level('l', { lattice: 'brick', variants })] })
    const shares = (x: number) => at(a, b, x).levels[0].variants.map((v) => v.share.value)
    expect(shares(0.2)[1]).toBeGreaterThan(0)
    expect(shares(0.47)).toEqual([1, 0])
    expect(shares(0.53)).toEqual([1, 0])
    expect(shares(1)).toEqual([1, 1])
  })

  it('staggers each depth over its own window of the fader, deep first when asked', () => {
    expect(depthWindow(0, 2, { ...together, stagger: 1 })).toEqual([0, 0.5])
    expect(depthWindow(1, 2, { ...together, stagger: 1 })).toEqual([0.5, 1])
    expect(depthWindow(0, 2, { ...together, stagger: 1, deepFirst: true })).toEqual([0.5, 1])
    expect(depthWindow(1, 2, { ...together, stagger: 0.4 })).toEqual([0.2, 1])
    const a = scene({ name: 'a', levels: [level('p', { scale: 1 }), level('q', { scale: 1 })] })
    const b = scene({ name: 'b', levels: [level('p', { scale: 3 }), level('q', { scale: 3 })] })
    const scales = (edge: Edge) => at(a, b, 0.5, edge).levels.map((l) => l.affine.scale.value)
    expect(scales({ ...together, stagger: 1 })).toEqual([3, 1])
    expect(scales({ ...together, stagger: 1, deepFirst: true })).toEqual([1, 3])
    expect(scales(together)).toEqual([2, 2])
  })

  it('a sub-chain on one side grows out of the rest of the other side', () => {
    const a = scene({ name: 'a', levels: [level('root'), level('next', { scale: 2 })] })
    const b = scene({
      name: 'b',
      levels: [
        level('root', { variants: [{ share: 1, shape: star(6, 2, 0.4), below: [level('sub', { scale: 3 })] }] }),
        level('next', { scale: 2 }),
      ],
    })
    const start = at(a, b, 0)
    const below = start.levels[0].variants[0].below!
    expect(below.map((l) => [l.id, l.weight.value, l.affine.scale.value])).toEqual([['next', 1, 2]])
    const end = full(a, b, 1)
    expect(end.scene.levels[0].variants[0].below!.map((l) => l.affine.scale.value)).toEqual([3])
    // allLevels order: root, its sub-chain, next
    expect(end.toward.levels[1]).toEqual({ id: 'sub', at: 1 })
  })

  it('keeps every colour of a palette it pads to the other palette stops', () => {
    const a = scene({ name: 'a', levels: [level('p')], palette: 'warm' })
    a.palette.stops = a.palette.stops.slice(0, 3)
    a.palette.stops[1].mix = 'long'
    const b = scene({ name: 'b', levels: [level('p')], palette: 'ice' })
    const start = at(a, b, 0)
    expect(start.palette.stops).toHaveLength(6)
    for (let t = 0; t < 1; t += 0.01) {
      const [want, got] = [paletteAt(a.palette, t), paletteAt(start.palette, t)]
      expect(got[0]).toBeCloseTo(want[0], 6)
      expect(got[1]).toBeCloseTo(want[1], 6)
      expect(Math.cos(((got[2] - want[2]) * Math.PI) / 180)).toBeCloseTo(1, 6)
    }
    // at 1 the stops are B's, their mixes A's blended all the way into B's by the shader
    const end = full(a, b, 1)
    const stops = end.scene.palette.stops.map((s, i) => ({ ...s, mix: end.toward.mixes[i] }))
    for (let t = 0; t < 1; t += 0.01) {
      const [want, got] = [paletteAt(b.palette, t), paletteAt({ ...end.scene.palette, stops }, t)]
      expect(got[0]).toBeCloseTo(want[0], 6)
      expect(got[1]).toBeCloseTo(want[1], 6)
      expect(Math.cos(((got[2] - want[2]) * Math.PI) / 180)).toBeCloseTo(1, 6)
    }
  })
})

describe('a swap', () => {
  it('B into A at 1 - x, the direction flipped, draws what A into B draws at x', () => {
    const a = scene({ name: 'a', levels: [level('p', { scale: 1 }), level('q', { scale: 2 }), level('r')] })
    const b = scene({ name: 'b', levels: [level('q', { scale: 3 }), level('p', { scale: 4 })] })
    const edge: Edge = { seconds: 2, stagger: 0.6, deepFirst: false }
    const there = at(a, b, 0.3, edge).levels.map((l) => [l.weight.value, l.affine.scale.value])
    const back = at(b, a, 0.7, { ...edge, deepFirst: true }).levels.map((l) => [l.weight.value, l.affine.scale.value])
    back.forEach(([w, s], i) => {
      expect(w).toBeCloseTo(there[i][0], 9)
      expect(s).toBeCloseTo(there[i][1], 9)
    })
  })
})
