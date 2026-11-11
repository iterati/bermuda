import { describe, expect, it } from 'vitest'
import { BANK, level, LOOKS, scene, star } from './looks'
import { morph, smooth } from './morph'
import { advance, newLive } from './motion'
import {
  bend,
  bendOf,
  entryScene,
  mutate,
  neighbours,
  NUDGE,
  playable,
  pruneBank,
  step,
  tangent,
  toggleLink,
  valuesOf,
  type Keyframe,
} from './play'
import { knobsOf, playRange, resolve, type Bank, type Edge, type Scene } from './scene'

// a seeded random, so a walk is the same each run
function seeded(seed: number) {
  let s = seed
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0
    return s / 2 ** 32
  }
}
const withAuto = (part: Partial<Bank['autopilot']>): Bank => ({ ...BANK, autopilot: { ...BANK.autopilot, ...part } })
const start = (entry: string): Keyframe => ({ entry, scene: entryScene(LOOKS, entry)! })

// every knob of b that differs from a, with its play range in a
function moved(a: Scene, b: Scene) {
  return knobsOf(b).flatMap(({ address, knob }) => {
    const before = resolve(a, address)!
    return before.value === knob.value ? [] : [{ address, value: knob.value, range: playRange(address, before) }]
  })
}

describe('the bank', () => {
  it('names a look or one of its presets', () => {
    expect(BANK.scenes.every((s) => entryScene(LOOKS, s))).toBe(true)
    const ice = entryScene(LOOKS, 'Tapestry 7 - Hexes / Ice')!
    expect(ice.name).toBe('Tapestry 7 - Hexes')
    expect(ice.palette.stops).not.toEqual(LOOKS.find((l) => l.name === ice.name)!.palette.stops)
    expect(entryScene(LOOKS, 'Tapestry 7 - Hexes / Nope')).toBeUndefined()
  })

  it('drops the entries that name no look, and their links', () => {
    const looks = LOOKS.filter((l) => !l.name.startsWith('Tapestry 7 '))
    const kept = pruneBank(BANK, looks)
    expect(kept.scenes.some((s) => s.startsWith('Tapestry 7 '))).toBe(false)
    expect(kept.links.every((l) => l.every((s) => kept.scenes.includes(s)))).toBe(true)
    expect(kept.scenes.length).toBe(BANK.scenes.length - 3)
  })

  it('links two entries either way round, and a second toggle unlinks them', () => {
    const [a, b] = ['Tapestry 1 - Rainbow hex rings', 'Tapestry 6 - Coloured layers']
    const linked = toggleLink(BANK, b, a)
    expect(neighbours(linked, a)).toContain(b)
    expect(toggleLink(linked, a, b).links).toEqual(BANK.links)
  })
})

describe('the autopilot', () => {
  it('every look has something it may move', () => {
    for (const look of LOOKS) {
      const { knobs, macros } = playable(look)
      expect(knobs.length + macros.length, look.name).toBeGreaterThan(0)
    }
  })

  it.each(BANK.scenes)('keeps every knob it moves inside its play range, from %s', (entry) => {
    const random = seeded(entry.length * 7919)
    const bank = withAuto({ busy: 1, change: 0 })
    let at = start(entry)
    for (let i = 0; i < 12; i++) {
      const next = step(bank, LOOKS, at, random)!
      expect(next.scene.name).toBe(at.scene.name)
      for (const m of moved(at.scene, next.scene))
        expect(m.value, m.address).toSatisfy((v: number) => v >= m.range[0] && v <= m.range[1])
      at = next
    }
  })

  it('moves only a share of a look as busy says', () => {
    const at = start('Tapestry 7 - Hexes')
    const few = step(withAuto({ busy: 0.2, change: 0 }), LOOKS, { ...at, scene: { ...at.scene, presets: [] } })!
    const all = step(withAuto({ busy: 1, change: 0 }), LOOKS, { ...at, scene: { ...at.scene, presets: [] } })!
    expect(moved(at.scene, few.scene).length).toBe(1)
    expect(moved(at.scene, all.scene).length).toBe(2)
  })

  it("is at a preset's entry once it plays that preset", () => {
    const bank = withAuto({ busy: 0, change: 0 })
    for (let i = 0; i < 8; i++) {
      const next = step(bank, LOOKS, start('Tapestry 7 - Hexes'), seeded(i))!
      const preset = next.scene.presets[next.preset!]
      expect(next.entry).toBe(`Tapestry 7 - Hexes / ${preset.name}`)
      expect(next.scene).toEqual(entryScene(LOOKS, next.entry!))
    }
  })

  it('walks along the links, and wanders off them as wander says', () => {
    const random = seeded(3)
    let at = start(BANK.scenes[0])
    for (let i = 0; i < 40; i++) {
      const next = step(withAuto({ change: 1, wander: 0 }), LOOKS, at, random)!
      expect(neighbours(BANK, at.entry!)).toContain(next.entry)
      expect(next.scene).toEqual(entryScene(LOOKS, next.entry!))
      at = next
    }
    const off = Array.from({ length: 40 }, () => step(withAuto({ change: 1, wander: 1 }), LOOKS, at, random)!.entry)
    expect(off.some((e) => !neighbours(BANK, at.entry!).includes(e!))).toBe(true)
  })

  it('leaves an entry with no links only by wandering, else plays inside its look, else has nowhere to go', () => {
    const lone: Bank = { ...withAuto({ change: 1, wander: 0 }), links: [] }
    const entry = BANK.scenes[0]
    expect(step(lone, LOOKS, start(entry))!.entry).toBe(entry)
    expect(step({ ...lone, autopilot: { ...lone.autopilot, wander: 1 } }, LOOKS, start(entry))!.entry).not.toBe(entry)
    const bare = scene({ name: 'bare', levels: [level('a', { shape: star(6, 2, 0.4) })] })
    expect(step(lone, LOOKS, { entry, scene: bare })).toBeUndefined()
  })
})

describe('mutate', () => {
  it.each(LOOKS.map((l) => l.name))(
    'keeps every knob inside its play range and moves only the playable, %s',
    (name) => {
      const look = LOOKS.find((l) => l.name === name)!
      const random = seeded(name.length * 104729)
      const { knobs, macros } = playable(look)
      const free = new Set(knobs.map((k) => k.address))
      const driven = new Set(macros.flatMap((m) => m.targets.map((t) => t.knob)))
      let at = look
      let changed = 0
      for (let i = 0; i < 20; i++) {
        const next = mutate(at, random)
        for (const m of moved(at, next)) {
          expect(m.value, m.address).toSatisfy((v: number) => v >= m.range[0] && v <= m.range[1])
          expect(free.has(m.address) || driven.has(m.address), `${m.address} has no play range`).toBe(true)
          if (!driven.has(m.address))
            expect(Math.abs(m.value - resolve(at, m.address)!.value), m.address).toBeLessThanOrEqual(
              NUDGE * (m.range[1] - m.range[0]) + 1e-9,
            )
          changed++
        }
        for (const m of next.macros) expect(m.value).toSatisfy((v: number) => v >= 0 && v <= 1)
        at = next
      }
      expect(changed).toBeGreaterThan(0)
    },
  )
})

describe('the curve a transition runs on', () => {
  const edge: Edge = { seconds: 2, stagger: 0, deepFirst: false }
  const key = (scale: number) =>
    scene({ name: 'k', levels: [level('a', { scale: { value: scale, play: [1, 3] }, shape: star(6, 2, 0.4) })] })
  const [k0, k1, k2, k3] = [key(1), key(1.4), key(2.6), key(3)]
  // the scale drawn t of the way from k1 to k2, the tangents Catmull-Rom's
  const drawn =
    (m1 = tangent(valuesOf(k0), valuesOf(k2)), m2 = tangent(valuesOf(k1), valuesOf(k3))) =>
    (t: number) => {
      const [a, b] = [advance(k1, newLive(), 0, 60), advance(k2, newLive(), 0, 60)]
      const { scene } = morph(a, b, smooth(0, 1, t), edge, newLive())
      bend(scene, bendOf(k1, k2, m1, m2), t)
      return scene.levels[0].affine.scale.value
    }

  it('passes through both keyframes', () => {
    expect(drawn()(0)).toBeCloseTo(1.4)
    expect(drawn()(1)).toBeCloseTo(2.6)
  })

  it('leaves and lands with the Catmull-Rom tangents, so a curve through keyframes has no corner', () => {
    const f = drawn()
    const d = 1e-4
    expect((f(d) - f(0)) / d).toBeCloseTo((2.6 - 1) / 2, 2)
    expect((f(1) - f(1 - d)) / d).toBeCloseTo((3 - 1.4) / 2, 2)
  })

  it('eases in and out where it rests, with no tangents', () => {
    const f = drawn(new Map(), new Map())
    expect(f(0.5)).toBeCloseTo(2)
    expect((f(1e-4) - f(0)) / 1e-4).toBeCloseTo(0, 2)
  })

  it('keeps to the play range where the curve would overshoot it', () => {
    const f = drawn(new Map([['levels[a].affine.scale', 12]]), new Map())
    for (let t = 0; t <= 1; t += 0.05) expect(f(t)).toBeLessThanOrEqual(3)
    expect(Math.max(...[0.2, 0.4, 0.6].map(f))).toBe(3)
  })

  it("keeps an end with no play range to its value there, not its kind's hard range", () => {
    const free = scene({ name: 'k', levels: [level('a', { scale: 2, shape: star(6, 2, 0.4) })] })
    const m = new Map([['levels[a].affine.scale', 1]])
    expect(bendOf(k1, free, m, m).range.get('levels[a].affine.scale')).toEqual([1, 3])
    expect(bendOf(free, key(2.5), m, m).range.get('levels[a].affine.scale')).toEqual([1, 3])
    expect(bendOf(free, free, m, m).range.get('levels[a].affine.scale')).toEqual([2, 2])
  })
})
