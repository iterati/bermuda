// The morph from scene A to scene B at fader x, made each frame from the two live scenes, both at the clock's time.
// Every knob morphs; star n, the shape's kind and the other switches swap inside a dip where they show nothing (but
// the scene's one drawn level, whose lattice and mirror crossfade instead), and a knob one side lacks morphs from
// the value that draws as if it were not there. Levels pair by id and depth; a level weight collapses what has no
// pair and grows what is new (padding at the deep end; a reorder collapses the level where it was, then grows it
// where it goes). Each depth runs its own window of the fader, staggered by the edge, and depth-indexed values stay
// with the depth (the shader counts depth by weight).
import { paletteAt } from './colour'
import { mixFill, mixHalftone } from './engines/deco'
import { mixDots } from './engines/lines'
import { mixJoin } from './engines/shapes'
import { advance, newLive, type Live } from './motion'
import type { Toward } from './render'
import {
  allLevels,
  clamp,
  depthOf,
  hardRange,
  SPILLS,
  VARIATIONS,
  variationWeight,
  type Edge,
  type Field,
  type Knob,
  type Level,
  type Scene,
  type Shape,
} from './scene'

type Stop = Scene['palette']['stops'][number]
// a pair of levels the morph runs between, one of them a ghost where a level has no pair, and the slots of each
// variant's sub-chain
type Slot = { a: Level; b: Level; moved?: 'out' | 'in'; variants: { below?: Slot[] }[] }

const mix = (a: number, b: number, t: number) => a * (1 - t) + b * t
export const smooth = (from: number, to: number, x: number) => {
  const t = clamp((x - from) / (to - from), [0, 1])
  return t * t * (3 - 2 * t)
}
// 1 over the window's middle, flat that far either side of it, and 0 at its ends: where a switch swaps unseen
const dip = (t: number, flat: number) => smooth(0, 0.5 - flat, t) * (1 - smooth(0.5 + flat, 1, t))

function knob(a: Knob, b: Knob, t: number): Knob {
  const out: Knob = { value: mix(a.value, b.value, t) }
  if (a.spread !== undefined || b.spread !== undefined) out.spread = mix(a.spread ?? 0, b.spread ?? 0, t)
  return out
}
const scaled = (k: Knob, f: number): Knob => ({ ...k, value: k.value * f })
// a lattice vector morphs by its length and angle, so a square pad runs into a hex one along the rhombic arc,
// kept inside the pad's hard ranges
function vector(a: [Knob, Knob], b: [Knob, Knob], t: number): [Knob, Knob] {
  if (t <= 0 || t >= 1) return [knob(a[0], b[0], t), knob(a[1], b[1], t)]
  const polar = ([x, y]: [Knob, Knob]) => [Math.hypot(x.value, y.value), Math.atan2(y.value, x.value)]
  const [[la, ta], [lb, tb]] = [polar(a), polar(b)]
  const [l, th] = [mix(la, lb, t), mix(ta, tb, t)]
  return [
    { ...knob(a[0], b[0], t), value: clamp(l * Math.cos(th), hardRange('levels[].lattice.e2[0]')) },
    { ...knob(a[1], b[1], t), value: clamp(l * Math.sin(th), hardRange('levels[].lattice.e2[1]')) },
  ]
}

// a knob either side may lack, from none (the value that draws as if it were not there); undefined if both lack it
const either = (a: Knob | undefined, b: Knob | undefined, none: number, t: number) =>
  a || b ? knob(a ?? { value: none }, b ?? { value: none }, t) : undefined

// A colour field that is not there, beside one that is: radial round the plane's centre at depth 0, which the radius
// reads as the distance from the centre and which shifts nothing, with the field's angle and scale.
const unfielded = ({ angle, scale }: Field): Field => ({
  kind: 'radial',
  angle,
  centre: [{ value: 0 }, { value: 0 }],
  scale,
  depth: { value: 0 },
})

// The part of the fader depth k of n morphs over: with stagger 0 every depth takes the whole fader, with 1 each
// takes its own nth in turn, the shallowest first unless the edge runs deep first.
export function depthWindow(k: number, n: number, edge: Edge): [number, number] {
  const i = edge.deepFirst ? n - 1 - k : k
  return [(i * edge.stagger) / n, 1 - ((n - 1 - i) * edge.stagger) / n]
}

// A level that is not there: the other side's, collapsed to pass-through, its cells running on down the chain.
const ghost = (level: Level): Level => ({
  ...level,
  weight: { value: 0 },
  variants: level.variants.map(({ share, shape }) => ({ share, shape })),
})

// the longest run two id lists hold in common, in order; a tie keeps the lower id, so B into A runs as A into B
function common(x: string[], y: string[]): string[] {
  const run = x.map(() => y.map(() => 0))
  const at = (i: number, j: number) => (i < x.length && j < y.length ? run[i][j] : 0)
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      run[i][j] = x[i] === y[j] ? 1 + at(i + 1, j + 1) : Math.max(at(i + 1, j), at(i, j + 1))
  const out: string[] = []
  for (let i = 0, j = 0; i < x.length && j < y.length;)
    if (x[i] === y[j]) {
      out.push(x[i])
      i++
      j++
    } else if (at(i + 1, j) > at(i, j + 1) || (at(i + 1, j) === at(i, j + 1) && x[i] > y[j])) i++
    else j++
  return out
}

// Pair two level lists. Levels both hold keep their order (the longest run in common); between them the rest
// pair by depth, and what is left over pads at the deep end. A level both hold out of that order moves.
// A variant with a sub-chain on one side only morphs from the rest of the other side's chain, which is what
// that side's cells run on to.
function align(as: Level[], bs: Level[]): Slot[] {
  const inB = new Set(bs.map((l) => l.id))
  const shared = new Set(as.filter((l) => inB.has(l.id)).map((l) => l.id))
  const kept = new Set(
    common(
      as.map((l) => l.id).filter((id) => shared.has(id)),
      bs.map((l) => l.id).filter((id) => shared.has(id)),
    ),
  )
  const moved = (l: Level | undefined) => !!l && shared.has(l.id) && !kept.has(l.id)
  const slots: Slot[] = []
  let i = 0
  let j = 0
  const add = (a: Level, b: Level, move?: Slot['moved']) => {
    const [restA, restB] = [as.slice(i), bs.slice(j)]
    const variants = Array.from({ length: Math.max(a.variants.length, b.variants.length) }, (_, v) => {
      const [ba, bb] = [a.variants[v]?.below, b.variants[v]?.below]
      return ba || bb ? { below: align(ba ?? restA, bb ?? restB) } : {}
    })
    slots.push(move ? { a, b, moved: move, variants } : { a, b, variants })
  }
  while (i < as.length || j < bs.length) {
    const a = as[i] as Level | undefined
    const b = bs[j] as Level | undefined
    // two moves at once go in id order, so B into A runs as A into B
    if (moved(a) && (!moved(b) || a!.id < b!.id)) add(as[i++], ghost(a!), 'out')
    else if (moved(b)) add(ghost(b!), bs[j++], 'in')
    else if (a && b && kept.has(a.id) === kept.has(b.id)) add(as[i++], bs[j++])
    else if (a && !kept.has(a.id)) add(as[i++], ghost(a))
    else add(ghost(b!), bs[j++])
  }
  return slots
}

// star n and the kind are whole: they swap inside a circle dip, where every n and kind draws the same circle; a
// FORMLESS kind has no form, so it takes the other side's; the join morphs as Shapes has it
function shape(a: Shape, b: Shape, t: number): Shape {
  const round = knob(a.round, b.round, t)
  if (a.n !== b.n || (a.kind ?? 'star') !== (b.kind ?? 'star')) round.value = mix(round.value, 1, dip(t, 0.1))
  const out: Shape = {
    n: t < 0.5 ? a.n : b.n,
    m: knob(a.m, b.m, t),
    r: knob(a.r, b.r, t),
    round,
    twist: knob(a.twist, b.twist, t),
  }
  const kind = t < 0.5 ? a.kind : b.kind
  if (kind) out.kind = kind
  const form = a.form ?? b.form
  if (form) out.form = knob(a.form ?? form, b.form ?? form, t)
  const corner = either(a.corner, b.corner, 0, t)
  if (corner) out.corner = corner
  const onion = either(a.onion, b.onion, 0, t)
  if (onion) out.onion = onion
  const join = mixJoin(
    a,
    b,
    (ka, kb) => knob(ka, kb, t),
    (sa, sb) => shape(sa, sb, t),
  )
  if (join) out.join = join
  return out
}

// far: each drawn level whose far end has another id, that id and how far through its window the level is
function mixLevels(
  slots: Slot[],
  top: number,
  x: number,
  edge: Edge,
  n: number,
  far: Map<Level, { id: string; at: number }>,
  crosses?: Map<Level, NonNullable<Toward['cross']>>,
): Level[] {
  // a move runs both halves on one window, both its depths' together, so it collapses before it grows
  const moves = new Map<string, [number, number]>()
  slots.forEach(({ a, moved }, i) => {
    if (!moved) return
    const [from, to] = depthWindow(top + i, n, edge)
    const other = moves.get(a.id)
    moves.set(a.id, other ? [Math.min(from, other[0]), Math.max(to, other[1])] : [from, to])
  })
  return slots.map(({ a, b, moved, variants }, i) => {
    const [from, to] = moved ? moves.get(a.id)! : depthWindow(top + i, n, edge)
    const s = x <= from ? 0 : x >= to ? 1 : (x - from) / (to - from)
    // a move collapses over the first half of its window where it was, and grows over the second where it goes
    const t = moved === 'out' ? clamp(2 * s, [0, 1]) : moved === 'in' ? clamp(2 * s - 1, [0, 1]) : s
    const swap = t < 0.5 ? a : b
    const k = (ka: Knob, kb: Knob) => knob(ka, kb, t)
    const by = a.cell.by === b.cell.by ? 1 : 1 - dip(t, 0.1)
    // oblique is voronoi at jitter 0, so the two morph as voronoi throughout; another change of kind or
    // sectors swaps where the level's weight dips to nothing, and where only its first variant is picked, so
    // every cell runs on down the same chain either side of the swap; so does a mirror coming or going, as no
    // turn reaches a reflection. The scene's one drawn level (crosses) has nothing else drawn to keep the
    // picture while it weighs nothing, so its weight stays whole and the picture crossfades from the level with
    // A's switches to it with B's (the shader draws both), with no dip and nothing swapped in sight.
    const kinds = new Set([a.lattice.kind, b.lattice.kind])
    const voronoi = kinds.has('voronoi') && (kinds.size === 1 || kinds.has('oblique'))
    const swaps =
      (!voronoi && (kinds.size > 1 || a.lattice.sectors !== b.lattice.sectors)) ||
      (a.cell.by === 'mirror') !== (b.cell.by === 'mirror')
    const hidden = swaps && !crosses ? 1 - dip(t, 0.05) : 1
    const vectors = [...kinds].every((kind) => ['oblique', 'triangle', 'voronoi'].includes(kind))
    const e2: Level['lattice']['e2'] = vectors
      ? vector(a.lattice.e2, b.lattice.e2, t)
      : [k(a.lattice.e2[0], b.lattice.e2[0]), k(a.lattice.e2[1], b.lattice.e2[1])]
    const jitter = voronoi ? k(a.lattice.jitter ?? { value: 0 }, b.lattice.jitter ?? { value: 0 }) : undefined
    // front order, which spill fades in, swaps where spill dips to nothing, and the cells paint their own shapes alone
    const spill = either(a.cell.spill, b.cell.spill, 0, t)
    if (spill && !a.fill?.front !== !b.fill?.front) spill.value *= 1 - dip(t, 0.1)
    const [turn, phase] = [scaled(k(a.cell.turn, b.cell.turn), by), scaled(k(a.cell.phase, b.cell.phase), by)]
    // a side's switches on the morphed knobs: its lattice kind and sectors, and its cell step; spill only where
    // the lattice can, so it drops where a swap's weight is nothing
    const sided = (side: Level): Pick<Level, 'lattice' | 'cell'> => {
      const lattice: Level['lattice'] = { kind: voronoi ? 'voronoi' : side.lattice.kind, e2 }
      if (jitter) lattice.jitter = jitter
      if (side.lattice.sectors !== undefined) lattice.sectors = side.lattice.sectors
      // parity swaps where the cells neither turn nor shift their rings
      const cell = { by: side.cell.by, turn, phase, ...(spill && SPILLS.includes(lattice.kind) ? { spill } : {}) }
      return { lattice, cell }
    }
    const level: Level = {
      id: a.id,
      weight: scaled(k(a.weight, b.weight), hidden),
      affine: {
        scale: k(a.affine.scale, b.affine.scale),
        turn: k(a.affine.turn, b.affine.turn),
        offset: [k(a.affine.offset[0], b.affine.offset[0]), k(a.affine.offset[1], b.affine.offset[1])],
      },
      variations: VARIATIONS.filter((kind) => [a, b].some((l) => l.variations.some((v) => v.kind === kind))).map(
        (kind) => ({ kind, weight: { value: mix(variationWeight(a, kind), variationWeight(b, kind), t) } }),
      ),
      ...sided(swap),
      variants: variants.map(({ below }, v) => {
        // a variant that is not there has no share
        const va = a.variants[v] ?? { ...b.variants[v], share: { value: 0 } }
        const vb = b.variants[v] ?? { ...a.variants[v], share: { value: 0 } }
        const share = scaled(k(va.share, vb.share), v > 0 && variants.some((s) => s.below) ? hidden : 1)
        const out: Level['variants'][number] = { share, shape: shape(va.shape, vb.shape, t) }
        if (below) out.below = mixLevels(below, top + i + 1, x, edge, n, far)
        return out
      }),
      // a far end with another id turns each cell over to its own picks in the middle of the window (the
      // shader), so the cells' colour spread is gone while they do
      colour: {
        at: k(a.colour.at, b.colour.at),
        speed: k(a.colour.speed, b.colour.speed),
        cellSpread: scaled(k(a.colour.cellSpread, b.colour.cellSpread), a.id === b.id ? 1 : 1 - dip(t, 0.2)),
      },
    }
    const fill = mixFill(a.fill, b.fill, t, k)
    if (fill) level.fill = fill
    // a halftone's grid swaps at the middle, where its amount dips to nothing, its link group's spread with it
    const halftone = mixHalftone(a.halftone, b.halftone, t, k)
    if (halftone) {
      if (a.halftone && b.halftone && a.halftone.grid !== b.halftone.grid) {
        const { amount } = halftone
        const f = 1 - dip(t, 0.05)
        halftone.amount = { ...scaled(amount, f), ...(amount.spread ? { spread: amount.spread * f } : {}) }
      }
      level.halftone = halftone
    }
    if (a.id !== b.id) far.set(level, { id: b.id, at: t })
    // the far side's picture shares the level's knobs, so a bend of the scene bends both
    const c = smooth(0, 1, t)
    if (crosses && swaps)
      crosses.set(level, { levels: [{ ...level, ...sided(swap === a ? b : a) }], at: Math.min(c, 1 - c) })
    return level
  })
}

// A palette's stops made count: its widest segments split at their middles, each half drawing what it drew.
function padStops(stops: Stop[], count: number): Stop[] {
  const out = [...stops]
  while (out.length < count) {
    const span = (i: number) => (i + 1 < out.length ? out[i + 1].at : out[0].at + 1) - out[i].at
    const k = out.reduce((best, _, i) => (span(i) > span(best) ? i : best), 0)
    const at = out[k].at + span(k) / 2
    const [L, C, h] = paletteAt(
      { stops: out, hue: { value: 0 }, contrast: { value: 1 }, radius: { value: 0 }, time: { value: 0 } },
      at,
    )
    // half of an arc round the hue wheel is always its own short way
    const halves = out[k].mix === 'straight' ? 'straight' : 'short'
    out[k] = { ...out[k], mix: halves }
    const mid: Stop = {
      at: at >= 1 ? at - 1 : at,
      lch: [{ value: L }, { value: C }, { value: ((h % 360) + 360) % 360 }],
      mix: halves,
    }
    out.splice(at >= 1 ? 0 : k + 1, 0, mid)
  }
  return out
}

// a stop's hue morphs the short way round
function hue(a: Knob, b: Knob, t: number): Knob {
  const d = ((((b.value - a.value + 180) % 360) + 360) % 360) - 180
  return { value: t >= 1 ? b.value : a.value + d * t }
}

// The scene to draw at fader x from the live scenes a and b, and what the shader blends in of b's switches and
// running phases (phases: b's live ones).
export function morph(
  a: Scene,
  b: Scene,
  x: number,
  edge: Edge,
  phases: Pick<Live, 'drift' | 'colour' | 'crawl'>,
): { scene: Scene; toward: Toward } {
  const slots = align(a.levels, b.levels)
  const far = new Map<Level, { id: string; at: number }>()
  // the scene's one drawn level crossfades through a swap rather than dip (mixLevels)
  const lone = slots.length === 1 && slots[0].variants.every((v) => !v.below)
  const crosses = lone ? new Map<Level, NonNullable<Toward['cross']>>() : undefined
  const k = (ka: Knob, kb: Knob) => knob(ka, kb, x)
  const count = Math.max(a.palette.stops.length, b.palette.stops.length)
  const [sa, sb] = [padStops(a.palette.stops, count), padStops(b.palette.stops, count)]
  const scene: Scene = {
    name: `${a.name} → ${b.name}`,
    frame: {
      origin: [k(a.frame.origin[0], b.frame.origin[0]), k(a.frame.origin[1], b.frame.origin[1])],
      zoom: k(a.frame.zoom, b.frame.zoom),
      turn: k(a.frame.turn, b.frame.turn),
    },
    levels: mixLevels(slots, 0, x, edge, depthOf(slots), far, crosses),
    contour: {
      // the shader morphs the rings from a's to toward's
      rings: a.contour.rings,
      drift: k(a.contour.drift, b.contour.drift),
      radialWeight: k(a.contour.radialWeight, b.contour.radialWeight),
    },
    line: {
      kind: a.line.kind,
      width: k(a.line.width, b.line.width),
      falloff: k(a.line.falloff, b.line.falloff),
      units: a.line.units,
    },
    palette: {
      // the shader blends each segment's mix from a's to toward's
      stops: sa.map((s, i) => ({
        at: mix(s.at, sb[i].at, x),
        lch: [k(s.lch[0], sb[i].lch[0]), k(s.lch[1], sb[i].lch[1]), hue(s.lch[2], sb[i].lch[2], x)],
        mix: s.mix,
      })),
      hue: k(a.palette.hue, b.palette.hue),
      contrast: k(a.palette.contrast, b.palette.contrast),
      radius: k(a.palette.radius, b.palette.radius),
      time: k(a.palette.time, b.palette.time),
    },
    composite: a.composite,
    // the sample count is whole: it swaps at the middle, where it shows least
    post: { aa: x < 0.5 ? a.post.aa : b.post.aa, gamma: k(a.post.gamma, b.post.gamma) },
    modulators: [],
    macros: [],
    presets: [],
  }
  // an orbit trap one side lacks is there at weight 0
  if (a.palette.trap || b.palette.trap) {
    const ta = a.palette.trap ?? { ...b.palette.trap!, weight: { value: 0 } }
    const tb = b.palette.trap ?? { ...a.palette.trap!, weight: { value: 0 } }
    scene.palette.trap = { weight: k(ta.weight, tb.weight), size: k(ta.size, tb.size) }
  }
  // a colour field one side lacks morphs from one that is no field; a change of kind, steps or cells swaps at the
  // middle, where its depth dips to nothing
  if (a.palette.field || b.palette.field) {
    const fa = a.palette.field ?? unfielded(b.palette.field!)
    const fb = b.palette.field ?? unfielded(a.palette.field!)
    const side = x < 0.5 ? fa : fb
    const swaps = fa.kind !== fb.kind || fa.steps !== fb.steps || !fa.atCells !== !fb.atCells
    scene.palette.field = {
      kind: side.kind,
      angle: k(fa.angle, fb.angle),
      centre: [k(fa.centre[0], fb.centre[0]), k(fa.centre[1], fb.centre[1])],
      scale: k(fa.scale, fb.scale),
      depth: scaled(k(fa.depth, fb.depth), swaps ? 1 - dip(x, 0.1) : 1),
      ...(side.steps ? { steps: side.steps } : {}),
      ...(side.atCells ? { atCells: side.atCells } : {}),
    }
  }
  const dots = mixDots(a.line, b.line, k)
  if (dots) scene.line.dots = dots
  // a background one side lacks morphs from the other side's at amount 0; a change of kind swaps where the amount
  // dips to nothing
  if (a.background || b.background) {
    const ba = a.background ?? { ...b.background!, amount: { value: 0 } }
    const bb = b.background ?? { ...a.background!, amount: { value: 0 } }
    scene.background = {
      kind: x < 0.5 ? ba.kind : bb.kind,
      at: [k(ba.at[0], bb.at[0]), k(ba.at[1], bb.at[1])],
      amount: scaled(k(ba.amount, bb.amount), ba.kind === bb.kind ? 1 : 1 - dip(x, 0.1)),
      turn: k(ba.turn, bb.turn),
      scale: k(ba.scale, bb.scale),
      edge: k(ba.edge, bb.edge),
      seep: k(ba.seep, bb.seep),
    }
  }
  const toward: Toward = {
    line: b.line.kind,
    rings: [b.contour.rings.value, b.contour.rings.spread ?? 0],
    units: b.line.units,
    composite: b.composite,
    mixes: sb.map((s) => s.mix),
    levels: allLevels(scene.levels).map(({ level }) => far.get(level) ?? null),
    drift: phases.drift,
    colour: phases.colour,
    crawl: phases.crawl,
    at: x,
  }
  const cross = crosses?.get(scene.levels[0])
  if (cross) toward.cross = cross
  return { scene, toward }
}

// The levels and depth the morph of a into b draws, which the shader's limits hold to.
export function morphSize(a: Scene, b: Scene): { levels: number; depth: number } {
  const edge: Edge = { seconds: 0, stagger: 0, deepFirst: false }
  const { levels } = morph(advance(a, newLive(), 0, 0), advance(b, newLive(), 0, 0), 0.5, edge, newLive()).scene
  return { levels: allLevels(levels).length, depth: depthOf(levels) }
}
