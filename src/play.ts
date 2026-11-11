// Play: the bank's entries, the autopilot's walk of the bank as a graph, and the curve a timed transition runs on. A transition is the fader run from one end to the other with the next keyframe loaded on the far side;
// back to back, transitions pass through their keyframes on a Catmull-Rom curve.
import { advance, applyPreset, newLive, setMacro, update } from './motion'
import {
  clamp,
  knobsOf,
  playRange,
  resolve,
  type Address,
  type Bank,
  type Knob,
  type KnobAt,
  type Macro,
  type Scene,
} from './scene'

// what Play loads: a scene, the bank entry it came from, if any (an autopilot move inside a look keeps it), and
// the look's preset it is, if one
export type Keyframe = { entry?: string; scene: Scene; preset?: number }

export const entryName = (look: string, preset?: string) => (preset === undefined ? look : `${look} / ${preset}`)

// The scene a bank entry names among the looks: the look, or the look with its preset applied.
export function entryScene(looks: Scene[], entry: string): Scene | undefined {
  const look = looks.find((l) => l.name === entry)
  if (look) return structuredClone(look)
  for (const l of looks) {
    const preset = l.presets.find((p) => entryName(l.name, p.name) === entry)
    if (preset) return applyPreset(l, preset)
  }
}

// The bank without the entries that name nothing among the looks, and their links.
export function pruneBank(bank: Bank, looks: Scene[]): Bank {
  const scenes = bank.scenes.filter((s) => entryScene(looks, s))
  return { ...bank, scenes, links: bank.links.filter((l) => l.every((s) => scenes.includes(s))) }
}

export const neighbours = (bank: Bank, entry: string) =>
  bank.links.flatMap(([a, b]) => (a === entry ? [b] : b === entry ? [a] : []))

// The bank with the link between two entries made, or taken away if it was there.
export function toggleLink(bank: Bank, a: string, b: string): Bank {
  const has = (l: [string, string]) => (l[0] === a && l[1] === b) || (l[0] === b && l[1] === a)
  const links = bank.links.some(has) ? bank.links.filter((l) => !has(l)) : [...bank.links, [a, b] as [string, string]]
  return { ...bank, links }
}

// What the autopilot may move inside a look: the knobs with play ranges (a linked level's are its leader's) and
// the macros, which keep their knobs to their play ranges.
export function playable(scene: Scene): { knobs: KnobAt[]; macros: Macro[] } {
  return { knobs: knobsOf(scene).filter((k) => k.knob.play && !k.level?.level.link), macros: scene.macros }
}

// The autopilot's next keyframe from where it is, or undefined when it has nowhere to go. Change is the chance it
// leaves the look for another entry; wander the chance a leave strays off the links to any entry (an entry with no
// links is left only that way, and from a look not in the bank every entry is next to it). Inside the look it plays
// one of its presets or not, and busy is the share of its playable knobs and macros it sets afresh in their play
// ranges.
export function step(bank: Bank, looks: Scene[], at: Keyframe, random = Math.random): Keyframe | undefined {
  const { busy, change, wander } = bank.autopilot
  const pick = <T>(xs: T[]) => xs[Math.floor(random() * xs.length)]
  const moves = playable(at.scene)
  const movable = busy > 0 ? moves.knobs.length + moves.macros.length : 0
  const leave = () => {
    const others = bank.scenes.filter((s) => s !== at.entry && entryScene(looks, s))
    const linked =
      at.entry && bank.scenes.includes(at.entry) ? neighbours(bank, at.entry).filter((s) => others.includes(s)) : others
    const next = pick(random() < wander ? others : linked)
    if (next === undefined) return undefined
    const scene = entryScene(looks, next)!
    const preset = scene.presets.findIndex((p) => entryName(scene.name, p.name) === next)
    return preset < 0 ? { entry: next, scene } : { entry: next, scene, preset }
  }
  // it plays inside the look where it cannot leave
  if (random() < change || (!movable && !at.scene.presets.length)) {
    const left = leave()
    if (left || (!movable && !at.scene.presets.length)) return left
  }
  let scene = at.scene
  let entry = at.entry
  let preset: number | undefined
  if (at.scene.presets.length && (!movable || random() < 0.5)) {
    preset = Math.floor(random() * at.scene.presets.length)
    scene = applyPreset(scene, at.scene.presets[preset])
    // it is at the preset's entry now, else the look's, if the bank holds one
    entry =
      [entryName(scene.name, scene.presets[preset].name), scene.name].find((e) => bank.scenes.includes(e)) ?? entry
  }
  const all = [...moves.knobs.map((k) => k.address), ...moves.macros.map((m) => m.id)]
  const chosen = new Set<string>()
  while (chosen.size < (movable && Math.max(1, Math.round(busy * movable))))
    chosen.add(pick(all.filter((x) => !chosen.has(x))))
  scene = update(scene, (d) => {
    for (const x of chosen) {
      const knob = resolve(d, x)
      if (knob) {
        const [lo, hi] = playRange(x, knob)
        knob.value = lo + random() * (hi - lo)
      } else setMacro(d, x, random())
    }
  })
  return preset === undefined || chosen.size ? { entry, scene } : { entry, scene, preset }
}

// How far Mutate nudges at most: this share of a knob's play range, or of a macro's travel.
export const NUDGE = 0.25

// Mutate: every knob the look gives a play range (playable) nudged at random by up to NUDGE of that range either
// way, bounced back inside it at its ends, and every macro by up to NUDGE of its travel; a knob a macro drives
// moves with the macro alone.
export function mutate(scene: Scene, random = Math.random): Scene {
  const { knobs, macros } = playable(scene)
  const driven = new Set(macros.flatMap((m) => m.targets.map((t) => t.knob)))
  const nudge = (v: number, [lo, hi]: [number, number]) => {
    const x = v + (2 * random() - 1) * NUDGE * (hi - lo)
    return clamp(x > hi ? 2 * hi - x : x < lo ? 2 * lo - x : x, [lo, hi])
  }
  return update(scene, (d) => {
    for (const m of macros) setMacro(d, m.id, nudge(m.value, [0, 1]))
    for (const { address } of knobs) {
      if (driven.has(address)) continue
      const knob = resolve(d, address)!
      knob.value = nudge(knob.value, knob.play!)
    }
  })
}

// Every knob's value as the scene plays it before its modulators: a linked level's from its leader, with the spread.
export const valuesOf = (scene: Scene): Map<Address, number> =>
  new Map(knobsOf(advance({ ...scene, modulators: [] }, newLive(), 0, 60)).map((k) => [k.address, k.knob.value]))

// The Catmull-Rom tangent at a keyframe between the one before it and the one after, for the knobs all hold but
// the stops and the rings, which the morph runs its own way (round the hue wheel the short way; in the shader).
export function tangent(before: Map<Address, number>, after: Map<Address, number>): Map<Address, number> {
  const out = new Map<Address, number>()
  for (const [address, b] of before) {
    if (address.startsWith('palette.stops') || address === 'contour.rings') continue
    const a = after.get(address)
    if (a !== undefined && a !== b) out.set(address, (a - b) / 2)
  }
  return out
}

// A transition's curve: the tangents at its two keyframes, and the range each knob keeps to on it: its play
// ranges at the two ends together, where an end with no play range gives only its value there.
export type Bend = { from: Map<Address, number>; to: Map<Address, number>; range: Map<Address, [number, number]> }

export function bendOf(from: Scene, to: Scene, m1: Map<Address, number>, m2: Map<Address, number>): Bend {
  const span = (k: Knob): [number, number] => k.play ?? [k.value, k.value]
  const ends = new Map(knobsOf(to).map((k) => [k.address, span(k.knob)]))
  const range = new Map<Address, [number, number]>()
  for (const { address, knob } of knobsOf(from)) {
    const other = ends.get(address)
    if (!other || !(m1.has(address) || m2.has(address))) continue
    const own = span(knob)
    range.set(address, [Math.min(own[0], other[0]), Math.max(own[1], other[1])])
  }
  return { from: m1, to: m2, range }
}

// Bend the morph's scene t of the way through its transition (on the scene, in place): with the fader at the
// smoothstep of t the morph is the straight part of a cubic Hermite, and the tangents add the rest, kept to the
// knob's range.
export function bend(scene: Scene, b: Bend, t: number) {
  const h10 = t * (1 - t) * (1 - t)
  const h11 = t * t * (t - 1)
  for (const { address, knob } of knobsOf(scene)) {
    const range = b.range.get(address)
    if (!range) continue
    knob.value = clamp(knob.value + (b.from.get(address) ?? 0) * h10 + (b.to.get(address) ?? 0) * h11, range)
  }
}
