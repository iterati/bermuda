// The durable shapes of a scene, their hard ranges, their addresses and the strict parse of a scene's JSON.
// Angles are in degrees, periods in clock units (beats), and the palette index runs 0 to 1 round the stops.

export type Knob = { value: number; spread?: number; glide?: number; play?: [number, number] } // play: inside the kind's hard range
export type Shape = { n: number; m: Knob; r: Knob; round: Knob; twist: Knob }
export type Level = {
  id: string
  link?: string
  weight: Knob
  affine: { scale: Knob; turn: Knob; offset: [Knob, Knob] }
  variations: { kind: VariationKind; weight: Knob }[]
  lattice: {
    kind: 'oblique' | 'brick' | 'triangle' | 'polar' | 'logpolar' | 'fold' | 'voronoi'
    e2: [Knob, Knob]
    jitter?: Knob
  }
  cell: { by: 'none' | 'parity' | 'hash' | 'ring'; turn: Knob; phase: Knob }
  variants: { share: Knob; shape: Shape; below?: Level[] }[] // below: a per-cell sub-chain
  colour: { at: Knob; speed: Knob; cellSpread: Knob }
}
export type Scene = {
  // a look: play ranges and macros travel with it
  name: string
  frame: { origin: [Knob, Knob]; zoom: Knob; turn: Knob }
  levels: Level[]
  contour: { rings: Knob; drift: Knob; radialWeight: Knob }
  line: { kind: 'glow' | 'smooth' | 'hard' | 'band'; width: Knob; falloff: Knob; units: 'cell' | 'screen' }
  palette: {
    stops: { at: number; lch: [Knob, Knob, Knob]; mix: 'straight' | 'short' | 'long' }[]
    hue: Knob
    contrast: Knob
    radius: Knob
    time: Knob
  }
  composite: 'add' | 'first'
  post: { aa: 1 | 2 | 3; gamma: Knob }
  modulators: Modulator[]
  macros: Macro[]
  presets: Preset[]
  loop?: { seconds: number }
}
export type Preset = { name: string; values: Record<Address, number> } // a keyframe inside the look's clamps
export type Address = string // 'levels[hexA].affine.scale'
export type Modulator = {
  id: string
  wave: 'cos' | 'tri' | 'beat' | 'ramp' | 'steps'
  period: number
  phase: number
  harmonics?: [number, number]
  steps?: number[]
  glide: number
  targets: { knob: Address; depth: number; phaseSpread?: number }[]
}
export type Macro = { id: string; name: string; value: number; targets: { knob: Address; from: number; to: number }[] }
export type Edge = { seconds: number; stagger: number; deepFirst: boolean }
export type Bank = {
  scenes: string[]
  links: [string, string][]
  autopilot: { on: boolean; every: number; wander: number; edge: Edge }
  moods: Macro[]
}
export type Timeline = {
  song: string
  keys: { at: number; scene: string; edge: Edge }[]
  curves: { knob: Address; points: [number, number][] }[]
}

export type VariationKind = (typeof VARIATIONS)[number]
export const VARIATIONS = [
  'linear',
  'radial',
  'swirl',
  'spherical',
  'sinusoidal',
  'polar',
  'bubble',
  'fisheye',
] as const
export const LINES = ['glow', 'smooth', 'hard', 'band'] as const
export const WAVES = ['cos', 'tri', 'beat', 'ramp', 'steps'] as const
export const MIXES = ['straight', 'short', 'long'] as const
export const MAX_LEVELS = 32
export const MAX_DEPTH = 16
export const MAX_VARIANTS = 4
export const MAX_STOPS = 8

// The hard range of every knob kind, keyed by its address with the level ids and list indices taken out
// (see kindOf). Every value a scene holds and every play range sits inside its kind's range.
export const HARD: Record<string, [number, number]> = {
  'frame.origin[0]': [-4, 4],
  'frame.origin[1]': [-4, 4],
  'frame.zoom': [0.1, 8],
  'frame.turn': [-360, 360],
  'levels[].weight': [0, 1],
  'levels[].affine.scale': [0.1, 8],
  'levels[].affine.turn': [-360, 360],
  'levels[].affine.offset[0]': [-2, 2],
  'levels[].affine.offset[1]': [-2, 2],
  'levels[].variations[].weight': [-1, 2],
  'levels[].lattice.e2[0]': [0, 0.5],
  'levels[].lattice.e2[1]': [0.5, 2],
  'levels[].cell.turn': [-180, 180],
  'levels[].cell.phase': [-1, 1],
  'levels[].variants[].share': [0, 1],
  'levels[].variants[].shape.m': [1.01, 16],
  'levels[].variants[].shape.r': [0.02, 2],
  'levels[].variants[].shape.round': [0, 1],
  'levels[].variants[].shape.twist': [-180, 180],
  'levels[].colour.at': [0, 1],
  'levels[].colour.speed': [0, 1],
  'levels[].colour.cellSpread': [0, 1],
  'contour.rings': [0, 24],
  'contour.drift': [-8, 8],
  'contour.radialWeight': [-3, 3],
  'line.width': [0.0002, 0.2],
  'line.falloff': [0.3, 3],
  'palette.stops[].lch[0]': [0, 1],
  'palette.stops[].lch[1]': [0, 0.37],
  'palette.stops[].lch[2]': [0, 360],
  'palette.hue': [-360, 360],
  'palette.contrast': [0, 2],
  'palette.radius': [-2, 2],
  'palette.time': [-2, 2],
  'post.gamma': [0.5, 3],
}
export const STAR_N: [number, number] = [3, 16]

// 'levels[a].variants[1].below[b].affine.offset[0]' -> 'levels[].affine.offset[0]'
export function kindOf(address: Address): string {
  return address
    .replace(/\[[^\]]*\](?!$)/g, '[]')
    .replace(/\[[^\d\]][^\]]*\]$/, '[]')
    .replace(/(\.variants\[\]\.below\[\])+/g, '')
}

export function hardRange(address: Address): [number, number] {
  const range = HARD[kindOf(address)]
  if (!range) throw new Error(`${address}: no knob kind`)
  return range
}

// The range every automatic mover keeps to: the knob's play range, else its kind's hard range.
export function playRange(address: Address, knob: Knob): [number, number] {
  return knob.play ?? hardRange(address)
}

export const clamp = (v: number, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, v))

// Every knob of a scene with its address and the level list and level it sits in, if any.
export type KnobAt = { address: Address; knob: Knob; level?: { prefix: Address; level: Level; list: Level[] } }

export function knobsOf(scene: Scene): KnobAt[] {
  const out: KnobAt[] = []
  const walk = (node: unknown, address: string, level: KnobAt['level']) => {
    if (Array.isArray(node)) {
      node.forEach((item: unknown, i) => {
        if (isLevel(item)) {
          const prefix = `${address}[${item.id}]`
          walk(item, prefix, { prefix, level: item, list: node as Level[] })
        } else walk(item, `${address}[${i}]`, level)
      })
    } else if (isKnob(node)) out.push({ address, knob: node, level })
    else if (node && typeof node === 'object')
      for (const [key, value] of Object.entries(node)) walk(value, address ? `${address}.${key}` : key, level)
  }
  const { frame, levels, contour, line, palette, post } = scene
  walk({ frame, levels, contour, line, palette, post }, '', undefined)
  return out
}

const isLevel = (v: unknown): v is Level => !!v && typeof v === 'object' && 'id' in v && 'affine' in v
const isKnob = (v: unknown): v is Knob =>
  !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as Knob).value === 'number' && !('id' in v)

// The knob an address names, or undefined. Level lists are picked by id, every other list by index.
export function resolve(scene: Scene, address: Address): Knob | undefined {
  let node: unknown = scene
  for (const part of address.split('.')) {
    const m = /^(\w+)((?:\[[^\]]+\])*)$/.exec(part)
    if (!m || !node || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[m[1]]
    for (const [, sel] of m[2].matchAll(/\[([^\]]+)\]/g)) {
      if (!Array.isArray(node)) return undefined
      node = /^\d+$/.test(sel) ? node[Number(sel)] : node.find((l: unknown) => isLevel(l) && l.id === sel)
    }
  }
  return isKnob(node) ? node : undefined
}

// Every level of the scene, sub-chains included, with the list it sits in.
export function allLevels(levels: Level[]): { level: Level; list: Level[] }[] {
  return levels.flatMap((level) => [
    { level, list: levels },
    ...level.variants.flatMap((v) => (v.below ? allLevels(v.below) : [])),
  ])
}

// The longest chain a pixel can run, counting sub-chains.
export function depthOf(levels: Level[]): number {
  return Math.max(
    0,
    ...levels.map((level, i) =>
      Math.max(levels.length, i + 1 + Math.max(0, ...level.variants.map((v) => (v.below ? depthOf(v.below) : 0)))),
    ),
  )
}

// ---- the strict parse ----

export class SceneError extends Error {}

type Json = Record<string, unknown>
const fail = (path: string, why: string): never => {
  throw new SceneError(`${path}: ${why}`)
}
function obj(v: unknown, path: string, required: string[], optional: string[] = []): Json {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail(path, 'must be an object')
  for (const key of required) if (!(key in v)) fail(path ? `${path}.${key}` : key, 'is missing')
  for (const key of Object.keys(v))
    if (!required.includes(key) && !optional.includes(key)) fail(path ? `${path}.${key}` : key, 'is not a field')
  return v as Json
}
function num(v: unknown, path: string, range?: [number, number]): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fail(path, 'must be a finite number')
  if (range && (v < range[0] || v > range[1])) fail(path, `${v} is outside ${range[0]} to ${range[1]}`)
  return v
}
function str(v: unknown, path: string): string {
  if (typeof v !== 'string' || !v) return fail(path, 'must be a non-empty string')
  return v
}
function oneOf<T extends string | number>(v: unknown, path: string, options: readonly T[]): T {
  if (!options.includes(v as T)) fail(path, `must be one of ${options.join(', ')}`)
  return v as T
}
function list(v: unknown, path: string, min: number, max: number): unknown[] {
  if (!Array.isArray(v)) return fail(path, 'must be a list')
  if (v.length < min || v.length > max) fail(path, `must hold ${min} to ${max} items`)
  return v
}
function pair<T>(v: unknown, path: string, item: (v: unknown, path: string) => T): [T, T] {
  const [a, b] = list(v, path, 2, 2)
  return [item(a, `${path}[0]`), item(b, `${path}[1]`)]
}

function knob(v: unknown, path: string): Knob {
  const o = obj(v, path, ['value'], ['spread', 'glide', 'play'])
  const range = hardRange(path)
  const out: Knob = { value: num(o.value, `${path}.value`, range) }
  if (o.spread !== undefined) out.spread = num(o.spread, `${path}.spread`)
  if (o.glide !== undefined) out.glide = num(o.glide, `${path}.glide`, [0, 60])
  if (o.play !== undefined) {
    out.play = pair(o.play, `${path}.play`, (p, at) => num(p, at, range))
    if (out.play[0] > out.play[1]) fail(`${path}.play`, 'must run low to high')
  }
  return out
}

function shape(v: unknown, path: string): Shape {
  const o = obj(v, path, ['n', 'm', 'r', 'round', 'twist'])
  const n = num(o.n, `${path}.n`, STAR_N)
  if (!Number.isInteger(n)) fail(`${path}.n`, 'must be a whole number')
  return {
    n,
    m: knob(o.m, `${path}.m`),
    r: knob(o.r, `${path}.r`),
    round: knob(o.round, `${path}.round`),
    twist: knob(o.twist, `${path}.twist`),
  }
}

function levelList(v: unknown, path: string, ids: Set<string>): Level[] {
  const items = list(v, path, 1, MAX_LEVELS)
  const out: Level[] = []
  items.forEach((item, i) => {
    const id = str((item as Json | null)?.id, `${path}[${i}].id`)
    if (!/^[A-Za-z][\w-]*$/.test(id))
      fail(`${path}[${i}].id`, 'must start with a letter and hold only letters, digits, _ and -')
    if (ids.has(id)) fail(`${path}[${i}].id`, `${id} is used twice`)
    ids.add(id)
    out.push(level(item, `${path}[${id}]`, out, ids))
  })
  return out
}

function level(v: unknown, path: string, before: Level[], ids: Set<string>): Level {
  const o = obj(v, path, ['id', 'weight', 'affine', 'variations', 'lattice', 'cell', 'variants', 'colour'], ['link'])
  const out = { id: o.id as string } as Level
  if (o.link !== undefined) {
    const link = str(o.link, `${path}.link`)
    const leader = before.find((l) => l.id === link)
    if (!leader) fail(`${path}.link`, `${link} is not an earlier level of the same list`)
    if (leader?.link) fail(`${path}.link`, `${link} is itself linked`)
    out.link = link
  }
  out.weight = knob(o.weight, `${path}.weight`)
  const affine = obj(o.affine, `${path}.affine`, ['scale', 'turn', 'offset'])
  out.affine = {
    scale: knob(affine.scale, `${path}.affine.scale`),
    turn: knob(affine.turn, `${path}.affine.turn`),
    offset: pair(affine.offset, `${path}.affine.offset`, knob),
  }
  out.variations = list(o.variations, `${path}.variations`, 1, VARIATIONS.length).map((item, i) => {
    const at = `${path}.variations[${i}]`
    const x = obj(item, at, ['kind', 'weight'])
    return { kind: oneOf(x.kind, `${at}.kind`, VARIATIONS), weight: knob(x.weight, `${at}.weight`) }
  })
  const lattice = obj(o.lattice, `${path}.lattice`, ['kind', 'e2'], ['jitter'])
  // milestone 1 runs the oblique pad only; the other kinds and jitter come with milestone 3
  out.lattice = {
    kind: oneOf(lattice.kind, `${path}.lattice.kind`, ['oblique'] as const),
    e2: pair(lattice.e2, `${path}.lattice.e2`, knob),
  }
  if (lattice.jitter !== undefined) fail(`${path}.lattice.jitter`, 'is not in milestone 1')
  const cell = obj(o.cell, `${path}.cell`, ['by', 'turn', 'phase'])
  out.cell = {
    by: oneOf(cell.by, `${path}.cell.by`, ['none', 'parity'] as const),
    turn: knob(cell.turn, `${path}.cell.turn`),
    phase: knob(cell.phase, `${path}.cell.phase`),
  }
  out.variants = list(o.variants, `${path}.variants`, 1, MAX_VARIANTS).map((item, i) => {
    const at = `${path}.variants[${i}]`
    const x = obj(item, at, ['share', 'shape'], ['below'])
    const variant: Level['variants'][number] = {
      share: knob(x.share, `${at}.share`),
      shape: shape(x.shape, `${at}.shape`),
    }
    if (x.below !== undefined) variant.below = levelList(x.below, `${at}.below`, ids)
    return variant
  })
  const colour = obj(o.colour, `${path}.colour`, ['at', 'speed', 'cellSpread'])
  out.colour = {
    at: knob(colour.at, `${path}.colour.at`),
    speed: knob(colour.speed, `${path}.colour.speed`),
    cellSpread: knob(colour.cellSpread, `${path}.colour.cellSpread`),
  }
  return out
}

function address(scene: Scene, v: unknown, path: string): Address {
  const a = str(v, path)
  if (!resolve(scene, a)) fail(path, `${a} names no knob`)
  return a
}

// Parse a scene's JSON (text or a parsed value): refuse anything off the shapes above, naming the field.
export function parseScene(input: unknown): Scene {
  const v = typeof input === 'string' ? (JSON.parse(input) as unknown) : input
  const o = obj(
    v,
    '',
    ['name', 'frame', 'levels', 'contour', 'line', 'palette', 'composite', 'post', 'modulators', 'macros', 'presets'],
    ['loop'],
  )
  const ids = new Set<string>()
  const frame = obj(o.frame, 'frame', ['origin', 'zoom', 'turn'])
  const contour = obj(o.contour, 'contour', ['rings', 'drift', 'radialWeight'])
  const line = obj(o.line, 'line', ['kind', 'width', 'falloff', 'units'])
  const palette = obj(o.palette, 'palette', ['stops', 'hue', 'contrast', 'radius', 'time'])
  const post = obj(o.post, 'post', ['aa', 'gamma'])
  const scene: Scene = {
    name: str(o.name, 'name'),
    frame: {
      origin: pair(frame.origin, 'frame.origin', knob),
      zoom: knob(frame.zoom, 'frame.zoom'),
      turn: knob(frame.turn, 'frame.turn'),
    },
    levels: levelList(o.levels, 'levels', ids),
    contour: {
      rings: knob(contour.rings, 'contour.rings'),
      drift: knob(contour.drift, 'contour.drift'),
      radialWeight: knob(contour.radialWeight, 'contour.radialWeight'),
    },
    line: {
      kind: oneOf(line.kind, 'line.kind', LINES),
      width: knob(line.width, 'line.width'),
      falloff: knob(line.falloff, 'line.falloff'),
      units: oneOf(line.units, 'line.units', ['cell', 'screen'] as const),
    },
    palette: {
      stops: list(palette.stops, 'palette.stops', 2, MAX_STOPS).map((item, i) => {
        const at = `palette.stops[${i}]`
        const x = obj(item, at, ['at', 'lch', 'mix'])
        const lch = list(x.lch, `${at}.lch`, 3, 3)
        return {
          at: num(x.at, `${at}.at`, [0, 1]),
          lch: [knob(lch[0], `${at}.lch[0]`), knob(lch[1], `${at}.lch[1]`), knob(lch[2], `${at}.lch[2]`)],
          mix: oneOf(x.mix, `${at}.mix`, MIXES),
        }
      }),
      hue: knob(palette.hue, 'palette.hue'),
      contrast: knob(palette.contrast, 'palette.contrast'),
      radius: knob(palette.radius, 'palette.radius'),
      time: knob(palette.time, 'palette.time'),
    },
    composite: oneOf(o.composite, 'composite', ['add', 'first'] as const),
    post: { aa: oneOf(post.aa, 'post.aa', [1, 2, 3] as const), gamma: knob(post.gamma, 'post.gamma') },
    modulators: [],
    macros: [],
    presets: [],
  }
  scene.palette.stops.forEach((s, i, all) => {
    if (i > 0 && s.at <= all[i - 1].at) fail(`palette.stops[${i}].at`, 'must be above the stop before it')
  })
  if (allLevels(scene.levels).length > MAX_LEVELS)
    fail('levels', `must hold at most ${MAX_LEVELS} levels, sub-chains included`)
  if (depthOf(scene.levels) > MAX_DEPTH) fail('levels', `must chain at most ${MAX_DEPTH} levels deep`)

  const modIds = new Set<string>()
  scene.modulators = list(o.modulators, 'modulators', 0, 64).map((item, i) => {
    const at = `modulators[${i}]`
    const x = obj(item, at, ['id', 'wave', 'period', 'phase', 'glide', 'targets'], ['harmonics', 'steps'])
    const id = str(x.id, `${at}.id`)
    if (modIds.has(id)) fail(`${at}.id`, `${id} is used twice`)
    modIds.add(id)
    const m: Modulator = {
      id,
      wave: oneOf(x.wave, `${at}.wave`, WAVES),
      period: num(x.period, `${at}.period`, [0.01, 100000]),
      phase: num(x.phase, `${at}.phase`),
      glide: num(x.glide, `${at}.glide`, [0, 60]),
      targets: list(x.targets, `${at}.targets`, 0, 256).map((t, j) => {
        const tt = obj(t, `${at}.targets[${j}]`, ['knob', 'depth'], ['phaseSpread'])
        const target: Modulator['targets'][number] = {
          knob: address(scene, tt.knob, `${at}.targets[${j}].knob`),
          depth: num(tt.depth, `${at}.targets[${j}].depth`),
        }
        if (tt.phaseSpread !== undefined) target.phaseSpread = num(tt.phaseSpread, `${at}.targets[${j}].phaseSpread`)
        return target
      }),
    }
    if (x.harmonics !== undefined) m.harmonics = pair(x.harmonics, `${at}.harmonics`, (h, p) => num(h, p, [0, 64]))
    if (x.steps !== undefined)
      m.steps = list(x.steps, `${at}.steps`, 1, 64).map((s, j) => num(s, `${at}.steps[${j}]`, [0, 1]))
    if (m.wave === 'steps' && !m.steps) fail(`${at}.steps`, 'is missing for a steps wave')
    return m
  })
  const macroIds = new Set<string>()
  scene.macros = list(o.macros, 'macros', 0, 64).map((item, i) => {
    const at = `macros[${i}]`
    const x = obj(item, at, ['id', 'name', 'value', 'targets'])
    const id = str(x.id, `${at}.id`)
    if (macroIds.has(id)) fail(`${at}.id`, `${id} is used twice`)
    macroIds.add(id)
    return {
      id,
      name: str(x.name, `${at}.name`),
      value: num(x.value, `${at}.value`, [0, 1]),
      targets: list(x.targets, `${at}.targets`, 0, 256).map((t, j) => {
        const p = `${at}.targets[${j}]`
        const tt = obj(t, p, ['knob', 'from', 'to'])
        const knobAt = address(scene, tt.knob, `${p}.knob`)
        return {
          knob: knobAt,
          from: num(tt.from, `${p}.from`, hardRange(knobAt)),
          to: num(tt.to, `${p}.to`, hardRange(knobAt)),
        }
      }),
    }
  })
  scene.presets = list(o.presets, 'presets', 0, 256).map((item, i) => {
    const at = `presets[${i}]`
    const x = obj(item, at, ['name', 'values'])
    const values = obj(x.values, `${at}.values`, [], Object.keys((x.values as Json | null) ?? {}))
    const out: Record<Address, number> = {}
    for (const [k, value] of Object.entries(values))
      out[address(scene, k, `${at}.values`)] = num(value, `${at}.values.${k}`, hardRange(k))
    return { name: str(x.name, `${at}.name`), values: out }
  })
  if (o.loop !== undefined) {
    const loop = obj(o.loop, 'loop', ['seconds'])
    scene.loop = { seconds: num(loop.seconds, 'loop.seconds', [0.1, 3600]) }
  }
  return scene
}
