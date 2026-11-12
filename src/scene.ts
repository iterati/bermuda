// The durable shapes of a scene, their knob kinds, their addresses and the strict parse of a scene's JSON.
// Angles are in degrees, periods in clock units (beats), and the palette index runs 0 to 1 round the stops.

export type Knob = { value: number; spread?: number; glide?: number; play?: [number, number] } // play: inside the kind's hard range
export type Shape = {
  kind?: ShapeKind // after milestone 1's shapes: absent, the star
  n: number
  m: Knob
  r: Knob
  round: Knob
  twist: Knob
  form?: Knob // every kind but the FORMLESS has one: its own proportion, 0 to 1 (shader.ts SHAPE_GLSL)
  corner?: Knob // iq's opRound: the outline rounded this far out, the shape shrunk by as much first
  onion?: Knob // iq's opOnion: the outline split in two this far either side, after the join
  join?: Join
}
// A second shape smooth-unioned into the first (iq's quadratic smooth minimum, blend wide), offset from the cell's
// middle, by weight from not there (0) to all of it (1); it holds no join and no onion of its own.
export type Join = { shape: Shape; offset: [Knob, Knob]; blend: Knob; weight: Knob }
export type Level = {
  id: string
  link?: string
  weight: Knob
  affine: { scale: Knob; turn: Knob; offset: [Knob, Knob] }
  variations: { kind: VariationKind; weight: Knob }[]
  lattice: {
    kind: LatticeKind
    e2: [Knob, Knob]
    jitter?: Knob // voronoi's, and only voronoi's
    sectors?: number // polar's and logpolar's: the whole number of cells round the centre
  }
  cell: { by: (typeof CELLS)[number]; turn: Knob; phase: Knob; spill?: Knob } // spill: after milestone 1
  variants: { share: Knob; shape: Shape; below?: Level[] }[] // below: a per-cell sub-chain
  colour: { at: Knob; speed: Knob; cellSpread: Knob }
}
export type Scene = {
  // a look: play ranges and macros travel with it
  name: string
  // under the lines, coloured from the palette; absent, black as before
  background?: {
    kind: (typeof BACKGROUNDS)[number]
    at: [Knob, Knob] // palette places: the flat colour; the gradient's two ends; the soak's first and last pigment
    amount: Knob // how much shows: 0 is black
    turn: Knob // the gradient's direction
    scale: Knob // the soak's pool size: each pool about half of it across, in screen heights
    edge: Knob // how dark the stain gathers at each pool's edge
    seep: Knob // where the stain has seeped to, round once from 0 to 1
  }
  frame: { origin: [Knob, Knob]; zoom: Knob; turn: Knob }
  levels: Level[]
  contour: { rings: Knob; drift: Knob; radialWeight: Knob }
  line: {
    kind: (typeof LINES)[number]
    width: Knob
    falloff: Knob
    units: 'cell' | 'screen'
    dots?: Dots // after milestone 1's shapes, and there whenever the kind is dots
  }
  palette: {
    stops: { at: number; lch: [Knob, Knob, Knob]; mix: 'straight' | 'short' | 'long' }[]
    hue: Knob
    contrast: Knob
    radius: Knob
    time: Knob
    trap?: Trap // after milestone 1's shapes
  }
  composite: 'add' | 'first'
  post: { aa: 1 | 2 | 3; gamma: Knob }
  modulators: Modulator[]
  macros: Macro[]
  presets: Preset[]
  midi?: Midi[] // after milestone 1's shapes: a look saved before MIDI learn has none
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
  listen?: Listen // music's, milestone 5: absent, it runs on the clock
}
export type Macro = {
  id: string
  name: string
  value: number
  targets: { knob: Address; from: number; to: number }[]
  listen?: Feature // music's, milestone 5: while music plays, the feature sets its value
}
// A controller's control change (CC) number on its channel (1 to 16), driving one knob or one macro; a fader's
// takes pickup: it drives only once it passes the value it drives.
export type MidiTarget = { knob: Address } | { macro: string }
export type Midi = { channel: number; control: number; pickup?: true } & MidiTarget
// A controller's button, a note on its channel, for the whole app: it loads a bank slot, picks a view or steps the
// Perform strip's page forward or back, and its LED is lit while that slot or view is on, or while the strip has
// more than one page.
export type TriggerTarget = { slot: number } | { mode: View } | { page: 1 | -1 }
export type Trigger = { channel: number; note: number } & TriggerTarget
// The app's own MIDI, kept in the browser beside the looks: its buttons, the CC on the A/B fader (with pickup
// for a fader, as a look's mappings take it), and the CCs on the Perform strip's slots, index 0 to 7 of the page
// showing, on every look.
export type Controls = {
  buttons: Trigger[]
  fader?: { channel: number; control: number; pickup?: true }
  strip?: { channel: number; control: number; index: number }[]
}
export type Edge = { seconds: number; stagger: number; deepFirst: boolean }
// scenes: its entries, each a look's name or a look's and one of its presets' ('look / preset'); links: pairs of
// entries, either way round; every: the autopilot's pace, in clock units between its changes
export type Bank = {
  scenes: string[]
  links: [string, string][]
  autopilot: { on: boolean; every: number; busy: number; change: number; wander: number; edge: Edge }
  moods: Macro[]
}
// Direct's timeline over a song: its file's name, its tempo (the clock the scenes' periods count in), ordered keys,
// each a bank entry (a look, or 'look / preset') and the edge into it, landing at its at (seconds), and drawn curves,
// each a knob's value over its own span (points of seconds and value), straight between its points.
export type Timeline = {
  song: string
  bpm: number
  keys: { at: number; scene: string; edge: Edge }[]
  curves: { knob: Address; points: [number, number][] }[]
}
// Dotted lines: count dots round each outline, each size of the gap to the next along it (round dots of the line's
// width near 0, dashes, a whole line at 1), crawling round at crawl dots a beat.
export type Dots = { count: Knob; size: Knob; crawl: Knob }
// Orbit-trap colour: the palette index moved by weight times how near the pixel's point came, down the chain, to a
// circle of radius size round its cell's middle (iq's point trap at size 0), in each cell's own units.
export type Trap = { weight: Knob; size: Knob }
// The two scenes on the hand fader, where it sits and the edge it runs along: a pair kept as one file.
export type Fader = { a: Scene; b: Scene; at: number; edge: Edge }

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
  // the rest of flam3's that need no parameters of their own and no random draws (julia keeps one of its two roots;
  // loonie, secant2 and scry read their weight as flam3's do)
  'horseshoe',
  'handkerchief',
  'heart',
  'disc',
  'spiral',
  'hyperbolic',
  'diamond',
  'ex',
  'julia',
  'bent',
  'exponential',
  'power',
  'cosine',
  'eyefish',
  'cylinder',
  'tangent',
  'secant2',
  'cross',
  'butterfly',
  'edisc',
  'elliptic',
  'foci',
  'loonie',
  'polar2',
  'scry',
  'exp',
  'log',
  'sin',
  'cos',
  'tan',
  'sec',
  'csc',
  'cot',
  'sinh',
  'cosh',
  'tanh',
  'sech',
  'csch',
  'coth',
] as const
export type LatticeKind = (typeof LATTICES)[number]
// each lattice reads e2 its own way (shader.ts): the second lattice vector of the oblique pad, which
// voronoi jitters and triangle halves; brick's row shift and height; polar's and logpolar's ring stagger
// and spacing; fold's shift
export const LATTICES = ['oblique', 'brick', 'triangle', 'polar', 'logpolar', 'fold', 'voronoi'] as const
// the Cell step: parity turns odd cells the other way, hash turns each cell either way by its id (Truchet), ring
// turns and phases each cell as far as it is out from the middle, mirror reflects the cells of odd id across
// each axis (iq's mirrored repetition: exact on rectangular pads; elsewhere neighbours along e2 meet off true)
export const CELLS = ['none', 'parity', 'hash', 'ring', 'mirror'] as const
// the lattices whose cells are translates of each other, so a shape can spill into the cells round it
export const SPILLS: readonly LatticeKind[] = ['oblique', 'brick', 'triangle', 'voronoi']
export type ShapeKind = (typeof SHAPES)[number]
// iq's 2D distance functions, each a shape module beside the star (shader.ts draws them)
export const SHAPES = [
  'star',
  'box',
  'rhombus',
  'triangle',
  'trapezoid',
  'parallelogram',
  'capsule',
  'pie',
  'arc',
  'horseshoe',
  'vesica',
  'moon',
  'heart',
  'cross',
  'roundX',
  'blobbyCross',
  'ellipse',
  'cutDisk',
  'circleWave',
  'segment',
  'stairs',
  'coolS',
] as const
// the kinds with no proportion of their own, so no form
export const FORMLESS: readonly ShapeKind[] = ['star', 'heart', 'coolS']
export const LINES = ['glow', 'smooth', 'hard', 'band', 'dots'] as const
// soak: Helen Frankenthaler's soak-stain pools of thinned paint on raw canvas
export const BACKGROUNDS = ['flat', 'gradient', 'soak'] as const
export const WAVES = ['cos', 'tri', 'beat', 'ramp', 'steps'] as const
// What the app hears in the music (music.ts), each 0 to 1: the loudness, the tone (dark to light), the drive (a
// sensual groove to a beat to speed to) and eight bands, low to high.
export const BANDS = ['sub', 'bass', 'low', 'lowmid', 'mid', 'highmid', 'presence', 'air'] as const
export const FEATURES = ['level', 'tone', 'drive', ...BANDS] as const
export type Feature = (typeof FEATURES)[number]
// A modulator listens to the beats, its wave run on the music's beats instead of the clock, or to a feature, which
// it plays instead of its wave, pushing its knobs up by depth at 1; with no music it rests, moving nothing.
export const LISTENS = ['beats', ...FEATURES] as const
export type Listen = (typeof LISTENS)[number]
export const MIXES = ['straight', 'short', 'long'] as const
// the views a MIDI button can pick
export const VIEWS = ['stage', 'edit', 'decks'] as const
export type View = (typeof VIEWS)[number]
// the scene's fixed parts beside its levels, each a chip of the chain: no level may take one's name
export const CHIPS = ['background', 'frame', 'contour', 'line', 'palette', 'post'] as const
export const MAX_LEVELS = 32
export const MAX_DEPTH = 16
export const MAX_VARIANTS = 4
export const MAX_STOPS = 8

// Every knob kind, keyed by its address with the level ids and list indices taken out (see kindOf): its hard range,
// its name and its line of help (the knob's hover title), and the flags below. Every value a scene holds and every
// play range sits inside its kind's range.
export type Kind = {
  range: [number, number]
  label: string // the knob's short name, for the title and the Perform strip
  help: string // one line: what turning it does
  top?: true // a kind a player reaches for: it fills the Perform strip after the macros
  shows?: (scene: Scene, at: KnobAt) => boolean // false: dead under the scene's current settings
  rest?: number // the value at which it does nothing, the one level() and scene() give it (looks.ts)
}
// the echo rings can show: rings above 0, a spread on them, or a modulator or macro driving them
const ringsShow = (scene: Scene) =>
  scene.contour.rings.value > 0 ||
  !!scene.contour.rings.spread ||
  [...scene.modulators, ...scene.macros].some((m) => m.targets.some((t) => t.knob === 'contour.rings'))
// the knob is this shape's m and the shape is a star, the one kind that reads m
const starM = (shape: Shape | undefined, at: KnobAt) => shape?.m === at.knob && (shape.kind ?? 'star') === 'star'
const dotted = (scene: Scene) => scene.line.kind === 'dots'
const soaked = (scene: Scene) => scene.background?.kind === 'soak'
export const KINDS: Record<string, Kind> = {
  'background.at[0]': {
    range: [0, 1],
    label: 'colour',
    help: "the flat colour, the gradient's first end and the soak's first pigment: a place round the palette",
    top: true,
  },
  'background.at[1]': {
    range: [0, 1],
    label: 'colour 2',
    help: "the gradient's far end and the soak's last pigment, a place round the palette; the soak's middle pool sits between",
    shows: (s) => s.background?.kind === 'gradient' || soaked(s),
  },
  'background.amount': {
    range: [0, 1],
    label: 'amount',
    help: 'how much background shows under the lines: 0 is black, as before',
    top: true,
  },
  'background.turn': {
    range: [-360, 360],
    label: 'turn',
    help: "the gradient's direction, in degrees",
    shows: (s) => s.background?.kind === 'gradient',
  },
  'background.scale': {
    range: [0.1, 4],
    label: 'pool size',
    help: "how big the soak's pools are: each about half of it across, in screen heights",
    shows: soaked,
  },
  'background.edge': {
    range: [0, 1],
    label: 'edge',
    help: "how dark the stain gathers at each pool's edge, where the pigment pooled",
    shows: soaked,
  },
  'background.seep': {
    range: [0, 1],
    label: 'seep',
    help: 'where the stain has seeped to, round once from 0 to 1; put a ramp modulator on it to keep it moving',
    shows: soaked,
  },
  'frame.origin[0]': {
    range: [-4, 4],
    label: 'origin x',
    help: "which point of the plane sits at the screen's centre, across: slides the whole picture sideways",
    rest: 0,
  },
  'frame.origin[1]': {
    range: [-4, 4],
    label: 'origin y',
    help: "which point of the plane sits at the screen's centre, up and down: slides the whole picture vertically",
    rest: 0,
  },
  'frame.zoom': {
    range: [0.1, 8],
    label: 'zoom',
    help: 'magnifies the whole picture; lines in screen units keep their width',
    top: true,
  },
  'frame.turn': {
    range: [-360, 360],
    label: 'turn',
    help: "turns the whole picture round the screen's centre, in degrees",
    rest: 0,
  },
  'levels[].weight': {
    range: [0, 1],
    label: 'weight',
    help: 'how much of this level there is: 0 passes the plane through untouched and draws nothing, 1 is the whole level',
    rest: 1,
  },
  'levels[].affine.scale': {
    range: [0.1, 8],
    label: 'scale',
    help: "how many cells fit across: higher packs this level's cells smaller and tighter",
    top: true,
  },
  'levels[].affine.turn': {
    range: [-360, 360],
    label: 'turn',
    help: "turns this level's grid before it tiles, in degrees",
    top: true,
  },
  'levels[].affine.offset[0]': {
    range: [-2, 2],
    label: 'offset x',
    help: "slides this level's grid sideways, in cells",
    rest: 0,
  },
  'levels[].affine.offset[1]': {
    range: [-2, 2],
    label: 'offset y',
    help: "slides this level's grid up and down, in cells",
    rest: 0,
  },
  'levels[].variations[].weight': {
    range: [-1, 2],
    label: 'variation',
    help: 'how strongly this variation (a flam3 warp) bends the plane before it tiles; linear alone at 1 leaves it straight',
  },
  'levels[].lattice.e2[0]': {
    range: [0, 0.5],
    label: 'shear',
    help: 'slides each row of cells along, as the lattice reads it: on the oblique pad 0 is square, 0.5 (with height 0.87) is hex',
    top: true,
  },
  'levels[].lattice.e2[1]': {
    range: [0.5, 2],
    label: 'height',
    help: 'the distance between rows of cells, as the lattice reads it: on the oblique pad 1 is square, 0.87 (with shear 0.5) is hex',
    top: true,
  },
  'levels[].lattice.jitter': {
    range: [0, 1],
    label: 'jitter',
    help: "moves each voronoi cell's point at random inside its pad: 0 is the pad itself, 1 organic cells",
  },
  'levels[].cell.turn': {
    range: [-180, 180],
    label: 'cell turn',
    help: 'turns every cell and the levels below, in degrees: parity turns odd cells back, hash each cell either way, ring by how far out it is',
    rest: 0,
  },
  'levels[].cell.phase': {
    range: [-1, 1],
    label: 'ring phase',
    help: "shifts this level's echo rings by part of their spacing (0.5 a whole ring); flipped cells shift back, ring by how far out; needs rings",
    shows: ringsShow,
    rest: 0,
  },
  'levels[].cell.spill': {
    range: [0, 1],
    label: 'spill',
    help: 'fades in the outlines of the shapes of the cells round each cell, where they reach into it: 0 each cell draws its own alone',
  },
  'levels[].variants[].share': {
    range: [0, 1],
    label: 'share',
    help: "how often cells pick this variant, against the shares of the level's other variants",
    shows: (_, at) => at.level!.level.variants.length > 1,
  },
  'levels[].variants[].shape.m': {
    range: [1.01, 16],
    label: 'm',
    help: "the star's character: near 1 a sharp dual star, 2 a plain polygon, up to the point count for thin spokes",
    top: true,
    shows: (_, at) => at.level!.level.variants.some((v) => starM(v.shape, at)),
  },
  'levels[].variants[].shape.r': {
    range: [0.02, 2],
    label: 'r',
    help: "the shape's size in its cell: about 0.5 meets the next cell",
    top: true,
  },
  'levels[].variants[].shape.round': {
    range: [0, 1],
    label: 'round',
    help: 'morphs the shape into a circle: 0 is the shape, 1 a circle of radius r',
    top: true,
  },
  'levels[].variants[].shape.twist': {
    range: [-180, 180],
    label: 'twist',
    help: "turns this variant's shape in its cell, in degrees; the levels below don't turn with it",
    rest: 0,
  },
  'levels[].variants[].shape.form': {
    range: [0, 1],
    label: 'form',
    help: "the shape's own proportion, as a box's height or a pie's opening; the star, the heart and the cool S have none",
    top: true,
  },
  'levels[].variants[].shape.corner': {
    range: [0, 0.5],
    label: 'corner',
    help: "rounds the shape's corners out by this much, shrinking it by as much first so it keeps its size",
  },
  'levels[].variants[].shape.onion': {
    range: [0, 0.5],
    label: 'onion',
    help: 'splits the outline in two, this far either side of it, after the join',
  },
  'levels[].variants[].shape.join.shape.m': {
    range: [1.01, 16],
    label: 'join m',
    help: "the joined star's character: near 1 a sharp dual star, 2 a plain polygon, up to the point count for thin spokes",
    shows: (_, at) => at.level!.level.variants.some((v) => starM(v.shape.join?.shape, at)),
  },
  'levels[].variants[].shape.join.shape.r': {
    range: [0.02, 2],
    label: 'join r',
    help: "the joined shape's size, as r is the first shape's",
  },
  'levels[].variants[].shape.join.shape.round': {
    range: [0, 1],
    label: 'join round',
    help: 'morphs the joined shape into a circle: 0 is the shape, 1 a circle of radius r',
  },
  'levels[].variants[].shape.join.shape.twist': {
    range: [-180, 180],
    label: 'join twist',
    help: 'turns the joined shape round its own middle, in degrees',
  },
  'levels[].variants[].shape.join.shape.form': {
    range: [0, 1],
    label: 'join form',
    help: "the joined shape's own proportion, as a box's height or a pie's opening",
  },
  'levels[].variants[].shape.join.shape.corner': {
    range: [0, 0.5],
    label: 'join corner',
    help: "rounds the joined shape's corners out by this much, shrinking it by as much first so it keeps its size",
  },
  'levels[].variants[].shape.join.offset[0]': {
    range: [-1, 1],
    label: 'join x',
    help: "moves the joined shape sideways from the cell's middle",
  },
  'levels[].variants[].shape.join.offset[1]': {
    range: [-1, 1],
    label: 'join y',
    help: "moves the joined shape up and down from the cell's middle",
  },
  'levels[].variants[].shape.join.blend': {
    range: [0, 0.5],
    label: 'blend',
    help: 'how wide the smooth union melts the two shapes into each other: 0 is a sharp seam',
  },
  'levels[].variants[].shape.join.weight': {
    range: [0, 1],
    label: 'join weight',
    help: 'how much of the joined shape there is: 0 none, 1 all of it smooth-unioned in',
  },
  'levels[].colour.at': {
    range: [0, 1],
    label: 'colour at',
    help: "this level's own colour, a place round the palette (0 to 1 is once round); a spread across a link group gives each level its own",
    top: true,
  },
  'levels[].colour.speed': {
    range: [0, 1],
    label: 'colour speed',
    help: "how far this level's own colour takes over from the colour handed down from above: 0 keeps the inherited colour, 1 uses its own",
    rest: 0.5,
  },
  'levels[].colour.cellSpread': {
    range: [0, 1],
    label: 'cell spread',
    help: "scatters each cell's colour round the palette from colour at, by up to this much, as far as colour speed lets it",
    rest: 0,
  },
  'contour.rings': {
    range: [0, 24],
    label: 'rings',
    help: 'echo rings round each outline: 0 draws the outline alone, up to 1 fades it into rings, and above 1 packs the rings closer',
    rest: 0,
  },
  'contour.drift': {
    range: [-8, 8],
    label: 'drift',
    help: 'how fast the echo rings flow in or out (the sign picks which), in radians a beat; needs rings',
    shows: ringsShow,
    rest: 0,
  },
  'contour.radialWeight': {
    range: [-3, 3],
    label: 'radial wt',
    help: "fades the lines with distance from the plane's centre: positive darkens the edges, negative brightens them",
    top: true,
  },
  'line.width': {
    range: [0.0002, 0.2],
    label: 'width',
    help: 'how thick the lines are, in cell or screen units as the units menu says',
    top: true,
  },
  'line.falloff': {
    range: [0.3, 3],
    label: 'falloff',
    help: "how softly a line fades at its edge: a glow's, smooth or dotted line's power, a band's soft edge; hard lines don't use it",
    shows: (scene) => scene.line.kind !== 'hard',
    rest: 1.2,
  },
  'line.dots.count': {
    range: [1, 64],
    label: 'dots',
    help: 'how many dots round each outline; between two whole counts the next dot fades in; needs dotted lines',
    shows: dotted,
  },
  'line.dots.size': {
    range: [0, 1],
    label: 'dot size',
    help: "each dot's length, a part of the gap to the next: near 0 round dots of the line's width, 1 a whole line; needs dotted lines",
    shows: dotted,
  },
  'line.dots.crawl': {
    range: [-8, 8],
    label: 'crawl',
    help: 'how fast the dots crawl round each outline (the sign picks which way), in dots a beat; needs dotted lines',
    shows: dotted,
  },
  'palette.stops[].lch[0]': {
    range: [0, 1],
    label: 'L',
    help: "this stop's lightness, 0 black to 1 white",
  },
  'palette.stops[].lch[1]': {
    range: [0, 0.37],
    label: 'C',
    help: "this stop's colourfulness, 0 grey to 0.37 the most vivid",
  },
  'palette.stops[].lch[2]': {
    range: [0, 360],
    label: 'h',
    help: "this stop's hue, in degrees round the colour wheel",
  },
  'palette.hue': {
    range: [-360, 360],
    label: 'hue',
    help: 'turns every colour of the palette round the colour wheel, in degrees',
    top: true,
  },
  'palette.contrast': {
    range: [0, 2],
    label: 'contrast',
    help: "spreads the palette's lightness away from the middle: 1 as the stops set it, 0 every colour at mid lightness",
    rest: 1,
  },
  'palette.radius': {
    range: [-2, 2],
    label: 'radius',
    help: "colours by distance from the plane's centre: each unit out moves this far round the palette, before the levels take their own colours",
    rest: 0.4,
  },
  'palette.time': {
    range: [-2, 2],
    label: 'time',
    help: 'cycles every colour round the palette, in turns a beat',
    rest: 0,
  },
  'palette.trap.weight': {
    range: [-4, 4],
    label: 'trap',
    help: "how far the orbit trap moves the palette index: the nearer a point's path came to the trap, the further round",
  },
  'palette.trap.size': {
    range: [0, 1],
    label: 'trap size',
    help: "the radius of the trap's circle round each cell's middle; 0 is iq's point trap",
  },
  'post.gamma': {
    range: [0.5, 3],
    label: 'gamma',
    help: 'lifts the mid-tones above 1 and darkens them below; 1 leaves the lines as drawn',
    rest: 2.2,
  },
}
export const STAR_N: [number, number] = [3, 16]
export const SECTORS: [number, number] = [1, 48]
// The knob kinds that come round, by the period they repeat over: a turn, once round the palette index, once
// round a ring's phase. Each hard range is a whole number of periods, so a value carried past one wraps.
export const PERIOD: Record<string, number> = {
  'background.at[0]': 1,
  'background.at[1]': 1,
  'background.turn': 360,
  'background.seep': 1,
  'frame.turn': 360,
  'levels[].affine.turn': 360,
  'levels[].cell.turn': 360,
  'levels[].cell.phase': 1,
  'levels[].variants[].shape.twist': 360,
  'levels[].variants[].shape.join.shape.twist': 360,
  'levels[].colour.at': 1,
  'palette.stops[].lch[2]': 360,
  'palette.hue': 360,
}

// 'levels[a].variants[1].below[b].affine.offset[0]' -> 'levels[].affine.offset[0]'
export function kindOf(address: Address): string {
  return address
    .replace(/\[[^\]]*\](?!$)/g, '[]')
    .replace(/\[[^\d\]][^\]]*\]$/, '[]')
    .replace(/(\.variants\[\]\.below\[\])+/g, '')
}

export function knobKind(address: Address): Kind {
  const kind = KINDS[kindOf(address)]
  if (!kind) throw new Error(`${address}: no knob kind`)
  return kind
}

export function hardRange(address: Address): [number, number] {
  return knobKind(address).range
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
  const { background, frame, levels, contour, line, palette, post } = scene
  walk({ background, frame, levels, contour, line, palette, post }, '', undefined)
  return out
}

// The knobs a chip of the chain shows, in knobsOf order: a fixed part's, or a level's (a linked level's are its
// leader's, which it plays).
export function chipKnobs(scene: Scene, chip: string): KnobAt[] {
  const all = knobsOf(scene)
  if ((CHIPS as readonly string[]).includes(chip)) return all.filter((k) => k.address.startsWith(`${chip}.`))
  const at = allLevels(scene.levels).find(({ level }) => level.id === chip)
  const id = at?.level.link ?? chip
  return all.filter((k) => k.level?.level.id === id)
}

// The Perform strip: every macro of the scene, then the chip's top knobs that are not dead. Its pages are runs of 8.
export function strip(scene: Scene, chip: string): MidiTarget[] {
  return [
    ...scene.macros.map((m) => ({ macro: m.id })),
    ...chipKnobs(scene, chip)
      .filter((at) => {
        const kind = knobKind(at.address)
        return kind.top && (!kind.shows || kind.shows(scene, at))
      })
      .map((at) => ({ knob: at.address })),
  ]
}
export const STRIP = 8

// A knob to fold out of sight: dead under the scene's settings, or at its kind's rest and untouched, with no spread,
// play range or glide, no modulator or macro on it, no preset holding it elsewhere and no MIDI control on it.
export function folded(scene: Scene, at: KnobAt): boolean {
  const kind = knobKind(at.address)
  if (kind.shows && !kind.shows(scene, at)) return true
  const { address, knob } = at
  const still = (v: number) => kind.rest !== undefined && Math.abs(v - kind.rest) < 1e-9
  return (
    still(knob.value) &&
    !knob.spread &&
    !knob.play &&
    !knob.glide &&
    ![...scene.modulators, ...scene.macros].some((m) => m.targets.some((t) => t.knob === address)) &&
    scene.presets.every((p) => !(address in p.values) || still(p.values[address])) &&
    !scene.midi?.some((m) => 'knob' in m && m.knob === address)
  )
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
export function depthOf<T extends { variants: { below?: T[] }[] }>(levels: T[]): number {
  return Math.max(
    0,
    ...levels.map((level, i) =>
      Math.max(levels.length, i + 1 + Math.max(0, ...level.variants.map((v) => (v.below ? depthOf(v.below) : 0)))),
    ),
  )
}

// The summed weight of a level's variations of one kind.
export const variationWeight = (level: Level, kind: VariationKind) =>
  level.variations.filter((v) => v.kind === kind).reduce((sum, v) => sum + v.weight.value, 0)

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
function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') return fail(path, 'must be true or false')
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

// A shape: the star's knobs, a kind's form for every kind but the FORMLESS, and corner, onion and join when given;
// a joined shape holds no join or onion of its own.
function shape(v: unknown, path: string, joined = false): Shape {
  const o = obj(
    v,
    path,
    ['n', 'm', 'r', 'round', 'twist'],
    joined ? ['kind', 'form', 'corner'] : ['kind', 'form', 'corner', 'onion', 'join'],
  )
  const n = num(o.n, `${path}.n`, STAR_N)
  if (!Number.isInteger(n)) fail(`${path}.n`, 'must be a whole number')
  const out: Shape = {
    n,
    m: knob(o.m, `${path}.m`),
    r: knob(o.r, `${path}.r`),
    round: knob(o.round, `${path}.round`),
    twist: knob(o.twist, `${path}.twist`),
  }
  if (o.kind !== undefined) out.kind = oneOf(o.kind, `${path}.kind`, SHAPES)
  const kind = out.kind ?? 'star'
  if (FORMLESS.includes(kind)) {
    if (o.form !== undefined) fail(`${path}.form`, `is not a field of a ${kind}`)
  } else if (o.form === undefined) fail(`${path}.form`, `is missing for a ${kind}`)
  else out.form = knob(o.form, `${path}.form`)
  if (o.corner !== undefined) out.corner = knob(o.corner, `${path}.corner`)
  if (o.onion !== undefined) out.onion = knob(o.onion, `${path}.onion`)
  if (o.join !== undefined) {
    const at = `${path}.join`
    const j = obj(o.join, at, ['shape', 'offset', 'blend', 'weight'])
    out.join = {
      shape: shape(j.shape, `${at}.shape`, true),
      offset: pair(j.offset, `${at}.offset`, knob),
      blend: knob(j.blend, `${at}.blend`),
      weight: knob(j.weight, `${at}.weight`),
    }
  }
  return out
}

function levelList(v: unknown, path: string, ids: Set<string>): Level[] {
  const items = list(v, path, 1, MAX_LEVELS)
  const out: Level[] = []
  items.forEach((item, i) => {
    const id = str((item as Json | null)?.id, `${path}[${i}].id`)
    if (!/^[A-Za-z][\w-]*$/.test(id))
      fail(`${path}[${i}].id`, 'must start with a letter and hold only letters, digits, _ and -')
    if (ids.has(id)) fail(`${path}[${i}].id`, `${id} is used twice`)
    if ((CHIPS as readonly string[]).includes(id)) fail(`${path}[${i}].id`, `${id} names a fixed part of the scene`)
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
  const lattice = obj(o.lattice, `${path}.lattice`, ['kind', 'e2'], ['jitter', 'sectors'])
  out.lattice = {
    kind: oneOf(lattice.kind, `${path}.lattice.kind`, LATTICES),
    e2: pair(lattice.e2, `${path}.lattice.e2`, knob),
  }
  const { kind } = out.lattice
  if (kind === 'voronoi') {
    if (lattice.jitter === undefined) fail(`${path}.lattice.jitter`, 'is missing for a voronoi lattice')
    out.lattice.jitter = knob(lattice.jitter, `${path}.lattice.jitter`)
  } else if (lattice.jitter !== undefined) fail(`${path}.lattice.jitter`, 'is voronoi only')
  if (kind === 'polar' || kind === 'logpolar') {
    if (lattice.sectors === undefined) fail(`${path}.lattice.sectors`, `is missing for a ${kind} lattice`)
    const sectors = num(lattice.sectors, `${path}.lattice.sectors`, SECTORS)
    if (!Number.isInteger(sectors)) fail(`${path}.lattice.sectors`, 'must be a whole number')
    out.lattice.sectors = sectors
  } else if (lattice.sectors !== undefined) fail(`${path}.lattice.sectors`, 'is polar and logpolar only')
  const cell = obj(o.cell, `${path}.cell`, ['by', 'turn', 'phase'], ['spill'])
  out.cell = {
    by: oneOf(cell.by, `${path}.cell.by`, CELLS),
    turn: knob(cell.turn, `${path}.cell.turn`),
    phase: knob(cell.phase, `${path}.cell.phase`),
  }
  if (cell.spill !== undefined) {
    if (!SPILLS.includes(kind)) fail(`${path}.cell.spill`, `is not for a ${kind} lattice`)
    out.cell.spill = knob(cell.spill, `${path}.cell.spill`)
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

// A MIDI channel (1 to 16) and control or note number (0 to 127), each pair once in its list.
function midiControl(x: Json, at: string, field: 'control' | 'note', seen: Set<string>): [number, number] {
  const out: [number, number] = [num(x.channel, `${at}.channel`, [1, 16]), num(x[field], `${at}.${field}`, [0, 127])]
  if (!out.every(Number.isInteger)) fail(at, 'channel and number must be whole numbers')
  if (seen.has(String(out))) fail(at, `channel ${out[0]} number ${out[1]} is mapped twice`)
  seen.add(String(out))
  return out
}

// Parse the app's own MIDI (text or a parsed value), as strictly as a scene. A CC drives one thing: the A/B
// fader or one slot of the strip.
export function parseControls(input: unknown): Controls {
  const v = typeof input === 'string' ? (JSON.parse(input) as unknown) : input
  const o = obj(v, '', ['buttons'], ['fader', 'strip'])
  const notes = new Set<string>()
  const ccs = new Set<string>()
  const out: Controls = {
    buttons: list(o.buttons, 'buttons', 0, 256).map((item, i): Trigger => {
      const at = `buttons[${i}]`
      const x = obj(item, at, ['channel', 'note'], ['slot', 'mode', 'page'])
      const [channel, note] = midiControl(x, at, 'note', notes)
      if ([x.slot, x.mode, x.page].filter((t) => t !== undefined).length !== 1)
        fail(at, 'must name one slot, one mode or one page step')
      if (x.mode !== undefined) return { channel, note, mode: oneOf(x.mode, `${at}.mode`, VIEWS) }
      if (x.page !== undefined) return { channel, note, page: oneOf(x.page, `${at}.page`, [1, -1] as const) }
      const slot = num(x.slot, `${at}.slot`, [0, 255])
      if (!Number.isInteger(slot)) fail(`${at}.slot`, 'must be a whole number')
      return { channel, note, slot }
    }),
  }
  if (o.fader !== undefined) {
    const x = obj(o.fader, 'fader', ['channel', 'control'], ['pickup'])
    const [channel, control] = midiControl(x, 'fader', 'control', ccs)
    if (x.pickup !== undefined && x.pickup !== true) fail('fader.pickup', 'must be true when given')
    out.fader = x.pickup === true ? { channel, control, pickup: true } : { channel, control }
  }
  if (o.strip !== undefined) {
    const slots = new Set<number>()
    out.strip = list(o.strip, 'strip', 0, STRIP).map((item, i) => {
      const at = `strip[${i}]`
      const x = obj(item, at, ['channel', 'control', 'index'])
      const [channel, control] = midiControl(x, at, 'control', ccs)
      const index = num(x.index, `${at}.index`, [0, STRIP - 1])
      if (!Number.isInteger(index)) fail(`${at}.index`, 'must be a whole number')
      if (slots.has(index)) fail(`${at}.index`, `slot ${index} is mapped twice`)
      slots.add(index)
      return { channel, control, index }
    })
  }
  return out
}

// Parse a scene's JSON (text or a parsed value): refuse anything off the shapes above, naming the field.
export function parseScene(input: unknown): Scene {
  const v = typeof input === 'string' ? (JSON.parse(input) as unknown) : input
  const o = obj(
    v,
    '',
    ['name', 'frame', 'levels', 'contour', 'line', 'palette', 'composite', 'post', 'modulators', 'macros', 'presets'],
    ['background', 'midi', 'loop'],
  )
  const ids = new Set<string>()
  const frame = obj(o.frame, 'frame', ['origin', 'zoom', 'turn'])
  const contour = obj(o.contour, 'contour', ['rings', 'drift', 'radialWeight'])
  const line = obj(o.line, 'line', ['kind', 'width', 'falloff', 'units'], ['dots'])
  const palette = obj(o.palette, 'palette', ['stops', 'hue', 'contrast', 'radius', 'time'], ['trap'])
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
  if (line.dots !== undefined) {
    const dots = obj(line.dots, 'line.dots', ['count', 'size', 'crawl'])
    scene.line.dots = {
      count: knob(dots.count, 'line.dots.count'),
      size: knob(dots.size, 'line.dots.size'),
      crawl: knob(dots.crawl, 'line.dots.crawl'),
    }
  } else if (scene.line.kind === 'dots') fail('line.dots', 'is missing for dotted lines')
  if (palette.trap !== undefined) {
    const trap = obj(palette.trap, 'palette.trap', ['weight', 'size'])
    scene.palette.trap = {
      weight: knob(trap.weight, 'palette.trap.weight'),
      size: knob(trap.size, 'palette.trap.size'),
    }
  }
  scene.palette.stops.forEach((s, i, all) => {
    if (i > 0 && s.at <= all[i - 1].at) fail(`palette.stops[${i}].at`, 'must be above the stop before it')
  })
  if (o.background !== undefined) {
    const bg = obj(o.background, 'background', ['kind', 'at', 'amount', 'turn', 'scale', 'edge', 'seep'])
    scene.background = {
      kind: oneOf(bg.kind, 'background.kind', BACKGROUNDS),
      at: pair(bg.at, 'background.at', knob),
      amount: knob(bg.amount, 'background.amount'),
      turn: knob(bg.turn, 'background.turn'),
      scale: knob(bg.scale, 'background.scale'),
      edge: knob(bg.edge, 'background.edge'),
      seep: knob(bg.seep, 'background.seep'),
    }
  }
  if (allLevels(scene.levels).length > MAX_LEVELS)
    fail('levels', `must hold at most ${MAX_LEVELS} levels, sub-chains included`)
  if (depthOf(scene.levels) > MAX_DEPTH) fail('levels', `must chain at most ${MAX_DEPTH} levels deep`)

  const modIds = new Set<string>()
  scene.modulators = list(o.modulators, 'modulators', 0, 64).map((item, i) => {
    const at = `modulators[${i}]`
    const x = obj(item, at, ['id', 'wave', 'period', 'phase', 'glide', 'targets'], ['harmonics', 'steps', 'listen'])
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
    if (x.listen !== undefined) m.listen = oneOf(x.listen, `${at}.listen`, LISTENS)
    if (m.wave === 'steps' && !m.steps) fail(`${at}.steps`, 'is missing for a steps wave')
    if (m.wave === 'beat' && !m.harmonics) fail(`${at}.harmonics`, 'is missing for a beat wave')
    return m
  })
  scene.macros = macros(o.macros, 'macros', (v, path) => address(scene, v, path))
  scene.presets = list(o.presets, 'presets', 0, 256).map((item, i) => {
    const at = `presets[${i}]`
    const x = obj(item, at, ['name', 'values'])
    const values = obj(x.values, `${at}.values`, [], Object.keys((x.values as Json | null) ?? {}))
    const out: Record<Address, number> = {}
    for (const [k, value] of Object.entries(values))
      out[address(scene, k, `${at}.values`)] = num(value, `${at}.values.${k}`, hardRange(k))
    return { name: str(x.name, `${at}.name`), values: out }
  })
  if (o.midi !== undefined) {
    const controls = new Set<string>()
    scene.midi = list(o.midi, 'midi', 0, 256).map((item, i): Midi => {
      const at = `midi[${i}]`
      const x = obj(item, at, ['channel', 'control'], ['knob', 'macro', 'pickup'])
      const [channel, control] = midiControl(x, at, 'control', controls)
      if (x.pickup !== undefined && x.pickup !== true) fail(`${at}.pickup`, 'must be true when given')
      const pickup = x.pickup === true ? { pickup: true as const } : {}
      if ((x.knob === undefined) === (x.macro === undefined)) fail(at, 'must name one knob or one macro')
      if (x.knob !== undefined) return { channel, control, ...pickup, knob: address(scene, x.knob, `${at}.knob`) }
      const macro = str(x.macro, `${at}.macro`)
      if (!scene.macros.some((m) => m.id === macro)) fail(`${at}.macro`, `${macro} names no macro`)
      return { channel, control, ...pickup, macro }
    })
  }
  if (o.loop !== undefined) {
    const loop = obj(o.loop, 'loop', ['seconds'])
    scene.loop = { seconds: num(loop.seconds, 'loop.seconds', [0.1, 3600]) }
  }
  return scene
}

// A list of macros, each target's knob read by address (which refuses one that names no knob).
function macros(v: unknown, path: string, address: (v: unknown, path: string) => Address): Macro[] {
  const ids = new Set<string>()
  return list(v, path, 0, 64).map((item, i) => {
    const at = `${path}[${i}]`
    const x = obj(item, at, ['id', 'name', 'value', 'targets'], ['listen'])
    const id = str(x.id, `${at}.id`)
    if (ids.has(id)) fail(`${at}.id`, `${id} is used twice`)
    ids.add(id)
    const macro: Macro = {
      id,
      name: str(x.name, `${at}.name`),
      value: num(x.value, `${at}.value`, [0, 1]),
      targets: list(x.targets, `${at}.targets`, 0, 256).map((t, j) => {
        const p = `${at}.targets[${j}]`
        const tt = obj(t, p, ['knob', 'from', 'to'])
        const knobAt = address(tt.knob, `${p}.knob`)
        return {
          knob: knobAt,
          from: num(tt.from, `${p}.from`, hardRange(knobAt)),
          to: num(tt.to, `${p}.to`, hardRange(knobAt)),
        }
      }),
    }
    if (x.listen !== undefined) macro.listen = oneOf(x.listen, `${at}.listen`, FEATURES)
    return macro
  })
}

function edge(v: unknown, path: string): Edge {
  const o = obj(v, path, ['seconds', 'stagger', 'deepFirst'])
  return {
    seconds: num(o.seconds, `${path}.seconds`, [0, 600]),
    stagger: num(o.stagger, `${path}.stagger`, [0, 1]),
    deepFirst: bool(o.deepFirst, `${path}.deepFirst`),
  }
}

// Parse a fader pair's JSON: both scenes as parseScene takes them, their errors named under a. and b.
export function parseFader(input: unknown): Fader {
  const v = typeof input === 'string' ? (JSON.parse(input) as unknown) : input
  const o = obj(v, '', ['a', 'b', 'at', 'edge'])
  const side = (s: unknown, key: string) => {
    try {
      return parseScene(s)
    } catch (err) {
      if (err instanceof SceneError) throw new SceneError(`${key}.${err.message}`)
      throw err
    }
  }
  return { a: side(o.a, 'a'), b: side(o.b, 'b'), at: num(o.at, 'at', [0, 1]), edge: edge(o.edge, 'edge') }
}

// Parse a bank's JSON. Its entries are names, checked against the looks where it loads; a mood's targets are
// addresses of any scene's knobs, so each is checked only for naming a knob kind.
export function parseBank(input: unknown): Bank {
  const v = typeof input === 'string' ? (JSON.parse(input) as unknown) : input
  const o = obj(v, '', ['scenes', 'links', 'autopilot', 'moods'])
  const scenes = list(o.scenes, 'scenes', 0, 256).map((s, i) => str(s, `scenes[${i}]`))
  scenes.forEach((s, i) => {
    if (scenes.indexOf(s) < i) fail(`scenes[${i}]`, `${s} is in the bank twice`)
  })
  const seen = new Set<string>()
  const links = list(o.links, 'links', 0, 4096).map((l, i) =>
    pair(l, `links[${i}]`, (s, at) => {
      const name = str(s, at)
      if (!scenes.includes(name)) fail(at, `${name} is not in the bank`)
      return name
    }),
  )
  links.forEach(([a, b], i) => {
    if (a === b) fail(`links[${i}]`, `links ${a} to itself`)
    const key = JSON.stringify([a, b].sort())
    if (seen.has(key)) fail(`links[${i}]`, `${a} and ${b} are linked twice`)
    seen.add(key)
  })
  const auto = obj(o.autopilot, 'autopilot', ['on', 'every', 'busy', 'change', 'wander', 'edge'])
  return {
    scenes,
    links,
    autopilot: {
      on: bool(auto.on, 'autopilot.on'),
      every: num(auto.every, 'autopilot.every', [0.25, 1024]),
      busy: num(auto.busy, 'autopilot.busy', [0, 1]),
      change: num(auto.change, 'autopilot.change', [0, 1]),
      wander: num(auto.wander, 'autopilot.wander', [0, 1]),
      edge: edge(auto.edge, 'autopilot.edge'),
    },
    moods: macros(o.moods, 'moods', (a, path) => {
      const knob = str(a, path)
      if (!KINDS[kindOf(knob)]) fail(path, `${knob} names no knob kind`)
      return knob
    }),
  }
}

// Parse a timeline's JSON. Its keys' scenes are entry names, checked against the looks where it loads; a curve's
// knob is an address of any scene's knobs, so it is checked only for naming a knob kind, and its values against
// that kind's hard range.
export function parseTimeline(input: unknown): Timeline {
  const v = typeof input === 'string' ? (JSON.parse(input) as unknown) : input
  const o = obj(v, '', ['song', 'bpm', 'keys', 'curves'])
  const keys = list(o.keys, 'keys', 1, 4096).map((item, i) => {
    const at = `keys[${i}]`
    const x = obj(item, at, ['at', 'scene', 'edge'])
    return {
      at: num(x.at, `${at}.at`, [0, 86400]),
      scene: str(x.scene, `${at}.scene`),
      edge: edge(x.edge, `${at}.edge`),
    }
  })
  keys.forEach((k, i) => {
    if (i > 0 && k.at < keys[i - 1].at) fail(`keys[${i}].at`, 'must be at or after the key before it')
  })
  const knobs = new Set<string>()
  const curves = list(o.curves, 'curves', 0, 256).map((item, i) => {
    const at = `curves[${i}]`
    const x = obj(item, at, ['knob', 'points'])
    const knob = str(x.knob, `${at}.knob`)
    if (!KINDS[kindOf(knob)]) fail(`${at}.knob`, `${knob} names no knob kind`)
    if (knobs.has(knob)) fail(`${at}.knob`, `${knob} has a curve already`)
    knobs.add(knob)
    const points = list(x.points, `${at}.points`, 2, 100000).map((p, j): [number, number] => {
      const [t, value] = list(p, `${at}.points[${j}]`, 2, 2)
      return [num(t, `${at}.points[${j}][0]`, [0, 86400]), num(value, `${at}.points[${j}][1]`, hardRange(knob))]
    })
    points.forEach(([t], j) => {
      if (j > 0 && t <= points[j - 1][0]) fail(`${at}.points[${j}]`, 'must come after the point before it')
    })
    return { knob, points }
  })
  return { song: str(o.song, 'song'), bpm: num(o.bpm, 'bpm', [10, 300]), keys, curves }
}
