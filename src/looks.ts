// The built-in looks: four Tapestries made through the level chain, the bank's twenty remixing them, then older remixes.
// Periods are in clock units, one a second at the default 60 bpm; angles are in degrees.
import { stopsFromCosine } from './colour'
import { FORMLESS } from './scene'
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
  palette?: string | Scene['palette']['stops'] // a cosine preset's name, or the stops themselves
  hue?: K
  contrast?: K
  radius?: K
  time?: K
  trap?: { weight: K; size: K }
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
    // one cell as wide as the screen: a star's echo rings run out round the centre, a polar grid of pies over them
    levels: [
      level('target', {
        scale: 0.3,
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
    // (Truchet), its echo rings the maze's corridors
    levels: [
      level('maze', {
        scale: { value: 3, play: [2.5, 4] },
        by: 'hash',
        cellTurn: 45,
        shape: shape('segment', 0.7071, 0.1),
        at: 0.3,
        speed: 0.5,
        cellSpread: 0.15,
      }),
      level('inner', {
        scale: 2,
        by: 'hash',
        cellTurn: 45,
        weight: 0.35,
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
    // colours running round a long palette
    levels: [
      level('field', {
        scale: 0.35,
        vary: [
          ['linear', 0.5],
          ['sinusoidal', { value: 1, play: [0.6, 1.5] }],
        ],
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
        weight: 0.6,
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
      { name: 'Still water', values: { 'levels[pond].cell.phase': 0.05, 'levels[drops].cell.turn': 0 } },
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
        values: { 'levels[tile].variants[0].shape.twist': 80, 'levels[tile].variants[0].shape.form': 0.75 },
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
      { name: 'Point trap', values: { 'palette.trap.size': 0, 'palette.trap.weight': 3.6 } },
      { name: 'Ring trap', values: { 'palette.trap.size': 0.4, 'palette.trap.weight': 2 } },
      palettePreset('Rainbow', 'rainbow'),
    ],
  }),
  scene({
    name: 'flam3 - Hearts and discs',
    zoom: 1.2,
    // one level warped by a blend of flam3's heart, disc, spiral and handkerchief; its presets dial between them
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
        cellSpread: 0.3,
      }),
      level('seeds', { scale: R3, turn: 30, e2: HEX, shape: star(6, 3, 0.4), at: 0.4 }),
      level('dust', { scale: R3, turn: 30, e2: HEX, shape: star(6, 2, 0.35, { twist: 30 }), at: 0.8 }),
    ],
    width: 0.0025,
    falloff: 1.3,
    units: 'screen',
    palette: 'warm',
    radius: 0.2,
    modulators: [
      mod('beat', 'cos', 16, [['levels[warp].variations[1].weight', 0.2]]),
      mod('spin', 'ramp', 60, [['levels[warp].affine.turn', 180]]),
      mod('hue', 'cos', 40, [['palette.hue', 50]]),
    ],
    presets: [
      {
        name: 'Disc',
        values: { 'levels[warp].variations[1].weight': 0, 'levels[warp].variations[2].weight': 1 },
      },
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
      {
        name: 'Round trip',
        values: { 'levels[fn].variations[0].weight': 0.4, 'levels[fn].variations[3].weight': 0.4 },
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
        scale: 1.6,
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
    rings: 1.5,
    drift: 0.6,
    width: { value: 0.0035, spread: 0.004 },
    falloff: 1.2,
    palette: 'ice',
    radius: 0.25,
    modulators: [
      mod('turn', 'ramp', 50, [['levels[root].affine.turn', 180]]),
      mod('ex', 'cos', 22, [['levels[root].variations[1].weight', 0.15]]),
      mod('character', 'tri', 13, [['levels[root].variants[0].shape.m', 1]]),
      mod('hue', 'cos', 45, [['palette.hue', 40]]),
    ],
    presets: [
      { name: 'Ex', values: { 'levels[root].variations[1].weight': 0.4, 'levels[root].variations[0].weight': 0.6 } },
      { name: 'Bent', values: { 'levels[root].variations[2].weight': 0.6 } },
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
  }),
]

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
