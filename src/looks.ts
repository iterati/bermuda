// The built-in looks: the nine Tapestries re-made in spirit through the level chain, then remixes across levels.
// Periods are in clock units, one a second at the default 60 bpm; angles are in degrees.
import { stopsFromCosine } from './colour'
import type { Address, Knob, Level, Macro, Modulator, Preset, Scene, Shape, VariationKind } from './scene'

type K = number | Knob
// a fresh knob each time: linked levels built from one spec must not share knob objects
const k = (x: K): Knob => (typeof x === 'number' ? { value: x } : structuredClone(x))
const R3 = Math.sqrt(3)
const SQUARE: [number, number] = [0, 1]
const HEX: [number, number] = [0.5, R3 / 2]

export const star = (n: number, m: K, r: K, o: { round?: K; twist?: K } = {}): Shape => ({
  n,
  m: k(m),
  r: k(r),
  round: k(o.round ?? 0),
  twist: k(o.twist ?? 0),
})

type LevelSpec = {
  link?: string
  weight?: K
  scale?: K
  turn?: K
  offset?: [K, K]
  vary?: [VariationKind, K][]
  e2?: [K, K]
  parity?: boolean
  cellTurn?: K
  cellPhase?: K
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
    lattice: { kind: 'oblique', e2: [k(s.e2?.[0] ?? SQUARE[0]), k(s.e2?.[1] ?? SQUARE[1])] },
    cell: { by: s.parity ? 'parity' : 'none', turn: k(s.cellTurn ?? 0), phase: k(s.cellPhase ?? 0) },
    variants: (s.variants ?? [{ share: 1, shape: s.shape ?? star(6, 2, 0.4) }]).map((v) => ({
      share: k(v.share),
      shape: structuredClone(v.shape),
      ...(v.below ? { below: v.below } : {}),
    })),
    colour: { at: k(s.at ?? 0), speed: k(s.speed ?? 0.5), cellSpread: k(s.cellSpread ?? 0) },
  }
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
  line: { kind: s.line ?? 'glow', width: k(s.width ?? 0.0025), falloff: k(s.falloff ?? 1.2), units: s.units ?? 'cell' },
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
      ...linked('star', 2, { scale: 1.75, shape: star(6, 3, 0.5), at: 0, speed: 0.4, cellSpread: 0.15 }),
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
    width: { value: 0.012, spread: 0.03 },
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
    zoom: 1.78,
    levels: linked('st', 4, {
      scale: 1.5,
      variants: [4, 6, 8, 12].map((n) => ({ share: 0.25, shape: star(n, n - 0.1, 0.5, { round: 0.5 }) })),
      at: { value: 0, spread: 1 },
      speed: 0.4,
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
      mod('hue', 'cos', 25, [['palette.hue', 30]]),
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
        scale: 0.15,
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
    radius: 0.5,
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
      speed: 0.6,
      cellSpread: 0.2,
    }),
    line: 'smooth',
    width: { value: 0.003, spread: 0.026 },
    falloff: 1,
    radius: 0.3,
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
      parity: true,
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
    rings: 3,
    drift: 0.4,
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
    width: 0.003,
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
      level('wheel', { scale: 0.7, e2: HEX, parity: true, cellTurn: 15, shape: star(6, 3, 0.45), at: 0.05 }),
      level('cross', { scale: 2, turn: 45, shape: spokes(4, 0.45), at: 0.4 }),
      level('hex', { scale: 2, e2: HEX, shape: star(6, 2, 0.4), at: 0.75 }),
    ],
    line: 'smooth',
    width: { value: 0.012, spread: 0.01 },
    falloff: 1,
    palette: 'warm',
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
    zoom: 0.9,
    levels: [
      level('root', {
        scale: 0.55,
        turn: 45,
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
]
