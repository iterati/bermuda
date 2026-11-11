import { describe, expect, it } from 'vitest'
import { alignedNesting, setLattice } from './edit'
import { level, mod, scene } from './looks'
import { update } from './motion'
import { LATTICES, parseScene, resolve } from './scene'

const HEX: [number, number] = [0.5, Math.sqrt(3) / 2]
const two = (child: Parameters<typeof level>[1], parent: Parameters<typeof level>[1] = {}) =>
  scene({ name: 'test', levels: [level('a', parent), level('b', child)] })

describe('lattice kinds', () => {
  it.each(LATTICES)('a level set to %s round-trips through the parse', (kind) => {
    const s = update(two({}), (d) => setLattice(d, 'b', kind))
    expect(s.levels[1].lattice.kind).toBe(kind)
    expect(parseScene(JSON.stringify(s))).toEqual(s)
  })

  it('a voronoi level gets its jitter and drops it, with the modulator target on it, when it leaves', () => {
    const s = update(two({}), (d) => {
      setLattice(d, 'b', 'voronoi')
      d.modulators.push(mod('m', 'cos', 8, [['levels[b].lattice.jitter', 0.2]]))
    })
    expect(resolve(s, 'levels[b].lattice.jitter')?.value).toBe(0)
    const back = update(s, (d) => setLattice(d, 'b', 'oblique'))
    expect(back.levels[1].lattice.jitter).toBeUndefined()
    expect(back.modulators[0].targets).toEqual([])
  })

  it('polar keeps its sectors on the way to logpolar, and drops them on the way out', () => {
    const s = update(two({}), (d) => setLattice(d, 'b', 'polar'))
    expect(s.levels[1].lattice.sectors).toBe(6)
    const log = update(s, (d) => {
      d.levels[1].lattice.sectors = 9
      setLattice(d, 'b', 'logpolar')
    })
    expect(log.levels[1].lattice.sectors).toBe(9)
    expect(update(log, (d) => setLattice(d, 'b', 'fold')).levels[1].lattice.sectors).toBeUndefined()
  })
})

describe('snap to aligned nestings', () => {
  const nest = (child: Parameters<typeof level>[1], parent: Parameters<typeof level>[1] = {}) =>
    alignedNesting(two(child, parent), 'b')

  it('finds the nearest nesting of squares in squares: √2 at 45°, 2 at 0°', () => {
    const near45 = nest({ scale: 1.5, turn: 40 })!
    expect(near45.scale).toBeCloseTo(Math.SQRT2)
    expect(near45.turn).toBeCloseTo(45)
    const near0 = nest({ scale: 1.8, turn: 5 })!
    expect(near0.scale).toBeCloseTo(2)
    expect(near0.turn).toBeCloseTo(0)
  })

  it("finds hexes' √3 at 30° and its turns by 60°, the one nearest the level's turn", () => {
    const s = nest({ scale: 1.6, turn: 325, e2: HEX }, { e2: HEX })!
    expect(s.scale).toBeCloseTo(Math.sqrt(3))
    expect(s.turn).toBeCloseTo(330)
  })

  it("takes the parent's one-way cell turn off the level's turn", () => {
    const s = nest({ scale: 1.5, turn: 40 }, { cellTurn: 15 })!
    expect(s.scale).toBeCloseTo(Math.SQRT2)
    expect(s.turn).toBeCloseTo(30)
  })

  it('finds a triangle level its nesting under an oblique parent', () => {
    expect(nest({ scale: 1.6, turn: 25, e2: HEX, lattice: 'triangle' }, { e2: HEX })?.turn).toBeCloseTo(30)
  })

  it('finds none where the cells cannot line up', () => {
    expect(nest({ scale: 1.6, turn: 10 }, { e2: HEX }), 'a square under a hex').toBeUndefined()
    expect(alignedNesting(two({}), 'a'), 'the first level').toBeUndefined()
    expect(nest({ scale: 1.5 }, { lattice: 'fold' }), 'under a fold').toBeUndefined()
    expect(nest({ scale: 1.5 }, { lattice: 'triangle' }), "under a triangle's two halves").toBeUndefined()
    expect(nest({ scale: 1.5 }, { lattice: 'voronoi', jitter: 0.3 }), 'under jittered seeds').toBeUndefined()
    expect(nest({ scale: 1.5 }, { by: 'parity', cellTurn: 15 }), 'under cells turned two ways').toBeUndefined()
  })

  it('finds one under unjittered seeds and under cells told to turn two ways by 0°', () => {
    expect(nest({ scale: 1.5, turn: 40 }, { lattice: 'voronoi', jitter: 0 })?.turn).toBeCloseTo(45)
    expect(nest({ scale: 1.5, turn: 40 }, { by: 'hash' })?.turn).toBeCloseTo(45)
  })
})
