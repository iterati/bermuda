// What an engine of the shader is, and what the engines share. An engine is a family of the shader's parts: which of
// them a scene needs, by what it holds and never by its values; the GLSL it gives each place in the core's text
// (shader.ts), for the parts a program holds; the level row's texels it adds after the core's, and how it packs them;
// and the morph rules of what it alone adds (morph.ts calls them). The UI side of an engine, its fields, parse, kinds
// and chip, is scene.ts's and controls.tsx's.
import { CELLS, LATTICES, type Knob, type LatticeKind, type Level, type Scene } from '../scene'
import type { Part } from '../shader'

// The places in the core's text an engine fills, in the text's order; a place no engine fills keeps the core's own
// text there, which is nothing but where named.
export type Place =
  | 'defines' // the preprocessor's, first
  | 'shapeFunctions' // after dot2: the shapes' own functions
  | 'shapeCases' // sdKind's cases
  | 'afterShape' // after shapeOf
  | 'afterOblique' // after oblique
  | 'beforeVary' // before vary
  | 'vary' // vary's body
  | 'lattice' // lattice's body
  | 'palette' // palette's segment, before its contrast
  | 'beforeLine' // before lineOf
  | 'lineTail' // lineOf's last kinds: band's return
  | 'afterNoise' // after noise
  | 'colourAt' // colourAt's colour: c
  | 'pigment' // pigment's colour: c
  | 'background' // background's last kinds, after the gradient
  | 'variantDist' // variantDist's shape, before its onion
  | 'drawn' // drawn's line, before its fade
  | 'afterDrawn' // after drawn
  | 'beforeRender' // before level, the walk's step
  | 'flag' // a level's first, ahead of its point
  | 'point' // a level's point: q = vary(q0, j)
  | 'cells' // a level's cells and line: the own cell's alone
  | 'fieldAtCells' // a field at cells, after the cell's shift
  | 'ancestry' // a level's colour, ahead of its own index
  | 'paint' // a level's colour, ahead of its line's
  | 'walks' // render's, ahead of its walk down the chain
  | 'level' // render's step down the chain: Draw d = level(s, ground, i, 0., 0.)
  | 'crossChain' // main's chains a sample draws: 1

export type EngineName = 'fractal' | 'shapes' | 'tiling' | 'lines' | 'backgrounds' | 'morph' | 'deco'
// each engine's first texel in a level's row (engines/index.ts lays them out)
export type Layout = Record<EngineName, number>
// whether a program holds a part
export type Has = (part: string) => boolean
// a knob's morph at the fader's place in a level's window
export type KnobMorph = (a: Knob, b: Knob) => Knob

export type Engine = {
  name: EngineName
  // the parts it owns, in PARTS' order
  parts: readonly Part[]
  // add each part the scene holds, sub-chains included (add skips what is not a part)
  needs?: (scene: Scene, add: (part: string) => void) => void
  // its text for each place it fills in a program of these parts
  glsl: (has: Has, layout: Layout) => Partial<Record<Place, string>>
  // the row texels it adds, and its level's values in them, counted from its first
  texels?: number
  pack?: (level: Level, put: (texel: number, ...values: number[]) => void) => void
}

// a variant's texels in the core's row, the join's included
export const VARIANT_TEXELS = 6
export const RAD = Math.PI / 180

// a family's parts: each kind but its first, which the core holds
export const kinds = (family: string, list: readonly string[]) =>
  list.slice(1).map((kind) => `${family}.${kind}` as Part)
// a family's kinds in a program: its first, and each whose part it holds
export const kept = <K extends string>(has: Has, family: string, list: readonly K[]) =>
  list.filter((kind, i) => i === 0 || has(`${family}.${kind}`))
// a Cell step's and a lattice kind's index, as GLSL
export const cell = (by: (typeof CELLS)[number]) => `${CELLS.indexOf(by)}.`
export const lattice = (kind: LatticeKind) => `${LATTICES.indexOf(kind)}.`
