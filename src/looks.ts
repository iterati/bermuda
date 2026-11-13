// The built-in looks: four Tapestries made through the level chain, the bank's twenty remixing them, then older remixes,
// then the deco family's fills and its halftones, then the two made for the music.
// Periods are in clock units, one a second at the default 60 bpm; angles are in degrees. Each is wired to the music
// (music.ts wire) but the two made for it, each wired its own way.
import { stopsFromCosine } from './colour'
import { update } from './motion'
import { blend, wire } from './music'
import { FORMLESS, kindOf, knobKind, knobsOf, playRange } from './scene'
import type {
  Address,
  Bank,
  Dots,
  Fill,
  Halftone,
  Join,
  Knob,
  LatticeKind,
  Level,
  Listen,
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
  fill?: Fill
  halftone?: Halftone
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
  if (s.fill) out.fill = structuredClone(s.fill)
  if (s.halftone) out.halftone = structuredClone(s.halftone)
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
  o: { phase?: number; glide?: number; harmonics?: [number, number]; steps?: number[]; listen?: Listen } = {},
): Modulator => ({
  id,
  wave,
  period,
  phase: o.phase ?? 0,
  glide: o.glide ?? 0,
  ...(o.harmonics ? { harmonics: o.harmonics } : {}),
  ...(o.steps ? { steps: o.steps } : {}),
  ...(o.listen ? { listen: o.listen } : {}),
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
  palette?: string | Scene['palette']['stops'] // a cosine preset's name, or the stops themselves
  hue?: K
  contrast?: K
  radius?: K
  time?: K
  trap?: { weight: K; size: K }
  field?: Scene['palette']['field']
  composite?: Scene['composite']
  aa?: Scene['post']['aa']
  gamma?: K
  modulators?: Modulator[]
  macros?: Macro[]
  presets?: Preset[]
  background?: Scene['background']
  loop?: number // seconds
}

export const scene = (s: SceneSpec): Scene => ({
  name: s.name,
  ...(s.background ? { background: s.background } : {}),
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
    stops: typeof s.palette === 'object' ? s.palette : stopsFromCosine(s.palette ?? 'rainbow', 6),
    hue: k(s.hue ?? 0),
    contrast: k(s.contrast ?? 1),
    radius: k(s.radius ?? 0.4),
    time: k(s.time ?? 0),
    ...(s.trap ? { trap: { weight: k(s.trap.weight), size: k(s.trap.size) } } : {}),
    ...(s.field ? { field: s.field } : {}),
  },
  composite: s.composite ?? 'add',
  post: { aa: s.aa ?? 2, gamma: k(s.gamma ?? 2.2) },
  modulators: s.modulators ?? [],
  macros: s.macros ?? [],
  presets: s.presets ?? [],
  ...(s.loop ? { loop: { seconds: s.loop } } : {}),
})

// a background of kind under the lines, its colours round the palette from at
export const background = (
  kind: NonNullable<Scene['background']>['kind'],
  amount: K = 0.6,
  at: [K, K] = [0.1, 0.6],
): NonNullable<Scene['background']> => ({
  kind,
  at: [k(at[0]), k(at[1])],
  amount: k(amount),
  turn: k(30),
  scale: k(0.6),
  edge: k(0.5),
  seep: k(0.2),
})

// a fill under the lines: solid, with no line over it, a light from the upper left and a shadow half way round the
// palette, unless the spec says otherwise
export const fill = (s: Partial<Record<Exclude<keyof Fill, 'front'>, K>> & { front?: true } = {}): Fill => ({
  amount: k(s.amount ?? 1),
  line: k(s.line ?? 0),
  tone: k(s.tone ?? 0),
  bands: k(s.bands ?? 0),
  step: k(s.step ?? 0),
  metal: k(s.metal ?? 0),
  light: k(s.light ?? 135),
  shade: k(s.shade ?? 0.5),
  ramp: k(s.ramp ?? 0),
  alternate: k(s.alternate ?? 0),
  ...(s.front ? { front: true } : {}),
})

// a level drawn as dots on its own lattice, 8 a cell, each dimmed most of the way as it shrinks, unless the spec says
// otherwise
export const halftone = (
  s: Partial<Record<Exclude<keyof Halftone, 'grid'>, K>> & { grid?: Halftone['grid'] } = {},
): Halftone => ({
  amount: k(s.amount ?? 1),
  grid: s.grid ?? 'lattice',
  pitch: k(s.pitch ?? 8),
  size: k(s.size ?? 1),
  fade: k(s.fade ?? 0.6),
  turn: k(s.turn ?? 0),
  reach: k(s.reach ?? 0),
})

// a palette of OKLCh stops (lightness, chroma, hue) evenly round the index, each segment mixed the one way
const stops = (lch: [number, number, number][], mix: Scene['palette']['stops'][number]['mix'] = 'short') =>
  lch.map(([L, C, h], i) => ({ at: i / lch.length, lch: [k(L), k(C), k(h)] as [Knob, Knob, Knob], mix }))

// a palette preset: a cosine preset's stops as preset values
const palettePreset = (name: string, cosine: string): Preset => ({
  name,
  values: Object.fromEntries(
    stopsFromCosine(cosine, 6).flatMap((s, i) => s.lch.map((c, j) => [`palette.stops[${i}].lch[${j}]`, c.value])),
  ),
})

const spokes = (n: number, r: number) => star(n, n, r)
// the deco stops: jet, gold, cream and teal
const DECO: [number, number, number][] = [
  [0.16, 0.01, 260],
  [0.78, 0.13, 85],
  [0.95, 0.03, 90],
  [0.55, 0.09, 195],
]

// A look's default macros, the Perform strip's first knobs, for the groups its knobs move together: Breathe the
// levels' scale (those a modulator on the clock moves, else every level's), Morph the rounds and Character the
// stars' m such a modulator moves (or, for m, a play range), Size every shape's r, Hue the palette's hue, and Gain
// the radial weight where such a modulator moves it. Each runs its knobs either side of the look's value, inside
// their play ranges, so at its own value, 0.5, it moves nothing; a Morph of rounds all 0 runs them 0 to 1 from 0. A
// linked level plays its leader's knobs, so it is left out, and so is a knob a macro of the look holds already.
function defaults(look: Scene): Macro[] {
  const moved = (address: Address) =>
    look.modulators.some((m) => !m.listen && m.targets.some((t) => t.knob === address))
  const held = new Set(look.macros.flatMap((m) => m.targets.map((t) => t.knob)))
  const free = knobsOf(look).filter((k) => !k.level?.level.link && !held.has(k.address))
  const of = (kind: string) => free.filter((k) => kindOf(k.address) === kind)
  const scales = of('levels[].affine.scale')
  const groups: [string, typeof free, (v: number) => number][] = [
    ['Breathe', scales.some((k) => moved(k.address)) ? scales.filter((k) => moved(k.address)) : scales, (v) => v / 4],
    ['Morph', of('levels[].variants[].shape.round').filter((k) => moved(k.address)), () => 0.5],
    [
      'Character',
      // a star's m alone: no other kind reads it
      of('levels[].variants[].shape.m').filter(
        (k) => (moved(k.address) || k.knob.play) && knobKind(k.address).shows!(look, k),
      ),
      () => 2,
    ],
    ['Size', of('levels[].variants[].shape.r'), (v) => 0.4 * v],
    ['Hue', of('palette.hue'), () => 180],
    ['Gain', of('contour.radialWeight').filter((k) => moved(k.address)), () => 1.5],
  ]
  return groups.flatMap(([name, knobs, span]) => {
    if (name === 'Morph' && knobs.length && knobs.every((k) => k.knob.value === 0))
      return [{ id: 'morph', name, value: 0, targets: knobs.map((k) => ({ knob: k.address, from: 0, to: 1 })) }]
    const targets = knobs.flatMap(({ address, knob }) => {
      const v = knob.value
      const [lo, hi] = playRange(address, knob)
      const s = Math.min(span(v), v - lo, hi - v)
      return s > 1e-9 ? [{ knob: address, from: v - s, to: v + s }] : []
    })
    return targets.length ? [{ id: name.toLowerCase(), name, value: 0.5, targets }] : []
  })
}

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
    presets: [
      palettePreset('Ice', 'ice'),
      palettePreset('Dusk', 'dusk'),
      {
        // Tapestry 7b, merged in: the nest further in and lower, its colours from the palette's other half
        name: 'Offset',
        values: {
          'frame.zoom': 2,
          'frame.origin[1]': -1,
          'levels[h1].affine.scale': 1.47,
          'levels[h1].variations[1].weight': 0.04,
          'levels[h1].variants[0].shape.m': 3,
          'levels[h1].variants[0].shape.r': 0.39,
          'levels[h1].colour.at': 0.5,
          'levels[h1].colour.speed': 0.45,
          'levels[h1].colour.cellSpread': 0.3,
          'line.width': 0.0025,
          'palette.radius': 0.6,
          'palette.time': 1 / 65,
        },
      },
    ],
  }),
  // ---- the bank's twenty: each takes an idea and remixes it with others ----
  scene({
    name: 'Hypnotic rings',
    // one cell as wide as the screen: a star's echo rings run out round the centre, a polar grid of pies over them;
    // where the zoom breathes out past the cell's edges, the cells mirror, so the rings and pies fold back there
    levels: [
      level('target', {
        scale: 0.3,
        by: 'mirror',
        shape: star(5, { value: 1.6, play: [1.2, 2.2] }, 0.08, { round: 0.3 }),
        at: 0,
        speed: 0.5,
      }),
      level('wheel', {
        lattice: 'polar',
        sectors: 12,
        e2: [0.5, 0.6],
        shape: shape('pie', 0.3, 0.15),
        at: 0.5,
        speed: 0.5,
      }),
    ],
    rings: { value: 24, play: [12, 24] },
    drift: -2,
    line: 'band',
    width: 0.006,
    falloff: 0.6,
    palette: stops([
      [0.05, 0, 0],
      [0.95, 0.02, 90],
      [0.55, 0.22, 25],
      [0.95, 0.02, 90],
    ]),
    radius: 0.5,
    gamma: 1,
    modulators: [
      mod('twist', 'ramp', 30, [['levels[target].variants[0].shape.twist', 180]]),
      mod('wheel', 'ramp', 50, [['levels[wheel].affine.turn', -180]]),
      mod('breathe', 'cos', 20, [['frame.zoom', 0.2]]),
    ],
  }),
  scene({
    name: 'Pinwheel rings',
    // Tapestry 8's pinwheels round a polar grid: rings of triangles, each turning against the ones beside it
    levels: [
      level('wheel', {
        scale: 2.5,
        lattice: 'polar',
        sectors: 12,
        e2: [0, 1],
        by: 'parity',
        cellTurn: { value: 0, play: [-40, 40] },
        shape: shape('triangle', 0.45, { value: 0.5, play: [0.3, 0.8] }),
        at: 0.1,
        speed: 0.6,
        cellSpread: 0.15,
      }),
      level('seeds', { scale: 2, e2: HEX, by: 'parity', cellTurn: 30, weight: 0.5, shape: star(3, 2, 0.25), at: 0.4 }),
    ],
    line: 'smooth',
    width: { value: 0.02, spread: -0.008 },
    falloff: 1,
    palette: 'warm',
    radius: { value: 0.35, play: [0.15, 0.6] },
    modulators: [
      mod('pinwheel', 'beat', 30, [['levels[wheel].cell.turn', 35]], { harmonics: [3, 2] }),
      mod('spin', 'ramp', 90, [['frame.turn', 180]]),
      mod('hue', 'cos', 40, [['palette.hue', 30]]),
    ],
  }),
  scene({
    name: 'Spirograph',
    // eight ellipses round each cell, each level turned 22.5° on the one above (Tapestry 6's layers), so they
    // fan out into a rosette that opens and closes
    levels: linked('loop', 8, {
      scale: 1,
      turn: { value: 22.5, play: [10, 45] },
      shape: shape('ellipse', 0.46, { value: 0.3, play: [0.15, 0.6] }),
      at: { value: 0, spread: 1 },
      speed: 0.8,
    }),
    zoom: 0.55,
    width: { value: 0.004, spread: 0.006 },
    falloff: 1.2,
    palette: 'rainbow',
    radius: 0.3,
    time: 0.04,
    modulators: [
      mod('fan', 'cos', 32, [['levels[loop1].affine.turn', 12]]),
      mod('fat', 'cos', 13, [['levels[loop1].variants[0].shape.form', 0.15]]),
      mod('spin', 'ramp', 60, [['frame.turn', 180]]),
    ],
    macros: [
      {
        id: 'open',
        name: 'Closed to open',
        value: 12.5 / 35,
        targets: [{ knob: 'levels[loop1].affine.turn', from: 10, to: 45 }],
      },
    ],
  }),
  scene({
    name: 'Atoms',
    // three orbits turned 60° apart round each nucleus, an electron round each, smooth-unioned into its orbit
    levels: [
      level('nucleus', {
        scale: { value: 1.4, play: [1.1, 1.8] },
        turn: 30,
        e2: HEX,
        shape: star(6, 2, 0.05, { round: 1 }),
        at: 0.1,
        speed: 0.6,
        cellSpread: 0.2,
      }),
      ...linked('orbit', 3, {
        turn: 60,
        shape: shape(
          'ellipse',
          0.42,
          { value: 0.3, play: [0.2, 0.45] },
          {
            join: join(star(6, 2, 0.045, { round: 1 }), [0, 0], 0.01),
          },
        ),
        at: { value: 0.3, spread: 0.6 },
        speed: 0.7,
      }),
    ],
    line: 'glow',
    width: { value: 0.003, spread: 0.002 },
    falloff: 1.3,
    palette: stops([
      [0.7, 0.16, 210],
      [0.75, 0.2, 330],
      [0.9, 0.1, 100],
      [0.65, 0.18, 280],
    ]),
    radius: { value: 0.3, play: [0, 0.6] },
    gamma: 1.8,
    background: background('flat', 0.08, [0.75, 0.75]),
    modulators: [
      mod('orbitX', 'cos', 3, [['levels[orbit1].variants[0].shape.join.offset[0]', 0.126, 1]]),
      mod('orbitY', 'cos', 3, [['levels[orbit1].variants[0].shape.join.offset[1]', 0.42, 1]], { phase: 0.25 }),
      mod('excite', 'cos', 23, [['levels[orbit1].affine.turn', 10]]),
      mod('hue', 'cos', 40, [['palette.hue', 40]]),
    ],
  }),
  scene({
    name: 'Clockwork',
    // gears in a square grid: parity turns each one against its neighbours, half a tooth apart, and the tick's
    // eight steps run round 60°, where the 12 teeth and the 6 spokes are themselves again
    background: background('flat', 0.12, [0, 0]),
    levels: [
      level('gear', {
        scale: { value: 2.6, play: [2, 3.2] },
        by: 'parity',
        cellTurn: 7.5,
        shape: star(12, { value: 1.4, play: [1.3, 1.6] }, 0.4, { corner: 0.03 }),
        at: 0.25,
        speed: 0.6,
        cellSpread: 0.15,
      }),
      level('spokes', { shape: star(6, 6, { value: 0.3, play: [0.25, 0.34] }), at: 0.5, speed: 0.5 }),
      level('hub', { shape: star(6, 2, 0.08, { onion: 0.02 }), at: 0.75, speed: 0.6 }),
    ],
    line: 'hard',
    width: { value: 0.012, spread: -0.004 },
    palette: stops([
      [0.35, 0.07, 55],
      [0.72, 0.13, 78],
      [0.88, 0.1, 92],
      [0.58, 0.13, 45],
    ]),
    radius: 0.15,
    modulators: [
      mod('tick', 'steps', 8, [['levels[gear].cell.turn', 30]], {
        steps: [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875],
      }),
      mod('drift', 'cos', 60, [['frame.origin[0]', 0.4]]),
      mod('tilt', 'cos', 45, [['frame.turn', 8]]),
    ],
  }),
  scene({
    name: 'Snowflakes',
    // a hex grid of flakes, each six arms round its middle (polar), branched by two folds (KIFS)
    levels: [
      level('flake', {
        scale: 1.1,
        turn: 30,
        e2: HEX,
        by: 'hash',
        cellTurn: 15,
        shape: star(6, 2, 0.12),
        at: 0.55,
        speed: 0.4,
      }),
      level('arm', {
        lattice: 'polar',
        sectors: 6,
        e2: [0, 2],
        shape: shape('segment', 0.4, 0.15),
        at: 0.6,
        speed: 0.4,
      }),
      ...linked('branch', 2, {
        scale: { value: 3, spread: 2 },
        lattice: 'fold',
        e2: [{ value: 0.2, play: [0.1, 0.35] }, 0.5],
        shape: star(6, { value: 3, play: [2, 5] }, 0.2),
        at: { value: 0.7, spread: 0.2 },
        speed: 0.6,
      }),
    ],
    width: { value: 0.006, spread: 0.01 },
    falloff: 1.3,
    palette: stops([
      [0.95, 0.03, 230],
      [0.75, 0.1, 235],
      [0.85, 0.08, 200],
      [0.6, 0.12, 260],
    ]),
    radius: 0.15,
    gamma: 1.6,
    modulators: [
      mod('grow', 'cos', 19, [['levels[branch1].lattice.e2[0]', 0.1]]),
      mod('fall', 'tri', 64, [['frame.origin[1]', 2]]),
      mod('turn', 'cos', 41, [['levels[flake].cell.turn', 30]]),
    ],
  }),
  scene({
    name: 'Nested triangles',
    // triangles inside triangles, three deep: each level halves the one above and turns its down cells (parity)
    zoom: 0.9,
    levels: linked('t', 3, {
      scale: { value: 2, play: [1.8, 2.2] },
      lattice: 'triangle',
      e2: HEX,
      by: 'parity',
      cellTurn: 60,
      shape: star(3, 2, { value: 0.3, play: [0.2, 0.36] }),
      at: { value: 0, spread: 1 },
      speed: 0.5,
    }),
    line: 'hard',
    width: { value: 0.01, spread: 0.01 },
    palette: 'dusk',
    radius: 0.2,
    time: 0.05,
    modulators: [
      mod('breathe', 'cos', 30, [['levels[t1].affine.scale', 0.15]]),
      mod('size', 'cos', 13, [['levels[t1].variants[0].shape.r', 0.06, 1]]),
      mod('spin', 'ramp', 180, [['frame.turn', 180]]),
    ],
  }),
  scene({
    name: 'Patchwork quilt',
    // a square of fabric a cell, each patch picking its own weave by share: brick, triangles, hexes or
    // rings round its middle (polar), stitched with dashes
    levels: [
      level('patch', {
        scale: { value: 1.4, play: [1.1, 1.8] },
        by: 'hash',
        cellTurn: 90,
        variants: [
          {
            share: 0.25,
            shape: shape('box', 0.47, 1),
            below: [
              level('brick', { scale: 4, lattice: 'brick', e2: [0.5, 0.5], shape: shape('box', 0.22, 0.4), at: 0.1 }),
            ],
          },
          {
            share: 0.25,
            shape: shape('box', 0.47, 1),
            below: [
              level('tris', {
                scale: 3,
                lattice: 'triangle',
                e2: HEX,
                by: 'parity',
                cellTurn: 60,
                shape: star(3, 2, 0.22),
                at: 0.35,
              }),
            ],
          },
          {
            share: 0.25,
            shape: shape('box', 0.47, 1),
            below: [level('hexes', { scale: 3.5, turn: 30, e2: HEX, shape: star(6, 3, 0.4), at: 0.6 })],
          },
          {
            share: 0.25,
            shape: shape('box', 0.47, 1),
            below: [
              level('target', {
                scale: 4,
                lattice: 'polar',
                sectors: 8,
                e2: [0.5, 0.5],
                shape: shape('cross', 0.15, 0.3),
                at: 0.85,
              }),
            ],
          },
        ],
        at: 0.5,
        speed: 0.6,
        cellSpread: 0.2,
      }),
    ],
    line: 'dots',
    dots: { count: { value: 24, play: [16, 40] }, size: { value: 0.5, play: [0.3, 0.7] }, crawl: 0.25 },
    width: { value: 0.035, spread: -0.01 },
    falloff: 0.5,
    palette: stops([
      [0.45, 0.1, 255],
      [0.78, 0.13, 85],
      [0.55, 0.13, 35],
      [0.92, 0.03, 90],
    ]),
    radius: 0.15,
    modulators: [
      mod('pan', 'cos', 30, [['frame.origin[0]', 0.6]]),
      mod('weave', 'cos', 20, [['levels[patch].variants[0].share', 0.2]]),
      mod('hue', 'cos', 60, [['palette.hue', 30]]),
    ],
  }),
  scene({
    name: 'Diagonal maze',
    // 10 PRINT: an upright segment corner to corner in each square, turned 45° either way by a hash of the cell
    // (Truchet), its echo rings the maze's corridors, each the nearest of its own cell's and its neighbours' (spill),
    // so they run on across the cells' edges. The inner maze is at rest: in the turned cells it would part at their
    // edges
    levels: [
      level('maze', {
        scale: { value: 3, play: [2.5, 4] },
        by: 'hash',
        cellTurn: 45,
        spill: 1,
        shape: shape('segment', 0.7071, 0.1),
        at: 0.3,
        speed: 0.5,
        cellSpread: 0.15,
      }),
      level('inner', {
        scale: 2,
        by: 'hash',
        cellTurn: 45,
        weight: 0,
        shape: shape('segment', 0.7071, 0.1),
        at: 0.65,
        speed: 0.6,
      }),
    ],
    rings: { value: 2, play: [1, 3] },
    drift: 0.8,
    line: 'smooth',
    width: { value: 0.03, spread: 0.01, play: [0.02, 0.05] },
    falloff: 1.2,
    palette: stops([
      [0.25, 0.08, 150],
      [0.6, 0.18, 145],
      [0.92, 0.14, 130],
      [0.7, 0.12, 175],
    ]),
    radius: 0.2,
    modulators: [mod('zoom', 'cos', 48, [['frame.zoom', 0.15]]), mod('hue', 'cos', 60, [['palette.hue', 25]])],
  }),
  scene({
    name: 'Op art bricks',
    // Bridget Riley in black and white: concentric squares in brick courses, the courses sliding against each
    // other and the whole wall bulging through a bubble
    levels: [
      level('wall', {
        scale: 3,
        lattice: 'brick',
        e2: [0.25, 0.5],
        vary: [
          ['linear', 1],
          ['bubble', { value: 0, play: [-0.3, 0.3] }],
        ],
        shape: shape('box', 0.5, 0.5, { corner: 0.02 }),
        at: 0,
        speed: 1,
        cellSpread: 0.5,
        // a square screen at rest (amount 0), for Newsprint to press
        halftone: halftone({ amount: 0, grid: 'square', pitch: 48, turn: 45, fade: 0, size: 1.1, reach: 0.1 }),
      }),
    ],
    rings: { value: 6, play: [4, 8] },
    drift: 0.6,
    line: 'band',
    width: { value: 0.03, play: [0.02, 0.05] },
    falloff: 0.4,
    palette: stops([
      [0.05, 0, 0],
      [0.98, 0, 0],
      [0.2, 0, 0],
      [0.9, 0.04, 30],
    ]),
    contrast: 1.4,
    radius: 0.4,
    gamma: 1,
    modulators: [
      mod('slide', 'cos', 16, [['levels[wall].lattice.e2[0]', 0.25]]),
      mod('bulge', 'cos', 21, [['levels[wall].variations[1].weight', 0.3]]),
      mod('shade', 'cos', 37, [['palette.radius', 0.3]]),
    ],
    presets: [
      // the bricks pressed into newsprint dots at 45°
      { name: 'Newsprint', values: { 'levels[wall].halftone.amount': 1 } },
    ],
  }),
  scene({
    name: 'Fish scales',
    // half rings in brick courses half a cell high, each over the next where they reach (spill), shimmering
    // through a sinusoid
    levels: [
      level('scales', {
        scale: 2.6,
        lattice: 'brick',
        e2: [0.5, 0.5],
        spill: 1,
        vary: [
          ['linear', 1],
          ['sinusoidal', { value: 0.08, play: [0, 0.2] }],
        ],
        shape: shape('arc', 0.56, 0.5, { onion: { value: 0.03, play: [0.01, 0.05] } }),
        at: 0.45,
        speed: 0.6,
        cellSpread: 0.3,
      }),
    ],
    line: 'smooth',
    width: 0.012,
    falloff: 1,
    palette: stops([
      [0.45, 0.1, 190],
      [0.7, 0.12, 165],
      [0.85, 0.12, 95],
      [0.55, 0.12, 230],
    ]),
    radius: 0.3,
    modulators: [
      mod('swim', 'cos', 12, [['levels[scales].affine.offset[0]', 0.5]]),
      mod('shimmer', 'cos', 9, [['levels[scales].variations[1].weight', 0.08]]),
      mod('hue', 'cos', 50, [['palette.hue', 35]]),
    ],
  }),
  scene({
    name: 'Flower of life',
    // circles on a hex grid as wide as its spacing, each drawing where its neighbours reach over it
    background: background('gradient', 0.15, [0, 0.12]),
    levels: [
      level('flower', {
        scale: { value: 1.6, play: [1.3, 2] },
        turn: 30,
        e2: HEX,
        spill: 1,
        shape: star(6, 2, { value: 0.75, play: [0.5, 1] }, { round: 1 }),
        at: 0.35,
        speed: 0.5,
      }),
      level('seed', {
        scale: 3,
        turn: 30,
        e2: HEX,
        spill: 1,
        weight: 0.25,
        shape: star(6, 2, 0.5, { round: 1 }),
        at: 0.65,
        speed: 0.6,
      }),
    ],
    line: 'smooth',
    units: 'screen',
    width: 0.004,
    falloff: 1,
    palette: stops([
      [0.28, 0.1, 275],
      [0.62, 0.12, 65],
      [0.88, 0.13, 88],
      [0.5, 0.16, 310],
    ]),
    radius: 0.25,
    modulators: [
      mod('bloom', 'cos', 24, [['levels[flower].variants[0].shape.r', 0.25]]),
      mod('seed', 'cos', 17, [['levels[seed].variants[0].shape.r', 0.15]], { phase: 0.5 }),
      mod('spin', 'ramp', 120, [['frame.turn', 180]]),
    ],
    macros: [
      {
        id: 'bloom',
        name: 'Seed to flower',
        value: 0.5,
        targets: [{ knob: 'levels[flower].variants[0].shape.r', from: 0.5, to: 1 }],
      },
    ],
  }),
  scene({
    name: 'Raindrops on a pond',
    // a drop at each scattered point (Voronoi), its ripples running out until they meet the next drop's
    background: { ...background('gradient', 0.25, [0.02, 0.25]), turn: k(90) },
    levels: [
      level('drops', {
        scale: 1.3,
        lattice: 'voronoi',
        e2: HEX,
        jitter: { value: 0.85, play: [0.6, 1] },
        shape: star(6, 2, 0.04, { round: 1 }),
        at: 0.4,
        speed: 0.6,
        cellSpread: 0.3,
      }),
    ],
    rings: { value: 7, play: [4, 10] },
    drift: -2.5,
    radialWeight: 0.3,
    line: 'smooth',
    units: 'screen',
    width: 0.008,
    falloff: 1.2,
    palette: stops([
      [0.3, 0.08, 245],
      [0.75, 0.1, 220],
      [0.95, 0.04, 200],
      [0.65, 0.1, 185],
    ]),
    radius: 0.2,
    modulators: [
      mod('scatter', 'cos', 41, [['levels[drops].lattice.jitter', 0.15]]),
      mod('pan', 'cos', 60, [['frame.origin[1]', 0.5]]),
      mod('hue', 'cos', 45, [['palette.hue', 20]]),
    ],
  }),
  scene({
    name: 'Soak stain',
    // Frankenthaler's soak-stain pools seeping round under sparse crescents, which cover the canvas where drawn
    background: { ...background('soak', 0.95, [0.1, 0.7]), scale: k(0.8), edge: k({ value: 0.6, play: [0.3, 0.8] }) },
    levels: [
      level('marks', {
        scale: 0.9,
        lattice: 'voronoi',
        e2: HEX,
        jitter: 0.85,
        by: 'hash',
        cellTurn: 60,
        shape: shape('moon', 0.36, { value: 0.5, play: [0.3, 0.8] }),
        at: 0.3,
        speed: 0.8,
        cellSpread: 0.6,
      }),
    ],
    line: 'hard',
    width: { value: 0.012, play: [0.006, 0.02] },
    composite: 'first',
    palette: stops([
      [0.75, 0.12, 75],
      [0.62, 0.14, 15],
      [0.55, 0.1, 190],
      [0.45, 0.14, 265],
    ]),
    radius: 0.1,
    gamma: 1,
    modulators: [
      mod('seep', 'ramp', 80, [['background.seep', 0.5]]),
      mod('bite', 'cos', 23, [['levels[marks].variants[0].shape.form', 0.2]]),
      mod('turn', 'cos', 61, [['levels[marks].cell.turn', 40]]),
    ],
    presets: [
      // the soak's pool size and pigments
      {
        name: 'Pools',
        values: {
          'background.scale': 2,
          'background.edge': 0.8,
          'background.at[0]': 0.3,
          'background.at[1]': 0.95,
          'levels[marks].affine.scale': 0.6,
        },
      },
    ],
  }),
  scene({
    name: 'Confetti',
    // four of iq's shapes picked by hash, each cell turned either way, spinning as they drift down and back up
    levels: [
      level('confetti', {
        scale: 3.2,
        lattice: 'voronoi',
        e2: HEX,
        jitter: { value: 0.8, play: [0.5, 1] },
        by: 'hash',
        cellTurn: { value: 40, play: [20, 70] },
        variants: [
          { share: 0.25, shape: shape('moon', 0.3, 0.4) },
          { share: 0.25, shape: shape('heart', 0.28, 0) },
          { share: 0.25, shape: shape('cross', 0.3, 0.3, { corner: 0.03 }) },
          { share: 0.25, shape: shape('vesica', 0.32, 0.4) },
        ],
        at: 0,
        speed: 1,
        cellSpread: 1,
      }),
      level('glitter', {
        scale: 2,
        by: 'hash',
        cellTurn: 45,
        weight: 0.5,
        shape: star(4, 1.4, 0.15),
        at: 0.5,
        speed: 1,
        cellSpread: 1,
      }),
    ],
    line: 'smooth',
    width: { value: 0.02, spread: -0.006 },
    falloff: 1,
    palette: 'rainbow',
    radius: 0,
    modulators: [
      mod('fall', 'tri', 64, [['frame.origin[1]', 3]]),
      mod('spin', 'ramp', 6, [
        ['levels[confetti].variants[0].shape.twist', 180],
        ['levels[confetti].variants[1].shape.twist', -180],
        ['levels[confetti].variants[2].shape.twist', 180],
        ['levels[confetti].variants[3].shape.twist', -180],
      ]),
      mod('sway', 'cos', 8, [['levels[confetti].affine.offset[0]', 0.2]]),
    ],
  }),
  scene({
    name: 'Heart tunnel',
    // hearts round a log-polar grid in staggered rows, its scale ramped two rows out a period (as Hyperspace),
    // so the tunnel falls in for ever; a loop keeps it seamless
    background: { ...background('gradient', 0.2, [0.05, 0.6]), turn: k(-90) },
    levels: [
      level('hearts', {
        scale: 1.505,
        lattice: 'logpolar',
        sectors: 18,
        e2: [0.5, 1],
        shape: shape('heart', { value: 0.32, play: [0.25, 0.4] }, 0, { twist: 180 }),
        at: 0.05,
        speed: 0.7,
      }),
      level('sparkle', { shape: star(4, 1.4, 0.07), at: 0.9, speed: 0.5 }),
    ],
    radialWeight: { value: -0.4, play: [-0.8, 0] },
    line: 'smooth',
    width: { value: 0.03, play: [0.02, 0.045] },
    falloff: 1.2,
    palette: stops([
      [0.55, 0.22, 10],
      [0.72, 0.17, 350],
      [0.88, 0.08, 20],
      [0.45, 0.2, 330],
    ]),
    radius: 0.3,
    loop: 40,
    modulators: [
      mod('fall', 'ramp', 10, [['levels[hearts].affine.scale', 0.505]]),
      mod('beat', 'beat', 5, [['levels[hearts].variants[0].shape.r', 0.04]], { harmonics: [2, 1] }),
      mod('hue', 'cos', 20, [['palette.hue', 25]]),
    ],
  }),
  scene({
    name: 'Hyperspace',
    // radial streaks round a log-polar grid in staggered rows; its scale runs two rows out a period, from 1 to
    // e^(2π · 2 / 18), the pad's vector (-1, 2), so the stars rush past for ever
    levels: [
      level('stars', {
        scale: 1.505,
        lattice: 'logpolar',
        sectors: 18,
        e2: [0.5, 1],
        shape: shape('segment', 0.3, 0.15),
        at: 0.5,
        speed: 0.6,
      }),
    ],
    radialWeight: { value: -0.8, play: [-1.2, -0.3] },
    width: { value: 0.01, play: [0.006, 0.016] },
    falloff: 2,
    palette: stops([
      [0.85, 0.05, 240],
      [0.95, 0.02, 90],
      [0.7, 0.12, 250],
      [0.8, 0.1, 300],
    ]),
    radius: 0.2,
    loop: 20,
    modulators: [
      mod('rush', 'ramp', 3, [['levels[stars].affine.scale', 0.505]]),
      mod('roll', 'ramp', 40, [['frame.turn', 180]]),
      mod('hue', 'cos', 20, [['palette.hue', 40]]),
    ],
  }),
  scene({
    name: 'Spiral galaxy',
    // a swirl bends a polar grid of stars into three arms, winding tighter out from the core, the whole galaxy
    // turning
    levels: [
      level('arms', {
        scale: 1.8,
        vary: [
          ['linear', 0.1],
          ['swirl', { value: 0.9, play: [0.7, 1.1] }],
        ],
        lattice: 'polar',
        sectors: 3,
        e2: [0.5, { value: 0.6, play: [0.5, 0.8] }],
        shape: star(4, { value: 1.6, play: [1.2, 2.2] }, 0.15, { round: 0.3 }),
        at: 0.55,
        speed: 0.7,
        cellSpread: 0.3,
      }),
      level('dust', {
        scale: 2,
        turn: 30,
        e2: HEX,
        weight: 0.6,
        shape: star(4, 1.4, 0.12),
        at: 0.85,
        speed: 0.5,
        cellSpread: 0.5,
      }),
    ],
    radialWeight: 2,
    width: 0.012,
    falloff: 2,
    palette: 'dusk',
    radius: 0.3,
    modulators: [
      mod('wind', 'ramp', 40, [['levels[arms].affine.turn', -180]]),
      mod('coil', 'cos', 27, [['levels[arms].variations[1].weight', 0.1]]),
      mod('twinkle', 'cos', 9, [['levels[dust].variants[0].shape.r', 0.05]]),
      mod('hue', 'cos', 50, [['palette.hue', 30]]),
    ],
  }),
  scene({
    name: 'Plasma',
    // a sinusoid's wobbling field drawn as its contour lines: dense echo rings round one circle, flowing, the
    // colours running round a long palette. The field's cells mirror, so the swirl in them meets itself at their
    // edges, and the swirl is at full weight, as a level under 1 blends its cells' offsets with the plane's and parts
    // at their edges
    levels: [
      level('field', {
        scale: 0.35,
        vary: [
          ['linear', 0.5],
          ['sinusoidal', { value: 1, play: [0.6, 1.5] }],
        ],
        by: 'mirror',
        shape: star(6, 2, 0.3, { round: 1 }),
        at: 0,
        speed: 0.3,
      }),
      level('swirl', {
        scale: 1.3,
        vary: [
          ['linear', 0.6],
          ['swirl', { value: 0.4, play: [0.2, 0.7] }],
        ],
        shape: star(6, 2, 0.35, { round: 1 }),
        at: 0.5,
        speed: 0.4,
      }),
    ],
    rings: 10,
    drift: 2,
    width: { value: 0.006, spread: -0.002 },
    falloff: 0.7,
    palette: stops(
      [
        [0.6, 0.2, 300],
        [0.75, 0.15, 60],
        [0.65, 0.17, 180],
      ],
      'long',
    ),
    radius: 0.6,
    time: 0.12,
    gamma: 1.4,
    modulators: [
      mod('flowX', 'cos', 37, [['levels[field].affine.offset[0]', 1]]),
      mod('flowY', 'cos', 29, [['levels[field].affine.offset[1]', 1]], { phase: 0.25 }),
      mod('warp', 'cos', 17, [['levels[field].variations[1].weight', 0.3]]),
    ],
  }),
  scene({
    name: 'Soap bubbles',
    // thin onion-skinned circles on a hex grid, blown round by a bubble warp that wobbles, with smaller foam
    // between them, the film's colours running round a pale palette
    levels: [
      level('film', {
        scale: 0.8,
        turn: 30,
        e2: HEX,
        vary: [
          ['linear', 0.3],
          ['bubble', { value: 0.9, play: [0.5, 1.2] }],
        ],
        shape: star(6, 2, 0.42, { round: 1, onion: { value: 0.05, play: [0.02, 0.1] } }),
        at: 0,
        speed: 0.4,
        cellSpread: 0.6,
      }),
      level('foam', {
        scale: 2.2,
        turn: 30,
        e2: HEX,
        shape: star(6, 2, 0.4, { round: 0.85 }),
        at: 0.5,
        speed: 0.5,
        cellSpread: 0.4,
      }),
    ],
    width: 0.004,
    falloff: 1.4,
    palette: stops(
      [
        [0.78, 0.14, 200],
        [0.82, 0.15, 320],
        [0.86, 0.13, 90],
      ],
      'long',
    ),
    radius: 0.8,
    time: 0.15,
    gamma: 1.6,
    modulators: [
      mod('spin', 'ramp', 60, [['levels[film].affine.turn', 180]]),
      mod('wobble', 'cos', 13, [['levels[film].variations[1].weight', 0.25]]),
      mod('peel', 'cos', 7, [['levels[film].variants[0].shape.onion', 0.03]]),
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
  // ---- the lattices: triangles, log-polar, fold, Voronoi, the rhombic arc ----
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
      {
        name: 'Organic',
        values: {
          'levels[cells].lattice.jitter': 0.9,
          'levels[nuclei].lattice.jitter': 0.8,
          'levels[cells].affine.scale': 0.8,
          'contour.rings': 4,
        },
      },
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
        // a fill at rest (amount 0), for Stained glass to light
        fill: fill({ amount: 0, line: 1, tone: 0.3, alternate: 0.5 }),
      }),
      level('tracery', { scale: 2.2, lattice: 'fold', e2: [0.2, 0.7], shape: star(4, 2.5, 0.25), at: 0.35 }),
      level('glass', {
        scale: 2.4,
        lattice: 'triangle',
        e2: HEX,
        by: 'parity',
        cellTurn: 60,
        shape: star(3, 2, 0.2),
        fill: fill({ amount: 0, line: 1, tone: 0.5, alternate: 0.25 }),
      }),
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
    presets: [
      // fills under kept lines outside the deco palettes: the window's glass lit
      {
        name: 'Stained glass',
        values: { 'levels[rose].fill.amount': 0.55, 'levels[glass].fill.amount': 0.45, 'line.width': 0.006 },
      },
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
  scene({
    name: 'Remix - Kaleidoscope pond',
    zoom: 1.1,
    // mirror tiles above, ripples within them, coloured by the orbit trap: every new part of the Cell step and
    // colour at once, with play ranges wide enough that Mutate (R) keeps finding new ones
    levels: [
      level('glass', {
        scale: { value: 1.2, play: [0.9, 1.6] },
        turn: { value: 0, play: [-20, 20] },
        vary: [
          ['linear', 1],
          ['butterfly', { value: 0, play: [0, 0.4] }],
        ],
        by: 'mirror',
        shape: shape('vesica', 0.5, { value: 0.45, play: [0.2, 0.8] }, { twist: { value: 30, play: [0, 60] } }),
        at: 0,
        speed: 0.3,
      }),
      level('ripple', {
        scale: { value: 2, play: [1.6, 2.6] },
        e2: HEX,
        by: 'ring',
        cellTurn: { value: 10, play: [-30, 30] },
        cellPhase: { value: 0.1, play: [-0.25, 0.25] },
        shape: star(6, { value: 2, play: [1.5, 4] }, 0.45, { round: { value: 0.5, play: [0, 1] } }),
        at: 0.5,
        speed: 0.3,
      }),
    ],
    rings: { value: 2, play: [1, 4] },
    drift: { value: 0.8, play: [0.3, 1.5] },
    width: { value: 0.0035, spread: 0.002 },
    falloff: 1.3,
    palette: 'rainbow',
    radius: 0.1,
    trap: { weight: { value: 2.2, play: [1, 3.5] }, size: { value: 0.2, play: [0, 0.5] } },
    modulators: [
      mod('wing', 'cos', 28, [['levels[glass].variations[1].weight', 0.15]]),
      mod('trap', 'tri', 33, [['palette.trap.size', 0.15]]),
      mod('hue', 'cos', 70, [['palette.hue', 90]]),
    ],
    macros: [
      {
        id: 'depth',
        name: 'depth',
        value: 0.5,
        targets: [
          { knob: 'levels[ripple].affine.scale', from: 1.6, to: 2.6 },
          { knob: 'contour.rings', from: 1, to: 4 },
        ],
      },
    ],
    presets: [
      // the butterfly variation, which the look's mover takes to 0.15 at most
      {
        name: 'Wings',
        values: {
          'levels[glass].variations[1].weight': 0.35,
          'levels[glass].variants[0].shape.form': 0.7,
          'levels[glass].variants[0].shape.twist': 60,
          'palette.trap.size': 0.45,
        },
      },
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
    // the ants' cells mirror, so the crumbs under them meet themselves at the cells' edges, each crumb its own colour
    // alone, as one that took the ants' would change colour across an edge
    levels: [
      level('ants', {
        scale: 0.6,
        by: 'mirror',
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
        speed: 1,
        cellSpread: 0.6,
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
      { name: 'Dashes', values: { 'line.dots.size': 0.75, 'line.dots.count': 10, 'levels[ants].affine.scale': 0.4 } },
      {
        name: 'Pearls',
        values: { 'line.dots.size': 0, 'line.dots.count': 12, 'line.width': 0.03, 'levels[ants].affine.scale': 1.1 },
      },
    ],
  }),
  scene({
    name: 'Shapes - Metaballs',
    zoom: 1.2,
    levels: [
      ...linked('blob', 2, {
        scale: { value: 1.3, spread: 1.4 },
        turn: { value: 0, spread: 30 },
        e2: HEX,
        spill: 1,
        shape: shape(
          'ellipse',
          0.17,
          { value: 0.8, play: [0.5, 1] },
          {
            onion: 0.015,
            join: join(star(6, 2, 0.12, { round: 1 }), [0.22, 0], { value: 0.05, play: [0, 0.1] }),
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
      {
        name: 'Apart',
        values: {
          'levels[blob1].variants[0].shape.join.blend': 0,
          'levels[blob1].variants[0].shape.join.offset[0]': 0.4,
          'levels[blob1].affine.scale': 1.6,
        },
      },
      {
        name: 'Melted',
        values: {
          'levels[blob1].variants[0].shape.join.blend': 0.1,
          'levels[blob1].variants[0].shape.join.offset[0]': 0.12,
          'levels[blob1].variants[0].shape.onion': 0.03,
          'levels[blob1].affine.scale': 0.8,
          'frame.zoom': 0.6,
        },
      },
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
  // iq's shapes no other look draws (rhombus, trapezoid, parallelogram, capsule; horseshoe and cut disk below),
  // laid as parquet: each cell picks its piece by share and turns by a hash, filled in bands under its line
  scene({
    name: 'Shapes - Parquet',
    zoom: 1.1,
    levels: [
      level('tiles', {
        scale: 1.4,
        turn: 30,
        e2: HEX,
        by: 'hash',
        cellTurn: 60,
        variants: [
          { share: 0.25, shape: shape('rhombus', 0.45, 0.58) },
          { share: 0.25, shape: shape('trapezoid', 0.42, 0.5) },
          { share: 0.25, shape: shape('parallelogram', 0.42, 0.5) },
          { share: 0.25, shape: shape('capsule', 0.42, 0.35) },
        ],
        at: 0,
        speed: 0.8,
        cellSpread: 0.4,
        fill: fill({ amount: 0.8, line: 1, bands: 4, step: 0.08 }),
      }),
      level('inlay', {
        scale: R3,
        turn: 30,
        e2: HEX,
        variants: [
          { share: 0.5, shape: shape('horseshoe', 0.3, 0.5) },
          { share: 0.5, shape: shape('cutDisk', 0.3, 0.4) },
        ],
        at: 0.5,
        speed: 0.6,
      }),
    ],
    line: 'smooth',
    width: { value: 0.008, spread: -0.004 },
    falloff: 1,
    palette: 'warm',
    radius: 0.2,
    gamma: 1.4,
    modulators: [
      mod('turn', 'beat', 24, [['levels[tiles].cell.turn', 30]], { harmonics: [3, 2] }),
      mod('open', 'cos', 17, [['levels[inlay].variants[0].shape.form', 0.25]]),
      mod('hue', 'cos', 45, [['palette.hue', 40]]),
    ],
    presets: [
      {
        name: 'Capsules',
        values: {
          'levels[tiles].variants[0].share': 0,
          'levels[tiles].variants[1].share': 0,
          'levels[tiles].variants[2].share': 0,
          'levels[tiles].variants[3].share': 1,
        },
      },
    ],
  }),
  // ---- the Cell step's ring and mirror, orbit-trap colour and the rest of flam3 ----
  scene({
    name: 'Cells - Ripples',
    zoom: 0.8,
    // the ring step's phase grows with each cell's distance from the middle, and the drift runs every cell's rings
    // on together, so the echo rings travel outward from cell to cell like ripples on a pond
    levels: [
      level('pond', {
        scale: 1.1,
        turn: 30,
        e2: HEX,
        by: 'ring',
        cellTurn: { value: 0, play: [-12, 12] },
        cellPhase: { value: 0.12, play: [0.04, 0.3] },
        shape: star(6, 2, 0.48, { twist: 30, round: { value: 0.3, play: [0, 0.8] } }),
        at: 0,
        speed: 0.5,
      }),
      level('drops', {
        scale: R3,
        turn: 30,
        e2: HEX,
        by: 'ring',
        cellTurn: { value: 0, play: [-20, 20] },
        cellPhase: { value: -0.2, play: [-0.4, 0] },
        shape: star(6, 2, 0.4, { round: 1 }),
        at: 0.45,
      }),
    ],
    rings: { value: 3, play: [2, 5] },
    drift: { value: 1.2, play: [0.6, 2] },
    width: { value: 0.004, spread: 0.002 },
    falloff: 1.2,
    palette: 'ice',
    radius: { value: 0.3, play: [0.1, 0.5] },
    modulators: [
      mod('wavelength', 'cos', 24, [['levels[pond].cell.phase', 0.08]]),
      mod('swirl', 'cos', 40, [['levels[drops].cell.turn', 12]]),
      mod('hue', 'cos', 50, [['palette.hue', 60]]),
    ],
    presets: [
      {
        name: 'Still water',
        values: {
          'levels[pond].cell.phase': 0.04,
          'levels[drops].cell.turn': 0,
          'levels[drops].cell.phase': 0,
          'contour.drift': 0.6,
          'contour.rings': 2,
        },
      },
      {
        name: 'Whirlpool',
        values: { 'levels[pond].cell.turn': 9, 'levels[drops].cell.turn': -16, 'contour.drift': 1.8 },
      },
    ],
  }),
  scene({
    name: 'Cells - Mirror tiles',
    zoom: 0.9,
    // every odd cell along each axis is its neighbour's reflection (iq's mirrored repetition), so a lopsided shape
    // meets its mirror image at every edge and the plane reads as one pattern rather than a grid of stamps
    levels: [
      level('tile', {
        scale: 1.1,
        by: 'mirror',
        spill: 1,
        shape: shape('moon', 0.5, { value: 0.55, play: [0.3, 0.8] }, { twist: { value: 35, play: [0, 90] } }),
        at: 0,
        speed: 0.5,
        cellSpread: 0.15,
      }),
      level('inlay', {
        scale: 2,
        by: 'mirror',
        shape: shape('pie', 0.38, { value: 0.3, play: [0.15, 0.6] }, { twist: 135, corner: 0.02 }),
        at: 0.5,
      }),
    ],
    rings: { value: 2.5, play: [1, 4] },
    drift: 0.4,
    width: { value: 0.004, spread: 0.002 },
    falloff: 1.3,
    palette: 'warm',
    radius: { value: 0.25, play: [0.05, 0.5] },
    modulators: [
      mod('turn', 'cos', 30, [['levels[tile].variants[0].shape.twist', 30]]),
      mod('bite', 'tri', 19, [['levels[tile].variants[0].shape.form', 0.2]]),
      mod('opening', 'cos', 23, [['levels[inlay].variants[0].shape.form', 0.15]], { phase: 0.5 }),
      mod('hue', 'cos', 48, [['palette.hue', 80]]),
    ],
    presets: [
      {
        name: 'Butterflies',
        values: {
          'levels[tile].variants[0].shape.twist': 90,
          'levels[tile].variants[0].shape.form': 0.8,
          'contour.rings': 1,
          'levels[inlay].affine.scale': 1,
        },
      },
      { name: 'Scales', values: { 'levels[tile].variants[0].shape.twist': 5, 'levels[inlay].affine.scale': 1.5 } },
    ],
  }),
  scene({
    name: 'Colour - Orbit traps',
    zoom: 1.5,
    // the levels pull no colour of their own: the palette index is how near each point came, down the chain, to
    // the trap's circle round its cells' middles, so the colour follows the nesting rather than the radius
    levels: linked('o', 4, {
      scale: { value: 1.56, play: [1.4, 1.75] },
      turn: 30,
      e2: HEX,
      shape: star(6, { value: 3, play: [1.5, 5] }, 0.36),
      at: 0,
      speed: 0,
    }),
    line: 'hard',
    width: { value: 0.003, spread: 0.012 },
    contrast: 1.2,
    radius: 0,
    palette: 'dusk',
    trap: { weight: { value: 2.8, play: [1.5, 4] }, size: { value: 0.15, play: [0, 0.45] } },
    modulators: [
      mod('trap', 'cos', 26, [['palette.trap.size', 0.15]]),
      mod('nest', 'cos', 36, [['levels[o1].affine.scale', 0.12]], { phase: 0.5 }),
      mod('character', 'tri', 17, [['levels[o1].variants[0].shape.m', 1.5]]),
      mod('hue', 'ramp', 80, [['palette.hue', 180]]),
    ],
    presets: [
      {
        name: 'Point trap',
        values: { 'palette.trap.size': 0, 'palette.trap.weight': 3.6, 'levels[o1].variants[0].shape.m': 5 },
      },
      {
        name: 'Ring trap',
        values: { 'palette.trap.size': 0.4, 'palette.trap.weight': 2, 'levels[o1].affine.scale': 1.4, 'frame.zoom': 1 },
      },
    ],
  }),
  scene({
    name: 'flam3 - Hearts and discs',
    zoom: 1.2,
    // one level warped by a blend of flam3's heart, disc, spiral and handkerchief; its presets dial between them.
    // The heart is cut along a ray from its middle, its two sides each other's mirror: the hex cells and their stars
    // are mirrors of themselves there, so the lines meet across it, as long as the cells take no colour of their own
    // and the lines are in cell units, which measure no stretch across it
    levels: [
      level('warp', {
        scale: { value: 1.2, play: [0.8, 1.6] },
        vary: [
          ['linear', { value: 0.2, play: [0, 0.5] }],
          ['heart', { value: 0.8, play: [0, 1] }],
          ['disc', { value: 0, play: [0, 1] }],
          ['spiral', { value: 0, play: [0, 0.6] }],
          ['handkerchief', { value: 0, play: [0, 1] }],
        ],
        e2: HEX,
        shape: star(6, 2, 0.42, { twist: 30 }),
        at: 0,
        speed: 0.5,
      }),
      level('seeds', { scale: R3, turn: 30, e2: HEX, shape: star(6, 3, 0.4), at: 0.4 }),
      level('dust', { scale: R3, turn: 30, e2: HEX, shape: star(6, 2, 0.35, { twist: 30 }), at: 0.8 }),
    ],
    width: 0.0025,
    falloff: 1.3,
    palette: 'warm',
    radius: 0.2,
    modulators: [
      mod('beat', 'cos', 16, [['levels[warp].variations[1].weight', 0.2]]),
      mod('spin', 'ramp', 60, [['levels[warp].affine.turn', 180]]),
      mod('hue', 'cos', 40, [['palette.hue', 50]]),
    ],
    presets: [
      {
        name: 'Spiral',
        values: {
          'levels[warp].variations[1].weight': 0,
          'levels[warp].variations[3].weight': 0.5,
          'levels[warp].variations[0].weight': 0.5,
        },
      },
      {
        name: 'Handkerchief',
        values: { 'levels[warp].variations[1].weight': 0, 'levels[warp].variations[4].weight': 0.9 },
      },
    ],
  }),
  scene({
    name: 'flam3 - Complex plane',
    zoom: 0.9,
    // flam3's complex functions as the warp: sine folds the plane into bands, tanh pinches it into a lens, the
    // secant rings its poles and the exponential rolls the plane round them
    levels: [
      level('fn', {
        scale: { value: 1.4, play: [1, 2] },
        vary: [
          ['sin', { value: 1, play: [0, 1] }],
          ['tanh', { value: 0, play: [0, 1] }],
          ['sec', { value: 0, play: [0, 1] }],
          ['exp', { value: 0, play: [0, 0.6] }],
        ],
        by: 'parity',
        cellTurn: { value: 45, play: [0, 90] },
        shape: star(4, 2, 0.4, { twist: 45 }),
        at: 0,
        speed: 0.5,
        cellSpread: 0.25,
      }),
      level('grid', { scale: 2, turn: 45, shape: star(4, 2.5, 0.35), at: 0.5 }),
    ],
    rings: { value: 1.5, play: [1, 3] },
    drift: 0.5,
    width: 0.003,
    falloff: 1.2,
    units: 'screen',
    palette: 'rainbow',
    radius: 0.15,
    modulators: [
      mod('flow', 'ramp', 32, [['levels[fn].affine.offset[0]', 2]]),
      mod('turn', 'tri', 21, [['levels[fn].cell.turn', 30]]),
      mod('hue', 'cos', 60, [['palette.hue', 120]]),
    ],
    presets: [
      { name: 'Tanh', values: { 'levels[fn].variations[0].weight': 0.3, 'levels[fn].variations[1].weight': 0.7 } },
      {
        name: 'Secant',
        values: {
          'levels[fn].variations[0].weight': 0,
          'levels[fn].variations[2].weight': 1,
          'levels[fn].affine.scale': 1,
        },
      },
    ],
  }),
  scene({
    name: 'flam3 - Julia set',
    zoom: 1.1,
    // julia's square root halves every angle, so the hex cells close up round the cut: a six-fold shape is the
    // same either side of it; ex and bent push the arms out
    levels: [
      level('root', {
        scale: 3,
        vary: [
          ['julia', { value: 1, play: [0.5, 1] }],
          ['ex', { value: 0, play: [0, 0.4] }],
          ['bent', { value: 0, play: [0, 0.6] }],
        ],
        e2: HEX,
        by: 'ring',
        cellPhase: 0.15,
        shape: star(6, { value: 2.5, play: [1.5, 4] }, 0.42),
        at: 0,
        speed: 0.5,
      }),
      level('flake', { scale: R3, turn: 30, e2: HEX, shape: star(6, 2, 0.38, { twist: 30 }), at: 0.4 }),
      level('frost', { scale: R3, turn: 30, e2: HEX, shape: star(6, 3, 0.35), at: 0.8 }),
    ],
    rings: 3,
    drift: 0.6,
    width: { value: 0.006, spread: 0.004 },
    falloff: 1.2,
    palette: 'ice',
    radius: 0.25,
    modulators: [
      mod('turn', 'ramp', 50, [['levels[root].affine.turn', 180]]),
      mod('ex', 'cos', 22, [['levels[root].variations[1].weight', 0.15]]),
      mod('character', 'tri', 13, [['levels[root].variants[0].shape.m', 1]]),
      mod('hue', 'cos', 45, [['palette.hue', 40]]),
    ],
    presets: [{ name: 'Bent', values: { 'levels[root].variations[2].weight': 0.6 } }],
  }),
  // flam3's variations no other look draws, four that read at a glance (scry's starburst, cross's X, the
  // hyperbolic's lens and loonie's ring), on Hearts and discs' chain; its presets dial between them
  scene({
    name: 'flam3 - Starburst',
    zoom: 1.2,
    levels: [
      level('warp', {
        scale: { value: 1.2, play: [0.8, 1.6] },
        vary: [
          ['linear', { value: 0.2, play: [0, 0.5] }],
          ['scry', { value: 0.8, play: [0, 1] }],
          ['cross', { value: 0, play: [0, 1] }],
          ['hyperbolic', { value: 0, play: [0, 1] }],
          ['loonie', { value: 0, play: [0, 1] }],
        ],
        e2: HEX,
        shape: star(6, 2, 0.42, { twist: 30 }),
        at: 0,
        speed: 0.5,
        cellSpread: 0.3,
      }),
      level('seeds', { scale: R3, turn: 30, e2: HEX, shape: star(6, 3, 0.4), at: 0.4 }),
      level('dust', { scale: R3, turn: 30, e2: HEX, shape: star(6, 2, 0.35, { twist: 30 }), at: 0.8 }),
    ],
    width: 0.0025,
    falloff: 1.3,
    units: 'screen',
    palette: 'ember',
    radius: 0.2,
    modulators: [
      mod('beat', 'cos', 16, [['levels[warp].variations[1].weight', 0.15]]),
      mod('spin', 'ramp', 60, [['levels[warp].affine.turn', 180]]),
      mod('hue', 'cos', 40, [['palette.hue', 50]]),
    ],
    presets: [
      { name: 'Cross', values: { 'levels[warp].variations[1].weight': 0, 'levels[warp].variations[2].weight': 0.8 } },
      { name: 'Lens', values: { 'levels[warp].variations[1].weight': 0, 'levels[warp].variations[3].weight': 0.8 } },
      {
        name: 'Loonie',
        values: {
          'levels[warp].variations[1].weight': 0,
          'levels[warp].variations[4].weight': 0.8,
          'levels[warp].variations[0].weight': 0.4,
        },
      },
    ],
  }),
  // four more of flam3's, the plane bent to a horizon: the exponential's floor, secant2's barrel, cosine's bands
  // and the horseshoe's rosette
  scene({
    name: 'flam3 - Horizons',
    zoom: 1.2,
    levels: [
      level('warp', {
        scale: { value: 1.2, play: [0.8, 1.6] },
        vary: [
          ['linear', { value: 0.2, play: [0, 0.5] }],
          ['exponential', { value: 0, play: [0, 1] }],
          ['secant2', { value: 0.8, play: [0, 1] }],
          ['cosine', { value: 0, play: [0, 1] }],
          ['horseshoe', { value: 0, play: [0, 1] }],
        ],
        e2: HEX,
        shape: star(6, 2, 0.42, { twist: 30 }),
        at: 0,
        speed: 0.5,
        cellSpread: 0.3,
      }),
      level('seeds', { scale: R3, turn: 30, e2: HEX, shape: star(6, 3, 0.4), at: 0.4 }),
      level('dust', { scale: R3, turn: 30, e2: HEX, shape: star(6, 2, 0.35, { twist: 30 }), at: 0.8 }),
    ],
    width: 0.0025,
    falloff: 1.3,
    units: 'screen',
    palette: 'forest',
    radius: 0.2,
    modulators: [
      mod('flow', 'ramp', 24, [['levels[warp].affine.offset[1]', 1]]),
      mod('beat', 'cos', 16, [['levels[warp].variations[2].weight', 0.15]]),
      mod('hue', 'cos', 40, [['palette.hue', 50]]),
    ],
    presets: [
      { name: 'Floor', values: { 'levels[warp].variations[2].weight': 0, 'levels[warp].variations[1].weight': 0.8 } },
      { name: 'Bands', values: { 'levels[warp].variations[2].weight': 0, 'levels[warp].variations[3].weight': 0.8 } },
      { name: 'Rosette', values: { 'levels[warp].variations[2].weight': 0, 'levels[warp].variations[4].weight': 0.8 } },
    ],
  }),
  // the deco family: fills in metal palettes, each level its own colour at 0 with no radius, so only the fill's bands,
  // metal and alternate move round the palette
  scene({
    name: 'Deco - Sunburst',
    levels: [
      level('rays', {
        scale: 0.5,
        lattice: 'polar',
        sectors: 24,
        e2: [0, 2],
        // a circle that covers its cell, short of r's top so the Size macro has room to play it
        shape: star(6, 2, 1.9, { round: 1 }),
        at: 0,
        speed: 1,
        fill: fill({ bands: 3, step: 0.12, alternate: 0.5 }),
      }),
    ],
    drift: 0.3,
    palette: 'gold',
    radius: 0,
    // a radial field at rest (depth 0), for Rising sun to step
    field: { kind: 'radial', angle: k(0), centre: [k(0), k(0)], scale: k(1), depth: k(0), steps: 4 },
    gamma: 1,
    modulators: [mod('sway', 'cos', 32, [['levels[rays].affine.turn', 7.5]])],
    presets: [
      // the fill's ramp, and a fill short of solid
      {
        name: 'Halo',
        values: { 'levels[rays].fill.ramp': 0.6, 'levels[rays].fill.amount': 0.85, 'levels[rays].fill.bands': 6 },
      },
      // the rays stepped ring by ring by the radial field, the sun low
      {
        name: 'Rising sun',
        values: { 'palette.field.depth': 0.25, 'frame.origin[1]': 0.9, 'palette.field.centre[1]': 0.9 },
      },
    ],
  }),
  // overlapping fans in front order, as brick bond lays them
  scene({
    name: 'Deco - Fan bond',
    zoom: 1.2,
    levels: [
      level('fan', {
        scale: 1.6,
        lattice: 'brick',
        e2: [0.5, 0.5],
        spill: 1,
        shape: shape('pie', 0.5, 0.5),
        at: 0,
        speed: 1,
        fill: fill({ bands: 10, step: 0.5, front: true }),
      }),
    ],
    drift: 0.3,
    palette: 'copper',
    radius: 0,
    gamma: 1,
    modulators: [mod('open', 'cos', 24, [['levels[fan].variants[0].shape.form', 0.04]])],
  }),
  // seigaiha: the Japanese wave scales, overlapping circles in front order
  scene({
    name: 'Deco - Seigaiha',
    zoom: 1.2,
    levels: [
      level('scale', {
        scale: 1.6,
        lattice: 'brick',
        e2: [0.5, 0.5],
        spill: 1,
        shape: star(6, 2, 0.5, { round: 1 }),
        at: 0,
        speed: 1,
        fill: fill({ bands: 8, step: 0.25, front: true }),
      }),
    ],
    drift: 0.25,
    palette: stops(DECO),
    radius: 0,
    // a linear field at rest (depth 0), for Tide to sweep
    field: { kind: 'linear', angle: k(90), centre: [k(0), k(0)], scale: k(1), depth: k(0), steps: 4, atCells: true },
    gamma: 1,
    modulators: [mod('swell', 'cos', 30, [['levels[scale].variants[0].shape.r', 0.04]])],
    presets: [
      // the rows of waves a tone darker row by row by the linear field, in the sea's blues
      {
        name: 'Tide',
        values: {
          ...Object.fromEntries(
            [
              [0.25, 0.08, 255],
              [0.55, 0.12, 235],
              [0.85, 0.06, 200],
              [0.95, 0.02, 90],
            ].flatMap((lch, i) => lch.map((v, j) => [`palette.stops[${i}].lch[${j}]`, v])),
          ),
          'palette.field.depth': 0.6,
        },
      },
    ],
  }),
  // bevelled squares in metal, the light swinging round them
  scene({
    name: 'Deco - Ziggurat',
    zoom: 1.2,
    levels: [
      level('z', {
        scale: 1.2,
        shape: shape('box', 0.44, 1),
        at: 0,
        speed: 1,
        fill: fill({ bands: 14, step: 0.07, metal: 1, shade: 0.42, light: 115 }),
      }),
    ],
    palette: 'gold',
    radius: 0,
    gamma: 1,
    modulators: [mod('sun', 'cos', 32, [['levels[z].fill.light', 40]])],
    presets: [
      // the copper metal, in finer steps
      {
        name: 'Copper steps',
        values: {
          ...palettePreset('Copper steps', 'copper').values,
          'levels[z].fill.bands': 8,
          'levels[z].fill.step': 0.1,
        },
      },
    ],
  }),
  scene({
    name: 'Deco - Chevron frieze',
    levels: [
      level('v', {
        scale: 1.5,
        lattice: 'brick',
        e2: [0, 0.5],
        shape: shape('triangle', 0.5, 1, { twist: 180 }),
        at: 0,
        speed: 1,
        fill: fill({ bands: 9, step: 0.5 }),
      }),
    ],
    drift: 0.3,
    palette: 'gold',
    radius: 0,
    gamma: 1,
    modulators: [mod('march', 'ramp', 24, [['levels[v].affine.offset[0]', 0.5]])],
  }),
  // the Truchet lattice in gold metal, its lines kept over the fills
  scene({
    name: 'Deco - Gilded Truchet',
    zoom: 0.8,
    levels: [
      level('tiles', {
        scale: 1.4,
        turn: 30,
        e2: HEX,
        by: 'hash',
        cellTurn: 30,
        shape: star(3, 2, 0.55, { round: 0.1 }),
        at: 0,
        speed: 1,
        fill: fill({ bands: 8, step: 0.12, metal: 1, shade: 0.45, line: 1 }),
      }),
      level('weave', {
        scale: R3,
        turn: 30,
        e2: HEX,
        by: 'hash',
        cellTurn: 30,
        shape: star(3, 2, 0.5),
        at: 0,
        speed: 1,
        fill: fill({ bands: 8, step: 0.12, metal: 1, shade: 0.45, line: 1 }),
      }),
    ],
    rings: 2,
    drift: { value: 0.3, play: [0.1, 0.6] },
    radialWeight: 0.2,
    width: { value: 0.005, spread: 0.003 },
    falloff: 1.3,
    palette: 'gold',
    radius: 0,
    gamma: 1,
    modulators: [
      mod('sway', 'cos', 32, [['levels[tiles].cell.turn', 15]]),
      mod('weave', 'tri', 27, [['levels[weave].cell.turn', 15]], { phase: 0.5 }),
      mod('round', 'cos', 13, [['levels[tiles].variants[0].shape.round', 0.1]]),
      mod('sun', 'cos', 40, [
        ['levels[tiles].fill.light', 35],
        ['levels[weave].fill.light', 35],
      ]),
    ],
    presets: [
      // Lattice - Truchet, merged in: unfilled in the ice palette, its colours as they were but for its hue ramp
      {
        name: 'Ice',
        values: {
          ...palettePreset('Ice', 'ice').values,
          'levels[tiles].fill.amount': 0,
          'levels[weave].fill.amount': 0,
          'palette.radius': 0.3,
          'levels[tiles].colour.speed': 0.6,
          'levels[weave].colour.at': 0.5,
          'levels[weave].colour.speed': 0.5,
        },
      },
    ],
  }),
  // side-on ziggurats in brick bond, stepped back as a skyscraper's setbacks are
  scene({
    name: 'Deco - Setbacks',
    levels: [
      level('zig', {
        lattice: 'brick',
        e2: [0.5, 0.78],
        shape: shape('ziggurat', 0.44, 0.5, { n: 5 }),
        at: 0,
        speed: 1,
        fill: fill({ bands: 10, step: 0.08, metal: 1, shade: 0.45, light: 115 }),
      }),
    ],
    drift: 0.25,
    palette: 'gold',
    radius: 0,
    gamma: 1,
    modulators: [mod('sun', 'cos', 32, [['levels[zig].fill.light', 40]])],
    presets: [
      // the silver metal
      palettePreset('Silver', 'silver'),
    ],
  }),
  // Deco - Fan bond in the deco stops, each fan one colour pair of four by a noise field read at its cell, which
  // holds still: a stepped field that moved would hop whole fans, a blink
  scene({
    name: 'Deco - Fan bond in four',
    zoom: 1.2,
    levels: [
      level('fan', {
        scale: 1.6,
        lattice: 'brick',
        e2: [0.5, 0.5],
        spill: 1,
        shape: shape('pie', 0.5, 0.5),
        at: 0,
        speed: 1,
        fill: fill({ bands: 10, step: 0.5, front: true }),
      }),
    ],
    drift: 0.3,
    palette: stops(DECO),
    radius: 0,
    field: {
      kind: 'noise',
      angle: k(0),
      centre: [k(0), k(0)],
      scale: k(0.7),
      depth: k(0.75),
      steps: 4,
      atCells: true,
    },
    gamma: 1,
    modulators: [mod('open', 'cos', 24, [['levels[fan].variants[0].shape.form', 0.04]])],
    presets: [
      // the noise field finer and deeper, so the four pairs scatter fan by fan
      { name: 'Patchwork', values: { 'palette.field.scale': 2.5, 'palette.field.depth': 1 } },
    ],
  }),
  // the halftones: a polar mandala with its petals pressed into dots on their own lattice, the lace filled in bands
  scene({
    name: 'Halftone - Mandala press',
    zoom: 0.55,
    levels: [
      level('petals', {
        lattice: 'polar',
        sectors: 12,
        e2: [0.25, 0.9],
        shape: star(6, 3, 0.4, { round: 0.2 }),
        at: 0,
        speed: 0.6,
        halftone: halftone({ pitch: 7, fade: 0.7, reach: 0.1 }),
      }),
      level('lace', {
        scale: 2.6,
        turn: 30,
        e2: HEX,
        shape: star(6, 2, 0.42, { twist: 30 }),
        at: 0.4,
        fill: fill({ tone: 0.5, bands: 4, step: 0.1 }),
      }),
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
    presets: [
      // the lattice halftone finer and fuller
      {
        name: 'Coarse press',
        values: {
          'levels[petals].halftone.pitch': 3.5,
          'levels[petals].halftone.size': 1.15,
          'levels[petals].halftone.fade': 0,
          'levels[lace].fill.amount': 0.4,
        },
      },
      // Lattice - Mandala, merged in: its halftone and fill at 0, the same picture
      {
        name: 'Lace',
        values: { 'levels[petals].halftone.amount': 0, 'levels[lace].fill.amount': 0, 'levels[lace].fill.line': 1 },
      },
    ],
  }),
  // Tapestry 1 as LED rings: the halftone's amount spread over the link group from 0, so the leader stays lines and
  // the deeper three turn into hex dots on the screen, each as dim as it is small
  scene({
    name: 'Halftone - LED rings',
    zoom: 1.78,
    levels: linked('sq', 4, {
      scale: { value: 1.75, play: [1.25, 2.25] },
      shape: star(6, 2, 0.5, { twist: 30 }),
      at: { value: 0, spread: 1 },
      speed: 0.35,
      halftone: halftone({ amount: { value: 0, spread: 4 }, grid: 'hex', pitch: 90, fade: 1, reach: 0.05 }),
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
    presets: [
      // the hex screen's pitch, size and turn, at one setting on its one look
      {
        name: 'Stadium',
        values: {
          'levels[sq1].halftone.pitch': 40,
          'levels[sq1].halftone.size': 1.1,
          'levels[sq1].halftone.fade': 0.35,
          'levels[sq1].halftone.turn': 30,
        },
      },
    ],
  }),
  // ---- made for the music, each wired its own way ----
  update(
    scene({
      name: 'Music - On the beat',
      zoom: 1.5,
      // made for a song: the floor's cells step a turn on each beat, the lights flash and fall back, the bands
      // move the small things and the tone blends the night palette into the day one; with no music it drifts
      levels: [
        level('floor', {
          scale: 1.6,
          e2: HEX,
          by: 'parity',
          cellTurn: { value: 0, play: [-60, 60] },
          shape: star(6, { value: 2.5, play: [1.5, 5] }, 0.48, { round: 0.15 }),
          at: 0,
          speed: 0.4,
        }),
        level('lights', {
          scale: 2,
          shape: star(4, 2, { value: 0.42, play: [0.3, 0.5] }, { twist: 45 }),
          at: 0.5,
          speed: 0.3,
          cellSpread: 0.2,
        }),
      ],
      rings: 2,
      drift: 0.4,
      width: 0.004,
      radius: 0.3,
      modulators: [
        mod('step', 'steps', 4, [['levels[floor].cell.turn', 45]], { steps: [0, 0.33, 0.67, 1], listen: 'beats' }),
        mod('flash', 'ramp', 1, [['levels[lights].variants[0].shape.r', -0.06]], { listen: 'beats' }),
        mod('bass', 'cos', 1, [['line.width', 0.004]], { glide: 0.05, listen: 'bass' }),
        mod('mids', 'cos', 1, [['contour.drift', 0.8]], { glide: 0.1, listen: 'mid' }),
        mod('wobble', 'cos', 1, [['levels[floor].variants[0].shape.m', 0.6]], { glide: 0.08, listen: 'highmid' }),
        mod('sway', 'cos', 32, [['frame.turn', 10]]),
      ],
      presets: [palettePreset('Night', 'dusk'), palettePreset('Day', 'ice')],
    }),
    (d) => blend(d, 0, 1),
  ),
  // the music no other look hears: the loudness (level), the drive and the sub, low, low-mid and air bands, each
  // pushing its own part of a pond of drops; with no music it drifts, as On the beat does
  scene({
    name: 'Music - Pulse',
    background: { ...background('gradient', 0.1, [0.02, 0.5]), turn: k(90) },
    levels: [
      level('drops', {
        scale: 1.3,
        lattice: 'voronoi',
        e2: HEX,
        jitter: { value: 0.85, play: [0.6, 1] },
        shape: star(6, 2, 0.05, { round: 1 }),
        at: 0.4,
        speed: 0.6,
        cellSpread: 0.3,
      }),
      level('sparks', { scale: 2.2, turn: 30, e2: HEX, weight: 0.7, shape: star(4, 1.4, 0.06), at: 0.8, speed: 0.6 }),
    ],
    rings: 2,
    drift: -1,
    line: 'smooth',
    units: 'screen',
    width: 0.008,
    falloff: 1.2,
    palette: stops([
      [0.55, 0.25, 330],
      [0.85, 0.15, 60],
      [0.75, 0.17, 200],
      [0.6, 0.22, 290],
    ]),
    radius: 0.2,
    modulators: [
      mod('sub', 'cos', 1, [['levels[drops].variants[0].shape.r', 0.12]], { glide: 0.06, listen: 'sub' }),
      mod('level', 'cos', 1, [['contour.rings', 4]], { glide: 0.2, listen: 'level' }),
      mod('drive', 'cos', 1, [['contour.drift', -2]], { glide: 0.3, listen: 'drive' }),
      mod('low', 'cos', 1, [['levels[drops].lattice.jitter', 0.1]], { glide: 0.2, listen: 'low' }),
      mod('lowmid', 'cos', 1, [['palette.hue', 40]], { glide: 0.5, listen: 'lowmid' }),
      mod('air', 'cos', 1, [['levels[sparks].variants[0].shape.r', 0.1]], { glide: 0.04, listen: 'air' }),
      mod('pan', 'cos', 60, [['frame.origin[1]', 0.5]]),
    ],
  }),
]
  .map((look) => (look.modulators.some((m) => m.listen) ? look : update(look, wire)))
  // the default macros come before wire()'s tone macro, which holds the hue
  .map((look) =>
    update(look, (d) => {
      const tone = d.macros.findIndex((m) => m.id === 'music-tone')
      d.macros.splice(tone < 0 ? d.macros.length : tone, 0, ...defaults(d))
    }),
  )

// The built-in bank: the four Tapestries and the twenty round the ring, each next to the ones it morphs into
// best, and linked to the two or three of those.
const RING = [
  'Tapestry 1 - Rainbow hex rings',
  'Hypnotic rings',
  'Pinwheel rings',
  'Spirograph',
  'Atoms',
  'Clockwork',
  'Tapestry 4 - You spin me right round',
  'Tapestry 3 - sdStar is fun',
  'Snowflakes',
  'Tapestry 7 - Hexes',
  'Nested triangles',
  'Patchwork quilt',
  'Diagonal maze',
  'Op art bricks',
  'Fish scales',
  'Flower of life',
  'Raindrops on a pond',
  'Soak stain',
  'Confetti',
  'Heart tunnel',
  'Hyperspace',
  'Spiral galaxy',
  'Plasma',
  'Soap bubbles',
]
const link = (a: string, ...bs: string[]) => bs.map((b): [string, string] => [a, b])
export const BANK: Bank = {
  scenes: RING,
  links: [
    ...link('Tapestry 1 - Rainbow hex rings', 'Tapestry 7 - Hexes', 'Hypnotic rings', 'Soap bubbles'),
    ...link('Tapestry 3 - sdStar is fun', 'Tapestry 4 - You spin me right round', 'Snowflakes', 'Spirograph'),
    ...link('Tapestry 4 - You spin me right round', 'Hyperspace', 'Clockwork'),
    ...link('Tapestry 7 - Hexes', 'Nested triangles', 'Snowflakes'),
    ...link('Hypnotic rings', 'Pinwheel rings', 'Op art bricks'),
    ...link('Pinwheel rings', 'Spirograph', 'Spiral galaxy'),
    ...link('Spirograph', 'Atoms'),
    ...link('Atoms', 'Clockwork'),
    ...link('Nested triangles', 'Patchwork quilt'),
    ...link('Patchwork quilt', 'Diagonal maze', 'Confetti'),
    ...link('Diagonal maze', 'Op art bricks'),
    ...link('Op art bricks', 'Fish scales'),
    ...link('Fish scales', 'Flower of life'),
    ...link('Flower of life', 'Raindrops on a pond', 'Soap bubbles'),
    ...link('Raindrops on a pond', 'Soak stain', 'Plasma'),
    ...link('Soak stain', 'Confetti'),
    ...link('Confetti', 'Heart tunnel'),
    ...link('Heart tunnel', 'Hyperspace', 'Spiral galaxy'),
    ...link('Spiral galaxy', 'Plasma'),
    ...link('Plasma', 'Soap bubbles'),
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
