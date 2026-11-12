// The shader's engines, in PARTS' order, and the level row's layout they make: the core's texels (shader.ts), then
// each engine's own, in registry order.
import { MAX_VARIANTS } from '../scene'
import { backgrounds } from './backgrounds'
import { deco } from './deco'
import { VARIANT_TEXELS, type Engine, type EngineName, type Layout } from './engine'
import { fractal } from './fractal'
import { lines } from './lines'
import { morph } from './morph'
import { shapes } from './shapes'
import { tiling } from './tiling'

export const ENGINES: readonly Engine[] = [fractal, shapes, tiling, lines, backgrounds, morph, deco]

const firsts: [EngineName, number][] = []
let next = 8 + VARIANT_TEXELS * MAX_VARIANTS
for (const { name, texels = 0 } of ENGINES) {
  firsts.push([name, next])
  next += texels
}
export const LAYOUT = Object.fromEntries(firsts) as Layout
export const VARY_TEXEL = LAYOUT.fractal
export const FILL_TEXEL = LAYOUT.deco
export const ROW_TEXELS = next
