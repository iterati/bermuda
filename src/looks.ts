// The built-in looks: the nine Tapestries re-made in spirit through the level chain, then remixes across levels.
// Periods are in clock units, one a second at the default 60 bpm; angles are in degrees.
import { stopsFromCosine } from './colour'
import { FORMLESS } from './scene'
import { entryName } from './play'
import type {
  Address,
  Bank,
  Dots,
  Join,
  Knob,
  LatticeKind,
  Level,
  Macro,
  Modulator,
  Preset,
  Scene,
  Shape,
  ShapeKind,
  VariationKind,
} from './scene'

type K = number | Knob
// a fresh knob each time: linked levels built from one spec must not share knob objects
const k = (x: K): Knob => (typeof x === 'number' ? { value: x } : structuredClone(x))
const R3 = Math.sqrt(3)
const SQUARE: [number, number] = [0, 1]
const HEX: [number, number] = [0.5, R3 / 2]

type ShapeSpec = { round?: K; twist?: K; corner?: K; onion?: K; join?: Join }
const extras = (o: ShapeSpec) => ({
  ...(o.corner === undefined ? {} : { corner: k(o.corner) }),
  ...(o.onion === undefined ? {} : { onion: k(o.onion) }),
  ...(o.join ? { join: structuredClone(o.join) } : {}),
})

export const star = (n: number, m: K, r: K, o: ShapeSpec = {}): Shape => ({
  n,
  m: k(m),
  r: k(r),
  round: k(o.round ?? 0),
  twist: k(o.twist ?? 0),
  ...extras(o),
})

// one of iq's shapes beside the star, at size r with its form, which the FORMLESS drop (n: the stairs' steps)
export const shape = (kind: Exclude<ShapeKind, 'star'>, r: K, form: K, o: ShapeSpec & { n?: number } = {}): Shape => ({
  kind,
  n: o.n ?? 6,
  m: k(2),
  r: k(r),
  round: k(o.round ?? 0),
  twist: k(o.twist ?? 0),
  ...(FORMLESS.includes(kind) ? {} : { form: k(form) }),
  ...extras(o),
})

// a second shape smooth-unioned in, offset from the cell's middle
export const join = (s: Shape, offset: [K, K], blend: K, weight: K = 1): Join => ({
  shape: s,
  offset: [k(offset[0]), k(offset[1])],
  blend: k(blend),
  weight: k(weight),
})

type LevelSpec = {
  link?: string
  weight?: K
  scale?: K
  turn?: K
  offset?: [K, K]
  vary?: [VariationKind, K][]
  lattice?: LatticeKind
  e2?: [K, K]
  jitter?: K
  sectors?: number
  by?: Level['cell']['by']
  cellTurn?: K
  cellPhase?: K
  spill?: K
  shape?: Shape
  variants?: { share: K; shape: Shape; below?: Level[] }[]
  at?: K
  speed?: K
  cellSpread?: K
}

export function level(id: string, s: LevelSpec = {}): Level {
  const out: Level = {
    id,
    weight: k(s.weight ?? 1),
    affine: { scale: k(s.scale ?? 1), turn: k(s.turn ?? 0), offset: [k(s.offset?.[0] ?? 0), k(s.offset?.[1] ?? 0)] },
    variations: (s.vary ?? [['linear', 1]]).map(([kind, weight]) => ({ kind, weight: k(weight) })),
    lattice: { kind: s.lattice ?? 'oblique', e2: [k(s.e2?.[0] ?? SQUARE[0]), k(s.e2?.[1] ?? SQUARE[1])] },
    cell: {
      by: s.by ?? 'none',
      turn: k(s.cellTurn ?? 0),
      phase: k(s.cellPhase ?? 0),
      ...(s.spill === undefined ? {} : { spill: k(s.spill) }),
    },
    variants: (s.variants ?? [{ share: 1, shape: s.shape ?? star(6, 2, 0.4) }]).map((v) => ({
      share: k(v.share),
      shape: structuredClone(v.shape),
      ...(v.below ? { below: v.below } : {}),
    })),
    colour: { at: k(s.at ?? 0), speed: k(s.speed ?? 0.5), cellSpread: k(s.cellSpread ?? 0) },
  }
  if (s.jitter !== undefined) out.lattice.jitter = k(s.jitter)
  if (s.sectors !== undefined) out.lattice.sectors = s.sectors
  if (s.link) out.link = s.link
  return out
}

// count levels, the first the leader and the rest linked to it: they share its knobs, with its spreads across them
const linked = (prefix: string, count: number, s: LevelSpec) =>
  Array.from({ length: count }, (_, i) => level(`${prefix}${i + 1}`, i ? { ...s, link: `${prefix}1` } : s))

export const mod = (
  id: string,
  wave: Modulator['wave'],
  period: number,
  targets: [Address, number, number?][],
  o: { phase?: number; glide?: number; harmonics?: [number, number]; steps?: number[] } = {},
): Modulator => ({
  id,
  wave,
  period,
  phase: o.phase ?? 0,
  glide: o.glide ?? 0,
  ...(o.harmonics ? { harmonics: o.harmonics } : {}),
  ...(o.steps ? { steps: o.steps } : {}),
  targets: targets.map(([knob, depth, phaseSpread]) => ({
    knob,
    depth,
    ...(phaseSpread === undefined ? {} : { phaseSpread }),
  })),
})

type SceneSpec = {
  name: string
  zoom?: K
  turn?: K
  origin?: [K, K]
  levels: Level[]
  rings?: K
  drift?: K
  radialWeight?: K
  line?: Scene['line']['kind']
  width?: K
  falloff?: K
  units?: Scene['line']['units']
  dots?: { count: K; size: K; crawl: K }
  palette?: string
  hue?: K
  contrast?: K
  radius?: K
  time?: K
  composite?: Scene['composite']
  aa?: Scene['post']['aa']
  gamma?: K
  modulators?: Modulator[]
  macros?: Macro[]
  presets?: Preset[]
}

export const scene = (s: SceneSpec): Scene => ({
  name: s.name,
  frame: { origin: [k(s.origin?.[0] ?? 0), k(s.origin?.[1] ?? 0)], zoom: k(s.zoom ?? 1), turn: k(s.turn ?? 0) },
  levels: s.levels,
  contour: { rings: k(s.rings ?? 0), drift: k(s.drift ?? 0), radialWeight: k(s.radialWeight ?? 0) },
  line: {
    kind: s.line ?? 'glow',
    width: k(s.width ?? 0.0025),
    falloff: k(s.falloff ?? 1.2),
    units: s.units ?? 'cell',
    ...(s.dots
      ? { dots: { count: k(s.dots.count), size: k(s.dots.size), crawl: k(s.dots.crawl) } satisfies Dots }
      : {}),
  },
  palette: {
    stops: stopsFromCosine(s.palette ?? 'rainbow', 6),
    hue: k(s.hue ?? 0),
    contrast: k(s.contrast ?? 1),
    radius: k(s.radius ?? 0.4),
    time: k(s.time ?? 0),
  },
  composite: s.composite ?? 'add',
  post: { aa: s.aa ?? 2, gamma: k(s.gamma ?? 2.2) },
  modulators: s.modulators ?? [],
  macros: s.macros ?? [],
  presets: s.presets ?? [],
})

// a palette preset: a cosine preset's stops as preset values
const palettePreset = (name: string, cosine: string): Preset => ({
  name,
  values: Object.fromEntries(
    stopsFromCosine(cosine, 6).flatMap((s, i) => s.lch.map((c, j) => [`palette.stops[${i}].lch[${j}]`, c.value])),
  ),
})

const spokes = (n: number, r: number) => star(n, n, r)

export const LOOKS: Scene[] = [
  scene({
    name: 'Tapestry 1 - Rainbow hex rings',
    zoom: 1.78,
    levels: linked('sq', 4, {
      scale: { value: 1.75, play: [1.25, 2.25] },
      shape: star(6, 2, 0.5, { twist: 30 }),
      at: { value: 0, spread: 1 },
      speed: 0.35,
    }),
    rings: 1.9,
    drift: 0.25,
    falloff: 1.5,
    time: 1 / 3,
    gamma: 1,
    modulators: [
      mod('breathe', 'cos', 119, [['levels[sq1].affine.scale', 0.5]]),
      mod('size', 'tri', 17, [['levels[sq1].variants[0].shape.r', 0.4]]),
      mod('gain', 'cos', 69, [['contour.radialWeight', 2]]),
    ],
  }),
  scene({
    name: 'Tapestry 2 - Hexagram bands',
    zoom: 1.78,
    levels: [
      ...linked('star', 2, {
        scale: 1.75,
        shape: star(6, { value: 3, play: [2, 4.5] }, 0.5),
        at: 0,
        speed: 0.4,
        cellSpread: 0.15,
      }),
      ...linked('hex', 2, {
        scale: 1.75,
        shape: star(6, 2, 0.5, { twist: 30 }),
        at: 0.25,
        speed: 0.4,
        cellSpread: 0.15,
      }),
    ],
    rings: { value: 3.8, spread: -2.5 },
    drift: 0.25,
    line: 'band',
    width: { value: 0.012, spread: 0.03, play: [0.006, 0.02] },
    falloff: 0.3,
    time: 1 / 3,
    gamma: 1,
    modulators: [
      mod('breathe', 'cos', 119, [
        ['levels[star1].affine.scale', 0.5],
        ['levels[hex1].affine.scale', 0.5],
      ]),
      mod('size', 'tri', 17, [
        ['levels[star1].variants[0].shape.r', 0.35],
        ['levels[hex1].variants[0].shape.r', 0.35],
      ]),
      mod('gain', 'cos', 69, [['contour.radialWeight', 1.5]]),
    ],
  }),
  scene({
    name: 'Tapestry 3 - sdStar is fun',
    zoom: { value: 1.78, play: [1.5, 2.1] },
    levels: linked('st', 4, {
      scale: 1.5,
      variants: [4, 6, 8, 12].map((n) => ({ share: 0.25, shape: star(n, n - 0.1, 0.5, { round: 0.5 }) })),
      at: { value: 0, spread: 1 },
      speed: { value: 0.4, play: [0.2, 1] },
    }),
    radialWeight: 1,
    falloff: 1.1,
    gamma: 1,
    modulators: [
      mod('scale', 'cos', 30, [['levels[st1].affine.scale', 0.5]], { phase: 0.5 }),
      mod(
        'morph',
        'cos',
        7,
        [0, 1, 2, 3].map((v) => [`levels[st1].variants[${v}].shape.round`, 0.5, 0.5] as [Address, number, number]),
      ),
      mod(
        'size',
        'cos',
        11,
        [0, 1, 2, 3].map((v) => [`levels[st1].variants[${v}].shape.r`, 0.2] as [Address, number]),
      ),
      mod('gain', 'cos', 5, [['contour.radialWeight', 1]], { phase: 0.5 }),
      mod('hue', 'cos', 25, [['palette.hue', 20]], { phase: 0.25 }),
    ],
    presets: [
      {
        name: 'Green stars on red circles',
        // the first half of the palette green, the second red, and each level its own colour
        values: Object.fromEntries([
          ...[0, 1, 2, 3, 4, 5].flatMap((i) =>
            (i < 3 ? [0.82, 0.21, 145] : [0.6, 0.22, 25]).map((v, j) => [`palette.stops[${i}].lch[${j}]`, v]),
          ),
          ['levels[st1].colour.speed', 1],
        ]),
      },
      palettePreset('Embers', 'ember'),
    ],
  }),
  scene({
    name: 'Tapestry 4 - You spin me right round',
    zoom: 1.78,
    levels: [
      level('core', {
        scale: { value: 0.15, play: [0.1, 0.3] },
        variants: [4, 8, 12, 16].map((n) => ({ share: 0.25, shape: spokes(n, 0.5) })),
        at: 0,
      }),
      level('a1', {
        scale: { value: 1, spread: 4 },
        turn: 45,
        shape: spokes(4, 0.5),
        at: { value: 0.25, spread: 0.5 },
      }),
      level('b1', {
        scale: { value: 2, spread: 4 },
        turn: -45,
        shape: spokes(8, 0.5),
        at: { value: 0.5, spread: 0.5 },
      }),
      level('a2', { link: 'a1', scale: 3, turn: 45, shape: spokes(4, 0.5), at: 0.5 }),
      level('b2', { link: 'b1', scale: 4, turn: -45, shape: spokes(8, 0.5), at: 0.75 }),
    ],
    radialWeight: 1,
    line: 'smooth',
    width: { value: 0.004, spread: 0.03 },
    falloff: 1,
    radius: { value: 0.5, play: [0.2, 0.8] },
    modulators: [
      mod('spin', 'ramp', 283, [['frame.turn', 180]]),
      mod('pulse', 'cos', 30, [
        ['levels[a1].affine.scale', 0.12],
        ['levels[b1].affine.scale', 0.12],
      ]),
      mod(
        'morph',
        'cos',
        7,
        [0, 1, 2, 3].map((v) => [`levels[core].variants[${v}].shape.round`, 0.5] as [Address, number]),
      ),
      mod('gain', 'cos', 5, [['contour.radialWeight', 1]], { phase: 0.5 }),
      mod('hue', 'cos', 6.28, [['palette.hue', 90]]),
    ],
  }),
  scene({
    name: 'Tapestry 5 - Spatial distortions',
    zoom: 1.78,
    levels: [
      level('core', { scale: 0.15, shape: spokes(8, 0.5), at: 0 }),
      ...linked('w', 4, {
        scale: { value: 1, spread: 3 },
        turn: { value: 45, spread: 180 },
        vary: [
          ['linear', 1],
          ['radial', { value: 0.15, play: [0, 0.4] }],
        ],
        variants: [
          { share: 0.5, shape: spokes(4, 0.5) },
          { share: 0.5, shape: spokes(8, 0.5) },
        ],
        at: { value: 0.2, spread: 0.6 },
      }),
    ],
    radialWeight: 1.5,
    width: { value: 0.005, spread: -0.0035 },
    falloff: 1,
    palette: 'warm',
    radius: 0.5,
    modulators: [
      mod('sequence', 'steps', 10, [['levels[core].variants[0].shape.round', 0.5]], {
        steps: [0, 1, 0, 0],
        glide: 0.6,
      }),
      mod('rotate', 'steps', 10, [['levels[w1].affine.turn', 22.5]], { steps: [0, 0, 0.5, 1], glide: 0.8 }),
      mod('warp', 'cos', 30, [['levels[w1].variations[1].weight', 0.15]]),
      mod(
        'size',
        'beat',
        30,
        [
          ['levels[w1].variants[0].shape.r', 0.2],
          ['levels[w1].variants[1].shape.r', 0.2],
        ],
        { harmonics: [4, 3] },
      ),
      mod('gain', 'cos', 5, [['contour.radialWeight', 1]], { phase: 0.5 }),
      mod('hue', 'cos', 6.28, [['palette.hue', 60]]),
    ],
  }),
  scene({
    name: 'Tapestry 6 - Coloured layers',
    zoom: 1.78,
    levels: linked('c', 8, {
      scale: { value: 1.3, spread: -0.2 },
      turn: { value: 45, spread: 315 },
      shape: spokes(4, 0.5),
      at: { value: 0, spread: 1 },
      speed: { value: 0.6, play: [0.3, 0.9] },
      cellSpread: 0.2,
    }),
    line: 'smooth',
    width: { value: 0.003, spread: 0.026 },
    falloff: 1,
    radius: 0.3,
    contrast: { value: 1, play: [0.7, 1.3] },
    modulators: [
      mod('panX', 'cos', 45, [['frame.origin[0]', 0.3]]),
      mod('panY', 'cos', 45, [['frame.origin[1]', 0.3]], { phase: 0.14 }),
      mod('scale', 'beat', 36, [['levels[c1].affine.scale', 0.1]], { harmonics: [4, 3] }),
      mod('cross', 'tri', 7, [['levels[c1].variants[0].shape.r', 0.25]]),
      mod('hue', 'cos', 60, [['palette.hue', 180]]),
      mod('spread', 'cos', 29, [['levels[c1].colour.at', 0.3, 1]]),
    ],
  }),
  scene({
    name: 'Tapestry 7 - Hexes',
    levels: linked('h', 5, {
      scale: { value: 1.56, play: [1.35, 1.75] },
      turn: 30,
      e2: HEX,
      vary: [
        ['linear', 1],
        ['radial', { value: 0, spread: 0.12 }],
      ],
      shape: star(6, { value: 3.5, play: [1.01, 6] }, 0.35),
      at: { value: 0, spread: 1 },
      speed: 0.3,
    }),
    line: 'hard',
    width: { value: 0.004, spread: 0.02 },
    radius: 0.2,
    modulators: [
      mod('nest', 'cos', 36, [['levels[h1].affine.scale', 0.17]], { phase: 0.5 }),
      mod('warp', 'cos', 15, [['levels[h1].variations[1].weight', 0.05]]),
      mod('character', 'tri', 15, [['levels[h1].variants[0].shape.m', 2.5]], { phase: 0.25 }),
      mod('size', 'cos', 21, [['levels[h1].variants[0].shape.r', 0.23]], { phase: 0.4 }),
      mod('hue', 'cos', 60, [['palette.hue', 180]]),
      mod('radial', 'cos', 7, [['palette.radius', 0.1]]),
    ],
    presets: [palettePreset('Ice', 'ice'), palettePreset('Dusk', 'dusk')],
  }),
  scene({
    name: 'Tapestry 8 - Pinwheels',
    zoom: 1.6,
    levels: linked('p', 5, {
      scale: 1.9,
      turn: 30,
      e2: HEX,
      by: 'parity',
      cellTurn: { value: 0, spread: 150 },
      shape: star(6, { value: 3.5, play: [1.01, 6] }, 0.58),
      at: { value: 0, spread: 1 },
      speed: 0.4,
    }),
    line: 'hard',
    width: { value: 0.0028, spread: 0.012 },
    radius: 0.3,
    modulators: [
      mod('nest', 'cos', 36, [['levels[p1].affine.scale', 0.17]], { phase: 0.5 }),
      mod('pinwheel', 'beat', 60, [['levels[p1].cell.turn', 50]], { harmonics: [3, 2] }),
      mod('character', 'tri', 15, [['levels[p1].variants[0].shape.m', 2.5, 3.14]], { phase: 0.25 }),
      mod('size', 'cos', 21, [['levels[p1].variants[0].shape.r', 0.29]], { phase: 0.4 }),
      mod('hue', 'cos', 60, [['palette.hue', 180]]),
    ],
  }),
  scene({
    name: 'Tapestry 7b - Slower and offset',
    zoom: 2,
    origin: [0, -1],
    levels: linked('s', 5, {
      scale: { value: 1.47, spread: 0.3 },
      turn: 30,
      e2: HEX,
      vary: [
        ['linear', 1],
        ['radial', 0.04],
      ],
      shape: star(6, { value: 3, play: [1.01, 5] }, 0.39),
      at: { value: 0.5, spread: 1 },
      speed: 0.45,
      cellSpread: 0.3,
    }),
    line: 'hard',
    width: { value: 0.0025, spread: 0.0125 },
    composite: 'first',
    radius: 0.6,
    time: 1 / 65,
    modulators: [
      mod('nest', 'tri', 36, [['levels[s1].affine.scale', 0.13]], { phase: 0.5 }),
      mod('warp', 'tri', 21, [['levels[s1].variations[1].weight', 0.04]]),
      mod('size', 'tri', 33, [['levels[s1].variants[0].shape.r', 0.25]], { phase: 0.4 }),
      mod('character', 'tri', 21, [['levels[s1].variants[0].shape.m', 2, 0.5]], { phase: 0.25 }),
      mod('step', 'tri', 29, [['levels[s1].colour.at', 0.5]]),
      mod('gradient', 'beat', 17, [['palette.radius', 0.3]], { harmonics: [2, 3] }),
    ],
  }),
  // ---- remixes across levels ----
  scene({
    name: 'Remix - Square into hex',
    levels: [
      level('sq', { scale: 0.6, shape: star(6, 2, 0.42, { twist: 30 }), at: 0.1 }),
      level('hexA', { scale: 1.5, turn: 30, e2: HEX, shape: star(6, 3, 0.45), at: 0.4 }),
      level('hexB', { scale: R3, turn: 30, e2: HEX, shape: star(6, 2, 0.4), at: 0.7 }),
    ],
    rings: { value: 3, play: [1, 5] },
    drift: { value: 0.4, play: [0.1, 0.8] },
    falloff: 1.15,
    width: 0.0035,
    modulators: [
      mod('zoom', 'cos', 40, [['levels[sq].affine.scale', 0.1]]),
      mod('character', 'tri', 15, [['levels[hexA].variants[0].shape.m', 1.5]]),
      mod('hue', 'ramp', 50, [['palette.hue', 180]]),
    ],
  }),
  scene({
    name: 'Remix - Star ladder',
    levels: [
      level('four', { scale: 0.7, e2: HEX, shape: star(4, 3.9, 0.45, { round: 0.3 }), at: 0 }),
      level('six', { scale: R3, turn: 30, e2: HEX, shape: star(6, 5.9, 0.42, { round: 0.3 }), at: 0.33 }),
      level('eight', { scale: R3, turn: 30, e2: HEX, shape: star(8, 7.9, 0.4, { round: 0.3 }), at: 0.66 }),
    ],
    width: { value: 0.003, play: [0.002, 0.006] },
    radius: { value: 0.4, play: [0.1, 0.8] },
    modulators: [
      mod('morph', 'cos', 9, [
        ['levels[four].variants[0].shape.round', 0.3],
        ['levels[six].variants[0].shape.round', 0.3],
        ['levels[eight].variants[0].shape.round', 0.3],
      ]),
      mod('twist', 'tri', 40, [['levels[six].variants[0].shape.twist', 30]]),
      mod('hue', 'ramp', 30, [['palette.hue', 180]]),
    ],
  }),
  scene({
    name: 'Remix - Pinwheel crosses',
    levels: [
      level('wheel', { scale: 0.7, e2: HEX, by: 'parity', cellTurn: 15, shape: star(6, 3, 0.45), at: 0.05 }),
      level('cross', { scale: 2, turn: { value: 45, play: [30, 60] }, shape: spokes(4, 0.45), at: 0.4 }),
      level('hex', { scale: 2, e2: HEX, shape: star(6, 2, 0.4), at: 0.75 }),
    ],
    line: 'smooth',
    width: { value: 0.012, spread: 0.01 },
    falloff: 1,
    palette: 'warm',
    radius: { value: 0.4, play: [0.2, 0.7] },
    modulators: [
      mod('pinwheel', 'beat', 24, [['levels[wheel].cell.turn', 30]], { harmonics: [3, 2] }),
      mod('cross', 'tri', 7, [['levels[cross].variants[0].shape.r', 0.15]]),
      mod('hue', 'cos', 40, [['palette.hue', 40]]),
    ],
  }),
  scene({
    name: 'Remix - Swirled lattice',
    levels: [
      level('sw', {
        scale: 0.6,
        turn: 45,
        vary: [
          ['linear', 0.65],
          ['swirl', { value: 0.35, play: [0, 0.6] }],
        ],
        shape: star(4, 2, 0.45),
        at: 0,
      }),
      level('hexA', { scale: 1.6, turn: 30, e2: HEX, shape: star(6, 3, 0.45), at: 0.35 }),
      level('hexB', { scale: R3, turn: 30, e2: HEX, shape: star(6, 2, 0.4), at: 0.7 }),
    ],
    width: 0.003,
    palette: 'dusk',
    modulators: [
      mod('swirl', 'cos', 20, [['levels[sw].variations[1].weight', 0.3]]),
      mod('spin', 'ramp', 120, [['levels[sw].affine.turn', 180]]),
      mod('hue', 'cos', 33, [['palette.hue', 60]]),
    ],
  }),
  scene({
    name: 'Remix - Branching cells',
    zoom: { value: 0.9, play: [0.7, 1.2] },
    levels: [
      level('root', {
        scale: 0.55,
        turn: { value: 45, play: [30, 60] },
        variants: [
          {
            share: 0.5,
            shape: star(4, 2, 0.48, { twist: 45 }),
            below: [
              level('hexA', { scale: 1.8, turn: 30, e2: HEX, shape: star(6, 3, 0.45), at: 0.3 }),
              level('hexB', { scale: R3, turn: 30, e2: HEX, shape: star(6, 2, 0.4), at: 0.45 }),
            ],
          },
          {
            share: 0.5,
            shape: star(4, 2, 0.48, { twist: 45 }),
            below: [
              level('sqA', { scale: 2.2, shape: spokes(4, 0.45), at: 0.7 }),
              level('sqB', { scale: 2, turn: 45, shape: star(4, 2, 0.4), at: 0.85 }),
            ],
          },
        ],
        at: 0,
      }),
    ],
    width: 0.003,
    modulators: [
      mod('share', 'cos', 23, [['levels[root].variants[0].share', 0.4]]),
      mod('size', 'cos', 13, [['levels[root].variants[1].below[sqA].variants[0].shape.r', 0.15]]),
      mod('hue', 'ramp', 45, [['palette.hue', 180]]),
    ],
  }),
  scene({
    name: 'Remix - Square to hex',
    levels: [
      level('base', { scale: 0.8, e2: [0.25, 0.933], shape: star(6, 2, 0.45, { twist: 30 }), at: 0 }),
      ...linked('nest', 2, {
        scale: 1.57,
        turn: 37.5,
        e2: [0.25, 0.933],
        shape: star(6, 2, 0.4),
        at: { value: 0.3, spread: 0.6 },
      }),
    ],
    width: 0.004,
    falloff: 1.3,
    palette: 'ice',
    macros: [
      {
        id: 'lattice',
        name: 'Square to hex',
        value: 0.5,
        targets: [
          { knob: 'levels[base].lattice.e2[0]', from: 0, to: 0.5 },
          { knob: 'levels[base].lattice.e2[1]', from: 1, to: R3 / 2 },
          { knob: 'levels[nest1].lattice.e2[0]', from: 0, to: 0.5 },
          { knob: 'levels[nest1].lattice.e2[1]', from: 1, to: R3 / 2 },
          { knob: 'levels[nest1].affine.scale', from: Math.SQRT2, to: R3 },
          { knob: 'levels[nest1].affine.turn', from: 45, to: 30 },
        ],
      },
    ],
    modulators: [
      mod('character', 'tri', 19, [['levels[nest1].variants[0].shape.m', 1, 0.5]]),
      mod('hue', 'cos', 40, [['palette.hue', 90]]),
    ],
    presets: [
      {
        name: 'Square',
        values: {
          'levels[base].lattice.e2[0]': 0,
          'levels[base].lattice.e2[1]': 1,
          'levels[nest1].lattice.e2[0]': 0,
          'levels[nest1].lattice.e2[1]': 1,
          'levels[nest1].affine.scale': Math.SQRT2,
          'levels[nest1].affine.turn': 45,
        },
      },
      {
        name: 'Hex',
        values: {
          'levels[base].lattice.e2[0]': 0.5,
          'levels[base].lattice.e2[1]': R3 / 2,
          'levels[nest1].lattice.e2[0]': 0.5,
          'levels[nest1].lattice.e2[1]': R3 / 2,
          'levels[nest1].affine.scale': R3,
          'levels[nest1].affine.turn': 30,
        },
      },
    ],
  }),
  scene({
    name: 'Remix - Breathing lattice',
    levels: linked('b', 4, {
      scale: { value: 1.57, spread: 0.2 },
      turn: 37.5,
      e2: [0.25, 0.933],
      shape: star(6, { value: 2.5, play: [1.3, 4] }, 0.42, { twist: 30 }),
      at: { value: 0, spread: 1 },
      speed: 0.7,
    }),
    rings: 3,
    drift: 0.6,
    width: 0.003,
    palette: 'dusk',
    modulators: [
      mod('lattice', 'cos', 24, [
        ['levels[b1].lattice.e2[0]', 0.25, 0.4],
        ['levels[b1].lattice.e2[1]', -0.067, 0.4],
        ['levels[b1].affine.turn', 7.5, 0.4],
      ]),
      mod('character', 'tri', 17, [['levels[b1].variants[0].shape.m', 1.2, 0.8]]),
      mod('hue', 'ramp', 80, [['palette.hue', 180]]),
    ],
  }),
  // ---- the lattices: brick, triangles, polar, log-polar, fold, Voronoi, Truchet, the rhombic arc ----
  scene({
    name: 'Lattice - Rhombic walk',
    // e2 walks the arc from square to hex, (sin a, cos a) for a from 0 to 30°, fitted with cos φ and cos 2φ
    // terms that land on both ends, with the nesting from √2 at 45° to √3 at 30° beside it
    levels: linked('r', 4, {
      scale: 1.573,
      turn: 37.5,
      e2: [0.25, 0.9508],
      shape: star(6, { value: 2.5, play: [1.3, 4] }, 0.42, { twist: 30 }),
      at: { value: 0, spread: 1 },
      speed: 0.6,
    }),
    rings: 2,
    drift: 0.5,
    width: 0.003,
    palette: 'ice',
    modulators: [
      mod('walk', 'cos', 24, [
        ['levels[r1].lattice.e2[0]', -0.25],
        ['levels[r1].lattice.e2[1]', 0.067],
        ['levels[r1].affine.scale', -0.159],
        ['levels[r1].affine.turn', 7.5],
      ]),
      mod('bend', 'cos', 12, [['levels[r1].lattice.e2[1]', -0.0176]]),
      mod('character', 'tri', 17, [['levels[r1].variants[0].shape.m', 1.2, 0.8]]),
      mod('hue', 'ramp', 96, [['palette.hue', 180]]),
    ],
  }),
  scene({
    name: 'Lattice - Brick bond',
    zoom: 1.1,
    levels: [
      // bricks a cell long and half a cell high, two squares to each, the odd courses shifted from stack to
      // running bond and back
      level('wall', { scale: 1.3, lattice: 'brick', e2: [0.25, 0.5], shape: star(4, 2, 0.3, { twist: 45 }), at: 0 }),
      level('pair', {
        scale: 2,
        offset: [0.5, 0],
        shape: star(4, 2, 0.36, { twist: 45, round: 0.15 }),
        at: 0.3,
        cellSpread: 0.3,
      }),
      level('course', { scale: 2, lattice: 'brick', e2: [0.25, 0.7], shape: star(4, 2, 0.2, { twist: 45 }), at: 0.6 }),
    ],
    line: 'smooth',
    width: { value: 0.03, spread: -0.012 },
    falloff: { value: 1.5, play: [1.1, 1.8] },
    palette: 'ember',
    radius: { value: 0.25, play: [0.1, 0.5] },
    modulators: [
      mod('bond', 'cos', 16, [['levels[wall].lattice.e2[0]', 0.25]], { phase: 0.5 }),
      mod('stretch', 'tri', 22, [['levels[course].lattice.e2[1]', 0.2]]),
      mod('size', 'cos', 9, [['levels[pair].variants[0].shape.r', 0.08]]),
      mod('hue', 'cos', 41, [['palette.hue', 40]]),
    ],
  }),
  scene({
    name: 'Lattice - Triangle gears',
    zoom: 1.3,
    levels: linked('tri', 3, {
      scale: { value: 1.5, spread: 0.6 },
      lattice: 'triangle',
      e2: HEX,
      by: 'parity',
      cellTurn: { value: 0, spread: 60 },
      shape: star(3, { value: 2, play: [1.3, 3] }, 0.22, { round: 0.15 }),
      at: { value: 0, spread: 0.9 },
      speed: 0.5,
      cellSpread: 0.1,
    }),
    rings: 3,
    drift: 0.4,
    width: { value: 0.003, spread: 0.004 },
    falloff: 1.3,
    palette: 'warm',
    modulators: [
      mod('gears', 'beat', 30, [['levels[tri1].cell.turn', 60]], { harmonics: [3, 2] }),
      mod('character', 'tri', 13, [['levels[tri1].variants[0].shape.m', 0.7]]),
      mod('hue', 'ramp', 70, [['palette.hue', 180]]),
    ],
  }),
  scene({
    name: 'Lattice - Mandala',
    zoom: 0.55,
    levels: [
      level('petals', {
        lattice: 'polar',
        sectors: 12,
        e2: [0.25, 0.9],
        shape: star(6, 3, 0.4, { round: 0.2 }),
        at: 0,
        speed: 0.6,
      }),
      level('lace', { scale: 2.6, turn: 30, e2: HEX, shape: star(6, 2, 0.42, { twist: 30 }), at: 0.4 }),
      level('seed', { scale: R3, turn: 30, e2: HEX, shape: star(6, 4, 0.4), at: 0.7 }),
    ],
    rings: { value: 2, play: [1, 4] },
    drift: { value: 0.3, play: [0.1, 0.6] },
    radialWeight: 0.15,
    width: { value: 0.004, spread: 0.004 },
    palette: 'dusk',
    radius: 0.3,
    modulators: [
      mod('spin', 'ramp', 240, [['frame.turn', 180]]),
      mod('stagger', 'cos', 32, [['levels[petals].lattice.e2[0]', 0.25]]),
      mod('rings', 'cos', 21, [['levels[petals].lattice.e2[1]', 0.15]]),
      mod('character', 'tri', 15, [['levels[seed].variants[0].shape.m', 1.5]]),
      mod('hue', 'cos', 60, [['palette.hue', 60]]),
    ],
  }),
  scene({
    name: 'Lattice - Endless zoom',
    levels: [
      level('spiral', {
        scale: 2.1754,
        lattice: 'logpolar',
        sectors: 9,
        e2: [0.5, R3 / 2],
        shape: star(6, 2, 0.45, { twist: 30 }),
        at: 0,
        speed: 0.5,
      }),
      level('inner', { scale: R3, turn: 30, e2: HEX, shape: star(6, 3, 0.4), at: 0.5 }),
    ],
    rings: { value: 2.5, play: [1, 4] },
    drift: 0.4,
    width: { value: 0.006, spread: 0.002 },
    falloff: { value: 1.2, play: [0.9, 1.5] },
    palette: 'rainbow',
    radius: 0,
    modulators: [
      // a scale is a shift along log r: from 1 to e^(√3 · 2π / 9), one lattice vector (-1, 2) of the hex
      // pad, each ramp lands where it started, an endless zoom (quick at the start of each, as a modulator
      // adds to the scale and does not multiply it)
      mod('zoom', 'ramp', 20, [['levels[spiral].affine.scale', 1.1754]]),
      mod('spin', 'ramp', 90, [['levels[spiral].affine.turn', 180]]),
      mod('character', 'tri', 19, [['levels[inner].variants[0].shape.m', 1]]),
      mod('hue', 'ramp', 120, [['palette.hue', 180]]),
    ],
  }),
  scene({
    name: 'Lattice - Kaleidoscope',
    zoom: 1.5,
    levels: linked('k', 4, {
      scale: { value: 1.7, spread: 0.3 },
      turn: { value: 12, spread: 24 },
      lattice: 'fold',
      e2: [0.3, 0.9],
      shape: star(5, { value: 2.4, play: [1.5, 4] }, 0.3, { round: 0.2 }),
      at: { value: 0, spread: 1 },
      speed: 0.5,
    }),
    width: { value: 0.006, spread: 0.003 },
    falloff: 1.2,
    palette: 'dusk',
    radius: 0.2,
    modulators: [
      mod('turn', 'cos', 37, [['levels[k1].affine.turn', 20]]),
      mod('shift', 'cos', 23, [['levels[k1].lattice.e2[0]', 0.2]], { phase: 0.3 }),
      mod('reach', 'tri', 29, [['levels[k1].lattice.e2[1]', 0.25]]),
      mod('character', 'cos', 11, [['levels[k1].variants[0].shape.m', 1]]),
      mod('hue', 'ramp', 90, [['palette.hue', 180]]),
    ],
  }),
  scene({
    name: 'Lattice - Truchet',
    zoom: 0.8,
    // each hex cell turns its triangle either way by a hash of its id: up or down at 30°, and the turn
    // sways between 15° and 45° so the tiles never all line up
    levels: [
      level('tiles', {
        scale: 1.4,
        turn: 30,
        e2: HEX,
        by: 'hash',
        cellTurn: 30,
        shape: star(3, 2, 0.55, { round: 0.1 }),
        at: 0,
        speed: 0.6,
      }),
      level('weave', { scale: R3, turn: 30, e2: HEX, by: 'hash', cellTurn: 30, shape: star(3, 2, 0.5), at: 0.5 }),
    ],
    rings: 2,
    drift: { value: 0.3, play: [0.1, 0.6] },
    radialWeight: 0.2,
    width: { value: 0.005, spread: 0.003 },
    falloff: 1.3,
    palette: 'ice',
    radius: { value: 0.3, play: [0.1, 0.6] },
    modulators: [
      mod('sway', 'cos', 32, [['levels[tiles].cell.turn', 15]]),
      mod('weave', 'tri', 27, [['levels[weave].cell.turn', 15]], { phase: 0.5 }),
      mod('round', 'cos', 13, [['levels[tiles].variants[0].shape.round', 0.1]]),
      mod('hue', 'ramp', 50, [['palette.hue', 180]]),
    ],
  }),
  scene({
    name: 'Lattice - Organic cells',
    zoom: 0.7,
    levels: [
      level('cells', {
        scale: 1.2,
        turn: 30,
        lattice: 'voronoi',
        e2: HEX,
        jitter: { value: 0.45, play: [0, 0.9] },
        shape: star(6, 2, 0.3, { round: 0.8 }),
        at: 0,
        speed: 0.6,
        cellSpread: 0.5,
      }),
      level('nuclei', {
        scale: R3,
        turn: 30,
        lattice: 'voronoi',
        e2: HEX,
        jitter: 0.3,
        shape: star(6, 2, 0.35, { twist: 30 }),
        at: 0.5,
      }),
      level('grain', { scale: 2, e2: HEX, shape: star(6, 3, 0.4), at: 0.8 }),
    ],
    rings: 2,
    drift: 0.3,
    width: { value: 0.004, spread: 0.002 },
    palette: 'forest',
    radius: 0.25,
    modulators: [
      mod('grow', 'cos', 30, [['levels[cells].lattice.jitter', 0.45]]),
      mod('wobble', 'cos', 19, [['levels[nuclei].lattice.jitter', 0.3]], { phase: 0.5 }),
      mod('hue', 'cos', 44, [['palette.hue', 60]]),
    ],
    presets: [
      { name: 'Grid', values: { 'levels[cells].lattice.jitter': 0, 'levels[nuclei].lattice.jitter': 0 } },
      { name: 'Organic', values: { 'levels[cells].lattice.jitter': 0.9, 'levels[nuclei].lattice.jitter': 0.8 } },
    ],
  }),
  // ---- remixes across lattice kinds ----
  scene({
    name: 'Remix - Rose window',
    zoom: 0.6,
    levels: [
      level('rose', {
        lattice: 'polar',
        sectors: 8,
        e2: [0, 1.1],
        by: 'parity',
        cellTurn: 20,
        shape: star(8, 3, 0.45),
        at: 0,
        speed: 0.5,
      }),
      level('tracery', { scale: 2.2, lattice: 'fold', e2: [0.2, 0.7], shape: star(4, 2.5, 0.25), at: 0.35 }),
      level('glass', { scale: 2.4, lattice: 'triangle', e2: HEX, by: 'parity', cellTurn: 60, shape: star(3, 2, 0.2) }),
    ],
    width: { value: 0.004, spread: 0.002 },
    falloff: { value: 1.1, play: [0.8, 1.4] },
    palette: 'ember',
    radius: { value: 0.35, play: [0.15, 0.6] },
    modulators: [
      mod('turn', 'cos', 45, [['levels[rose].cell.turn', 20]]),
      mod('reach', 'cos', 27, [['levels[tracery].lattice.e2[1]', 0.15]]),
      mod('hue', 'ramp', 110, [['palette.hue', 180]]),
    ],
  }),
  scene({
    name: 'Remix - Spiral Truchet',
    levels: [
      level('arms', {
        lattice: 'logpolar',
        sectors: 12,
        e2: [0.25, 1],
        by: 'hash',
        cellTurn: 45,
        shape: star(3, 2, 0.55),
        at: 0,
        speed: 0.5,
        cellSpread: 0.3,
      }),
      level('cells', {
        scale: 2,
        lattice: 'voronoi',
        e2: HEX,
        jitter: 0.6,
        shape: star(6, 2, 0.35, { round: 0.6 }),
        at: 0.5,
      }),
    ],
    rings: { value: 2, play: [1, 4] },
    drift: { value: 0.6, play: [0.3, 0.9] },
    width: 0.005,
    palette: 'dusk',
    radius: 0,
    modulators: [
      // a log spiral turning reads as an endless zoom
      mod('zoom', 'ramp', 30, [['levels[arms].affine.turn', 180]]),
      mod('jitter', 'cos', 25, [['levels[cells].lattice.jitter', 0.3]]),
      mod('hue', 'cos', 64, [['palette.hue', 90]]),
    ],
  }),
  // ---- shapes and lines: iq's shapes, joins, corners and onions, spill, screen lines and dots ----
  scene({
    name: "Shapes - iq's garden",
    levels: [
      level('garden', {
        scale: 1.2,
        turn: 30,
        e2: HEX,
        variants: [
          { share: 0.25, shape: shape('heart', 0.3, 0.5) },
          { share: 0.25, shape: shape('moon', 0.34, { value: 0.5, play: [0.2, 0.8] }) },
          { share: 0.25, shape: shape('vesica', 0.38, 0.45) },
          { share: 0.25, shape: shape('pie', 0.32, { value: 0.75, play: [0.3, 1] }) },
        ],
        at: 0,
        cellSpread: 0.5,
      }),
      ...linked('bed', 2, {
        scale: R3,
        turn: 30,
        e2: HEX,
        variants: [
          { share: 0.25, shape: shape('box', 0.32, 0.7, { corner: 0.06 }) },
          { share: 0.25, shape: shape('cross', 0.36, 0.35) },
          { share: 0.25, shape: shape('ellipse', 0.36, 0.55) },
          { share: 0.25, shape: shape('roundX', 0.32, 0.4) },
        ],
        at: { value: 0.35, spread: 0.4 },
        speed: 0.6,
        cellSpread: 0.3,
      }),
    ],
    line: 'smooth',
    width: { value: 0.006, spread: 0.01 },
    falloff: 1,
    palette: 'warm',
    radius: 0.3,
    modulators: [
      mod('bite', 'cos', 13, [['levels[garden].variants[1].shape.form', 0.3]]),
      mod('open', 'tri', 17, [['levels[garden].variants[3].shape.form', 0.35]]),
      mod('spin', 'ramp', 90, [['levels[garden].affine.turn', 180]]),
      mod(
        'turn',
        'cos',
        21,
        [0, 1, 2, 3].map((v) => [`levels[bed1].variants[${v}].shape.twist`, 45, 0.5] as [Address, number, number]),
      ),
      mod('hue', 'cos', 40, [['palette.hue', 60]]),
    ],
  }),
  scene({
    name: 'Shapes - Marching ants',
    zoom: 1.3,
    levels: [
      level('ants', {
        scale: 0.6,
        by: 'parity',
        shape: shape('box', 0.38, 0.8, { corner: 0.08 }),
        at: 0,
        speed: 0.8,
        cellSpread: 0.7,
      }),
      level('crumbs', {
        scale: 2,
        turn: 45,
        by: 'parity',
        cellTurn: 45,
        shape: shape('cross', 0.4, 0.3, { corner: 0.04 }),
        at: 0.5,
        speed: 0.8,
        cellSpread: 0.4,
      }),
    ],
    line: 'dots',
    dots: { count: { value: 20, play: [8, 32] }, size: { value: 0.25, play: [0, 0.8] }, crawl: 1 },
    width: { value: 0.016, spread: 0.008 },
    falloff: 0.5,
    palette: 'rainbow',
    radius: 0.2,
    modulators: [
      mod('dash', 'cos', 16, [['line.dots.size', 0.25]]),
      mod('breathe', 'cos', 32, [['levels[ants].affine.scale', 0.08]]),
      mod('hue', 'cos', 48, [['palette.hue', 90]]),
    ],
    presets: [
      { name: 'Dashes', values: { 'line.dots.size': 0.75, 'line.dots.count': 10 } },
      { name: 'Pearls', values: { 'line.dots.size': 0, 'line.dots.count': 28, 'line.width': 0.012 } },
    ],
  }),
  scene({
    name: 'Shapes - Metaballs',
    zoom: 1.2,
    levels: [
      ...linked('blob', 2, {
        scale: { value: 0.8, spread: 1.4 },
        turn: { value: 0, spread: 30 },
        e2: HEX,
        spill: 1,
        shape: shape(
          'ellipse',
          0.17,
          { value: 0.8, play: [0.5, 1] },
          {
            onion: 0.015,
            join: join(star(6, 2, 0.12, { round: 1 }), [0.22, 0], { value: 0.05, play: [0.01, 0.1] }),
          },
        ),
        at: { value: 0, spread: 0.5 },
        speed: 0.6,
        cellSpread: 0.25,
      }),
    ],
    line: 'smooth',
    width: { value: 0.006, spread: 0.006 },
    falloff: 1,
    palette: 'ice',
    radius: 0.25,
    modulators: [
      mod('orbitX', 'cos', 12, [['levels[blob1].variants[0].shape.join.offset[0]', 0.2]]),
      mod('orbitY', 'cos', 12, [['levels[blob1].variants[0].shape.join.offset[1]', 0.2]], { phase: 0.25 }),
      mod('melt', 'tri', 23, [['levels[blob1].variants[0].shape.join.blend', 0.04]]),
      mod('hue', 'cos', 50, [['palette.hue', 70]]),
    ],
    presets: [
      { name: 'Apart', values: { 'levels[blob1].variants[0].shape.join.blend': 0 } },
      { name: 'Melted', values: { 'levels[blob1].variants[0].shape.join.blend': 0.12 } },
    ],
  }),
  scene({
    name: 'Shapes - Onion skins',
    zoom: 1.4,
    levels: [
      level('skin', {
        scale: 0.6,
        turn: 30,
        e2: HEX,
        shape: star(6, 3, 0.42, { corner: 0.03, onion: { value: 0.04, play: [0.01, 0.1] } }),
        at: 0,
      }),
      level('core', {
        scale: R3,
        turn: 30,
        e2: HEX,
        shape: shape('roundX', 0.3, 0.3, { onion: 0.025, twist: 15 }),
        at: 0.45,
      }),
    ],
    line: 'band',
    width: { value: 0.006, spread: 0.008 },
    falloff: 0.5,
    palette: 'ember',
    radius: 0.35,
    modulators: [
      mod('peel', 'cos', 9, [['levels[skin].variants[0].shape.onion', 0.04]]),
      mod('round', 'tri', 19, [['levels[skin].variants[0].shape.corner', 0.03]]),
      mod('twist', 'ramp', 60, [['levels[core].variants[0].shape.twist', 180]]),
      mod('hue', 'cos', 45, [['palette.hue', 40]]),
    ],
  }),
  scene({
    name: 'Shapes - Woven waves',
    zoom: { value: 1.1, play: [0.9, 1.4] },
    levels: [
      // at form .6 a wave's period is 2r: r .5 runs it seamless from cell to cell
      level('warp', {
        scale: 1.5,
        shape: shape('circleWave', 0.5, 0.6, { onion: { value: 0.03, play: [0.01, 0.05] } }),
        at: 0,
        cellSpread: 0.3,
      }),
      level('weft', { scale: 2, turn: 90, shape: shape('circleWave', 0.5, 0.6), at: 0.5, cellSpread: 0.3 }),
    ],
    line: 'smooth',
    width: { value: 0.01, spread: 0.006 },
    falloff: 1,
    palette: 'ice',
    radius: 0.2,
    modulators: [
      mod('flowA', 'ramp', 16, [['levels[warp].affine.offset[0]', 0.5]]),
      mod('flowB', 'ramp', 24, [['levels[weft].affine.offset[0]', -0.5]]),
      mod('ply', 'cos', 20, [['levels[warp].variants[0].shape.onion', 0.025]]),
      mod('hue', 'cos', 40, [['palette.hue', 60]]),
    ],
  }),
  scene({
    name: 'Shapes - Through the sphere',
    levels: [
      level('lens', {
        scale: 0.7,
        e2: HEX,
        vary: [
          ['linear', 0.25],
          ['spherical', { value: 0.75, play: [0.3, 1] }],
        ],
        variants: [
          { share: 0.5, shape: shape('arc', 0.4, 0.5) },
          { share: 0.5, shape: shape('segment', 0.4, 0.2) },
        ],
        at: 0,
        cellSpread: 0.6,
      }),
      level('grain', { scale: R3, turn: 30, e2: HEX, shape: star(6, 2, 0.38), at: 0.5 }),
    ],
    line: 'smooth',
    width: 0.003,
    falloff: 1,
    units: 'screen',
    palette: 'rainbow',
    radius: 0.2,
    modulators: [
      mod('lens', 'cos', 30, [['levels[lens].variations[1].weight', 0.25]]),
      mod('spin', 'ramp', 80, [['levels[lens].affine.turn', 180]]),
      mod('hue', 'ramp', 60, [['palette.hue', 180]]),
    ],
  }),
  scene({
    name: 'Shapes - Stairs and S',
    zoom: 1.2,
    levels: [
      level('steps', {
        scale: 1.4,
        e2: HEX,
        by: 'parity',
        cellTurn: 60,
        variants: [
          { share: 0.5, shape: shape('stairs', 0.32, 0.5, { n: 4 }) },
          { share: 0.5, shape: shape('coolS', 0.36, 0.5) },
        ],
        at: 0,
        cellSpread: 0.4,
      }),
      level('flecks', {
        scale: R3,
        turn: 30,
        e2: HEX,
        shape: shape('blobbyCross', 0.25, { value: 0.3, play: [0, 1] }),
        at: 0.5,
      }),
    ],
    line: 'hard',
    width: { value: 0.006, spread: 0.008 },
    palette: 'warm',
    radius: 0.3,
    modulators: [
      mod('turn', 'beat', 24, [['levels[steps].cell.turn', 30]], { harmonics: [3, 2] }),
      mod('blob', 'cos', 14, [['levels[flecks].variants[0].shape.form', 0.4]]),
      mod('hue', 'cos', 36, [['palette.hue', 90]]),
    ],
  }),
  scene({
    name: 'Remix - Dotted hexes',
    zoom: 1.4,
    levels: linked('d', 3, {
      scale: { value: 1.56, play: [1.35, 1.75] },
      turn: 30,
      e2: HEX,
      shape: star(6, { value: 3.5, play: [1.01, 6] }, 0.35),
      at: { value: 0, spread: 1 },
      speed: 0.3,
    }),
    line: 'dots',
    dots: { count: { value: 24, spread: -12 }, size: 0.3, crawl: 0.5 },
    width: { value: 0.012, spread: 0.012 },
    falloff: 0.5,
    radius: 0.2,
    modulators: [
      mod('nest', 'cos', 36, [['levels[d1].affine.scale', 0.17]], { phase: 0.5 }),
      mod('character', 'tri', 15, [['levels[d1].variants[0].shape.m', 2.5]], { phase: 0.25 }),
      mod('dash', 'cos', 20, [['line.dots.size', 0.35]]),
      mod('hue', 'cos', 60, [['palette.hue', 180]]),
    ],
  }),
]

// The built-in bank: every look and preset above, the Tapestries in a ring and the lattices and the shapes in
// others, each preset beside its look, and each remix, lattice and shape linked to the looks it draws on.
const named = (start: string) => LOOKS.find((l) => l.name.startsWith(start))!.name
const T = (n: string) => named(`Tapestry ${n} `)
const remix = (n: string) => named(`Remix - ${n}`)
const lattice = (n: string) => named(`Lattice - ${n}`)
const shapes = (n: string) => named(`Shapes - ${n}`)
const ring = ['1', '2', '3', '4', '5', '6', '7', '8', '7b'].map(T)
const lattices = [
  'Rhombic walk',
  'Brick bond',
  'Triangle gears',
  'Mandala',
  'Endless zoom',
  'Kaleidoscope',
  'Truchet',
  'Organic cells',
].map(lattice)
const shapeRing = [
  "iq's garden",
  'Marching ants',
  'Metaballs',
  'Onion skins',
  'Woven waves',
  'Through the sphere',
  'Stairs and S',
].map(shapes)
export const BANK: Bank = {
  scenes: LOOKS.flatMap((l) => [l.name, ...l.presets.map((p) => entryName(l.name, p.name))]),
  links: [
    ...[ring, lattices, shapeRing].flatMap((r) => r.map((name, i): [string, string] => [name, r[(i + 1) % r.length]])),
    ...LOOKS.flatMap((l) => {
      const presets = l.presets.map((p) => entryName(l.name, p.name))
      return presets.flatMap((p, i): [string, string][] =>
        i
          ? [
              [l.name, p],
              [presets[i - 1], p],
            ]
          : [[l.name, p]],
      )
    }),
    [remix('Square into hex'), T('1')],
    [remix('Square into hex'), T('7')],
    [remix('Star ladder'), T('2')],
    [remix('Star ladder'), T('3')],
    [remix('Pinwheel crosses'), T('6')],
    [remix('Pinwheel crosses'), T('8')],
    [remix('Swirled lattice'), T('5')],
    [remix('Swirled lattice'), T('7b')],
    [remix('Branching cells'), T('4')],
    [remix('Branching cells'), remix('Square into hex')],
    [remix('Square to hex'), T('7')],
    [remix('Square to hex'), remix('Breathing lattice')],
    [entryName(remix('Square to hex'), 'Square'), T('1')],
    [entryName(remix('Square to hex'), 'Hex'), T('7')],
    [remix('Breathing lattice'), T('7b')],
    [remix('Breathing lattice'), T('1')],
    [lattice('Rhombic walk'), remix('Square to hex')],
    [lattice('Brick bond'), T('1')],
    [lattice('Triangle gears'), T('7')],
    [lattice('Mandala'), T('4')],
    [lattice('Endless zoom'), T('5')],
    [lattice('Kaleidoscope'), T('6')],
    [lattice('Truchet'), T('8')],
    [lattice('Organic cells'), remix('Branching cells')],
    [remix('Rose window'), lattice('Mandala')],
    [remix('Rose window'), lattice('Kaleidoscope')],
    [remix('Spiral Truchet'), lattice('Truchet')],
    [remix('Spiral Truchet'), lattice('Endless zoom')],
    [shapes("iq's garden"), T('3')],
    [shapes('Through the sphere'), T('5')],
    [remix('Dotted hexes'), T('7')],
    [remix('Dotted hexes'), shapes('Marching ants')],
  ],
  autopilot: {
    // a keyframe every 2 beats, as long as a change takes: it never rests, passing through each on its curve
    on: true,
    every: 2,
    busy: 0.35,
    change: 0.25,
    wander: 0.15,
    edge: { seconds: 2, stagger: 0.4, deepFirst: false },
  },
  moods: [],
}
