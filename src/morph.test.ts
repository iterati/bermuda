import { describe, expect, it } from 'vitest'
import { paletteAt } from './colour'
import { background, fill, halftone, join, level, LOOKS, scene, shape, star } from './looks'
import { depthWindow, morph, smooth } from './morph'
import type { Edge, Scene } from './scene'

const together: Edge = { seconds: 2, stagger: 0, deepFirst: false }
const full = (a: Scene, b: Scene, x: number, edge = together) => morph(a, b, x, edge, { drift: 0, colour: 0, crawl: 0 })
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

  it("swaps a shape's kind inside a circle dip, the star taking the other side's form", () => {
    const a = scene({ name: 'a', levels: [level('s', { shape: star(6, 2, 0.4) })] })
    const b = scene({ name: 'b', levels: [level('s', { shape: shape('moon', 0.4, 0.8) })] })
    const shapeAt = (x: number) => at(a, b, x).levels[0].variants[0].shape
    expect(shapeAt(0.05)).toMatchObject({ form: { value: 0.8 } })
    expect(shapeAt(0.05).kind).toBeUndefined()
    expect(shapeAt(0.05).round.value).toBeLessThan(0.1)
    expect(shapeAt(0.45)).toMatchObject({ round: { value: 1 } })
    expect(shapeAt(0.45).kind).toBeUndefined()
    expect(shapeAt(0.55)).toMatchObject({ kind: 'moon', round: { value: 1 } })
    expect(shapeAt(1)).toMatchObject({ kind: 'moon', round: { value: 0 }, form: { value: 0.8 } })
  })

  it('grows what one side lacks from what draws as if it were not there: a join, corner, onion, spill, dots', () => {
    const a = scene({ name: 'a', levels: [level('s', { shape: star(6, 2, 0.4) })] })
    const b = scene({
      name: 'b',
      levels: [
        level('s', {
          spill: 1,
          shape: star(6, 2, 0.4, { corner: 0.1, onion: 0.04, join: join(star(5, 2, 0.2), [0.2, 0], 0.1) }),
        }),
      ],
      line: 'dots',
      dots: { count: 20, size: 0.5, crawl: 2 },
    })
    const mid = at(a, b, 0.5)
    const s = mid.levels[0].variants[0].shape
    expect(s.corner!.value).toBeCloseTo(0.05, 9)
    expect(s.onion!.value).toBeCloseTo(0.02, 9)
    expect(s.join).toMatchObject({
      weight: { value: 0.5 },
      blend: { value: 0.1 },
      offset: [{ value: 0.2 }, { value: 0 }],
    })
    expect(mid.levels[0].cell.spill!.value).toBe(0.5)
    // the side without dots does not draw them, so the knobs keep the other side's
    expect(mid.line.dots).toEqual({ count: { value: 20 }, size: { value: 0.5 }, crawl: { value: 2 } })
    expect(full(a, b, 0.5).toward.line).toBe('dots')
    const none = at(a, a, 0.5)
    expect(none.levels[0].variants[0].shape).toEqual(a.levels[0].variants[0].shape)
    expect(none.levels[0].cell.spill).toBeUndefined()
    expect(none.line.dots).toBeUndefined()
  })

  it('grows a fill one side lacks from fill 0 and line 1, and swaps front inside a dip of its spill', () => {
    const lines = scene({ name: 'a', levels: [level('s', { spill: 1 })] })
    const metal = fill({ bands: 10, step: 0.08, metal: 1, shade: 0.42, light: 115, ramp: 0.2 })
    const filled = scene({ name: 'b', levels: [level('s', { spill: 1, fill: metal })] })
    expect(at(lines, filled, 0.25).levels[0].fill).toEqual({
      amount: { value: 0.25 },
      line: { value: 0.75 },
      tone: { value: 0 },
      bands: { value: 2.5 },
      step: { value: 0.02 },
      metal: { value: 0.25 },
      light: { value: 115 },
      shade: { value: 0.42 },
      ramp: { value: 0.05 },
      alternate: { value: 0 },
    })
    expect(at(filled, lines, 1).levels[0].fill).toMatchObject({ amount: { value: 0 }, line: { value: 1 } })
    expect(at(lines, lines, 0.5).levels[0].fill).toBeUndefined()
    const front = scene({ name: 'c', levels: [level('s', { spill: 1, fill: fill({ amount: 0.8, front: true }) })] })
    const flat = scene({ name: 'd', levels: [level('s', { spill: 1, fill: fill({ amount: 0.8 }) })] })
    expect(at(flat, front, 0.49).levels[0].fill!.front).toBeUndefined()
    // the paint stays: a lone level's picture never goes, only its overlaps fold back into each cell's own shape
    expect(at(flat, front, 0.5).levels[0]).toMatchObject({ fill: { front: true, amount: { value: 0.8 } } })
    expect(at(flat, front, 0.5).levels[0].cell.spill!.value).toBe(0)
    expect(at(flat, front, 0.2).levels[0].cell.spill!.value).toBeGreaterThan(0)
    expect(at(flat, front, 1).levels[0]).toEqual(front.levels[0])
    expect(at(front, front, 0.5).levels[0].cell.spill!.value).toBe(1)
  })

  it('grows a halftone one side lacks from amount 0, and swaps its grid inside a dip of its amount', () => {
    const lines = scene({ name: 'a', levels: [level('s')] })
    const dots = halftone({ amount: 0.8, pitch: 12, size: 1.1, fade: 0.4, turn: 30, reach: 0.1 })
    const dotted = scene({ name: 'b', levels: [level('s', { halftone: dots })] })
    expect(at(lines, dotted, 0.25).levels[0].halftone).toEqual({ ...dots, amount: { value: 0.2 } })
    expect(at(dotted, lines, 1).levels[0].halftone).toEqual({ ...dots, amount: { value: 0 } })
    expect(at(lines, lines, 0.5).levels[0].halftone).toBeUndefined()
    // a lattice into a hex screen: the grid swaps at the middle, where the amount is gone, and lands on B
    const hex = scene({ name: 'c', levels: [level('s', { halftone: { ...dots, grid: 'hex', pitch: { value: 60 } } })] })
    expect(at(dotted, hex, 0.49).levels[0].halftone).toMatchObject({ grid: 'lattice' })
    expect(at(dotted, hex, 0.5).levels[0].halftone).toMatchObject({ grid: 'hex', amount: { value: 0 } })
    expect(at(dotted, hex, 0.5).levels[0].halftone!.pitch.value).toBe(36)
    expect(at(dotted, hex, 0.2).levels[0].halftone!.amount.value).toBeGreaterThan(0)
    expect(at(dotted, hex, 1).levels[0]).toEqual(hex.levels[0])
    expect(at(hex, hex, 0.5).levels[0].halftone!.amount.value).toBe(0.8)
    // a link group's spread on amount dips with it
    const spread = (h: typeof dots) => ({ ...h, amount: { value: 0, spread: 4 } })
    const spreadAt = (t: number) =>
      at(
        scene({ name: 'a', levels: [level('s', { halftone: spread(dots) })] }),
        scene({ name: 'b', levels: [level('s', { halftone: spread({ ...dots, grid: 'hex' }) })] }),
        t,
      ).levels[0].halftone!.amount
    expect(spreadAt(0.5)).toEqual({ value: 0, spread: 0 })
    expect(spreadAt(0)).toEqual({ value: 0, spread: 4 })
  })

  it('drops spill where the lattice swaps into one that cannot spill', () => {
    const a = scene({ name: 'a', levels: [level('s', { spill: 1 })] })
    const b = scene({ name: 'b', levels: [level('s', { lattice: 'polar', sectors: 6 })] })
    expect(at(a, b, 0.45).levels[0].cell.spill!.value).toBeCloseTo(0.55, 9)
    expect(at(a, b, 0.55).levels[0].cell.spill).toBeUndefined()
  })

  it('swaps parity where the cells do not turn', () => {
    const a = scene({ name: 'a', levels: [level('c', { cellTurn: 30 })] })
    const b = scene({ name: 'b', levels: [level('c', { by: 'parity', cellTurn: 30 })] })
    expect(at(a, b, 0.45).levels[0].cell).toMatchObject({ by: 'none', turn: { value: 0 } })
    expect(at(a, b, 0.55).levels[0].cell).toMatchObject({ by: 'parity', turn: { value: 0 } })
    expect(at(a, b, 1).levels[0].cell.turn.value).toBe(30)
  })

  it('swaps a mirror where the level weighs nothing, and ring where its cells neither turn nor shift', () => {
    const a = scene({ name: 'a', levels: [level('c', { cellTurn: 20 }), level('d')] })
    const mirror = scene({ name: 'b', levels: [level('c', { by: 'mirror', cellTurn: 20 }), level('d')] })
    expect(at(a, mirror, 0.47).levels[0]).toMatchObject({ cell: { by: 'none' }, weight: { value: 0 } })
    expect(at(a, mirror, 0.53).levels[0]).toMatchObject({ cell: { by: 'mirror' }, weight: { value: 0 } })
    expect(at(a, mirror, 1).levels[0].weight.value).toBe(1)
    const ring = scene({ name: 'b', levels: [level('c', { by: 'ring', cellTurn: 20, cellPhase: 0.2 }), level('d')] })
    expect(at(a, ring, 0.55).levels[0]).toMatchObject({
      cell: { by: 'ring', turn: { value: 0 } },
      weight: { value: 1 },
    })
  })

  it('morphs an orbit trap one side lacks from weight 0', () => {
    const a = scene({ name: 'a', levels: [level('l')] })
    const b = scene({ name: 'b', levels: [level('l')], trap: { weight: 2, size: 0.3 } })
    expect(at(a, b, 0.25).palette.trap).toEqual({ weight: { value: 0.5 }, size: { value: 0.3 } })
    expect(at(b, a, 0.25).palette.trap).toEqual({ weight: { value: 1.5 }, size: { value: 0.3 } })
    expect(at(a, a, 0.5).palette.trap).toBeUndefined()
  })

  it('grows a palette field one side lacks from depth 0, and swaps its kind inside a dip of its depth', () => {
    const none = scene({ name: 'a', levels: [level('l')] })
    const field = (kind: 'radial' | 'linear' | 'noise', depth: number, more = {}) =>
      scene({
        name: kind,
        levels: [level('l')],
        field: {
          kind,
          angle: { value: 30 },
          centre: [{ value: 1 }, { value: -1 }],
          scale: { value: 0.7 },
          depth: { value: depth },
          ...more,
        },
      })
    const radial = field('radial', 0.4)
    expect(at(none, radial, 0.25).palette.field).toEqual({
      kind: 'radial',
      angle: { value: 30 },
      centre: [{ value: 0.25 }, { value: -0.25 }],
      scale: { value: 0.7 },
      depth: { value: 0.1 },
    })
    expect(at(radial, none, 1).palette.field).toMatchObject({
      kind: 'radial',
      centre: [{ value: 0 }, { value: 0 }],
      depth: { value: 0 },
    })
    expect(at(none, none, 0.5).palette.field).toBeUndefined()
    // a kind, steps or cells one side lacks swaps where the depth dips to nothing
    const noise = field('noise', 0.75, { steps: 4, atCells: true })
    expect(at(radial, noise, 0.49).palette.field).toMatchObject({ kind: 'radial' })
    expect(at(radial, noise, 0.49).palette.field!.steps).toBeUndefined()
    expect(at(radial, noise, 0.5).palette.field).toMatchObject({
      kind: 'noise',
      steps: 4,
      atCells: true,
      depth: { value: 0 },
    })
    expect(at(radial, noise, 0.2).palette.field!.depth.value).toBeGreaterThan(0)
    expect(at(none, noise, 1).palette.field).toEqual(noise.palette.field)
    expect(at(field('noise', 0.75, { steps: 2 }), noise, 0.5).palette.field!.depth.value).toBe(0)
    expect(at(noise, noise, 0.5).palette.field!.depth.value).toBe(0.75)
  })

  it('morphs oblique into voronoi by its jitter, and swaps another lattice kind where the level weighs nothing', () => {
    const square = scene({ name: 'a', levels: [level('l')] })
    const organic = scene({ name: 'b', levels: [level('l', { lattice: 'voronoi', jitter: 0.8 })] })
    expect(at(square, organic, 0).levels[0].lattice).toMatchObject({ kind: 'voronoi', jitter: { value: 0 } })
    expect(at(square, organic, 0.5).levels[0].lattice).toMatchObject({ kind: 'voronoi', jitter: { value: 0.4 } })
    expect(at(square, organic, 0.5).levels[0].weight.value).toBe(1)
    expect(at(square, organic, 1).levels[0].lattice.jitter?.value).toBeCloseTo(0.8)
    const polar = scene({ name: 'a', levels: [level('l', { lattice: 'polar', sectors: 8 }), level('m')] })
    const brick = scene({ name: 'b', levels: [level('l', { lattice: 'brick' }), level('m')] })
    const lattice = (x: number) => at(polar, brick, x).levels[0]
    expect(lattice(0)).toMatchObject({ lattice: { kind: 'polar', sectors: 8 }, weight: { value: 1 } })
    expect(lattice(0.47)).toMatchObject({ lattice: { kind: 'polar' }, weight: { value: 0 } })
    expect(lattice(0.53).lattice).toEqual({ kind: 'brick', e2: expect.anything() })
    expect(lattice(0.53).weight.value).toBe(0)
    expect(lattice(1).weight.value).toBe(1)
  })

  it("crossfades the scene's one drawn level through a swap from A's switches to B's, its weight whole", () => {
    const square = scene({ name: 'a', levels: [level('l', { spill: 1 })] })
    const polar = scene({ name: 'b', levels: [level('l', { lattice: 'polar', sectors: 6, by: 'mirror' })] })
    const there = full(square, polar, 0.3)
    const [near, far] = [there.scene.levels[0], there.toward.cross!.levels[0]]
    expect(near).toMatchObject({ lattice: { kind: 'oblique' }, cell: { by: 'none' }, weight: { value: 1 } })
    expect(near.cell.spill!.value).toBeCloseTo(0.7, 9)
    expect(far).toMatchObject({ lattice: { kind: 'polar', sectors: 6 }, cell: { by: 'mirror' }, weight: { value: 1 } })
    expect(far.cell.spill).toBeUndefined()
    expect(there.toward.cross!.at).toBeCloseTo(smooth(0, 1, 0.3), 9)
    // the far side's picture is the same knobs, so a bend of the scene bends it too
    for (const key of ['weight', 'affine', 'variants', 'colour'] as const) expect(far[key]).toBe(near[key])
    expect(far.lattice.e2).toBe(near.lattice.e2)
    const back = full(square, polar, 0.7)
    expect(back.scene.levels[0]).toMatchObject({ lattice: { kind: 'polar', sectors: 6 }, weight: { value: 1 } })
    expect(back.toward.cross!.levels[0].lattice).toEqual({ kind: 'oblique', e2: expect.anything() })
    expect(back.toward.cross!.at).toBeCloseTo(smooth(0, 1, 0.3), 9)
    expect([0, 1].map((x) => full(square, polar, x).toward.cross!.at)).toEqual([0, 0])
    // with another level drawn the swap dips as before, and nothing crossfades
    const two = (s: Scene) => ({ ...s, levels: [...s.levels, level('m')] })
    expect(full(two(square), two(polar), 0.5).toward.cross).toBeUndefined()
    expect(full(two(square), two(polar), 0.5).scene.levels[0].weight.value).toBe(0)
    expect(full(square, square, 0.5).toward.cross).toBeUndefined()
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

describe('a background', () => {
  const look = (name: string) => LOOKS.find((l) => l.name.startsWith(name))!
  const soaked = { ...look('Tapestry 1 '), background: background('soak', 0.8) }

  it('one side lacks fades out from the other side at amount 0, and is gone at the far end', () => {
    const none = look('Tapestry 7 ')
    let last = Infinity
    for (let x = 0; x <= 1; x += 0.125) {
      const bg = at(soaked, none, x).background!
      expect(bg.kind).toBe('soak')
      expect(bg.amount.value).toBeCloseTo(0.8 * (1 - x), 9)
      expect(bg.amount.value).toBeLessThan(last)
      last = bg.amount.value
    }
    expect(at(soaked, none, 1).background!.amount.value).toBe(0)
    expect(at(none, look('Tapestry 4'), 0.5).background).toBeUndefined()
  })

  it('swaps its kind at the middle, where its amount dips to nothing', () => {
    const flat = { ...look('Tapestry 1 '), background: background('flat', 0.4) }
    expect(at(flat, soaked, 0.49).background!.kind).toBe('flat')
    expect(at(flat, soaked, 0.5).background).toMatchObject({ kind: 'soak', amount: { value: 0 } })
    expect(at(flat, soaked, 0.2).background!.amount.value).toBeGreaterThan(0)
  })

  it("is A's at 0 and B's at 1, every knob", () => {
    const a = { ...look('Tapestry 1 '), background: background('gradient', 0.3, [0.1, 0.9]) }
    const b = { ...look('Tapestry 7 '), background: { ...background('soak', 0.7, [0.4, 0.2]), seep: { value: 0.6 } } }
    expect(at(a, b, 0).background).toEqual(a.background)
    expect(at(a, b, 1).background).toEqual(b.background)
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
