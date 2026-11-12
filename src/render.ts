// The renderer: compiles the one shader once, then each frame packs a live scene into its uniforms
// and level rows and draws one full-screen triangle into whatever framebuffer is bound, over the whole canvas or a
// smaller picture in its bottom-left corner.
import {
  allLevels,
  BACKGROUNDS,
  CELLS,
  LATTICES,
  LINES,
  MAX_LEVELS,
  MIXES,
  SHAPES,
  VARIATIONS,
  variationWeight,
  type Level,
  type Scene,
  type Shape,
} from './scene'
import { generateShader, ROW_TEXELS, VARIANT_TEXELS, VARY_TEXEL } from './shader'
import type { Live } from './motion'

const RAD = Math.PI / 180

// A level's hash seed from its id, so its cells keep their picks wherever the level sits in the chain.
function seedOf(id: string): number {
  let h = 2166136261
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return ((h >>> 0) % 100000) / 1000
}

// The heaviest chain's weight, sub-chains included: with every weight 1 it is the longest chain's length.
function heaviest(levels: Level[]): number {
  let sum = 0
  let best = 0
  for (const level of levels) {
    sum += level.weight.value
    best = Math.max(best, sum + Math.max(0, ...level.variants.map((v) => (v.below ? heaviest(v.below) : 0))))
  }
  return best
}

// A morph's far end, which the scene's own knobs cannot carry: its line kind, units and composite, its rings
// (value, spread: the shader morphs their count and fades each end's echo apart), its stops' mixes, for each drawn
// level in allLevels order whose far end has another id that id and how far through its window it is, its running
// phases (rings, palette, dots' crawl), and how far in it is (0 none, 1 all of it). Where the scene's one drawn level
// swaps a switch, cross is that level with the side's switches it does not draw, whose picture is mixed in by at.
export type Toward = {
  line: Scene['line']['kind']
  rings: [number, number]
  units: Scene['line']['units']
  composite: Scene['composite']
  mixes: Scene['palette']['stops'][number]['mix'][]
  levels: ({ id: string; at: number } | null)[]
  drift: number
  colour: number
  crawl: number
  at: number
  cross?: { levels: Level[]; at: number }
}

const shapeIndex = (shape: Shape) => SHAPES.indexOf(shape.kind ?? 'star')

// The level rows as shader.ts lays them out: every level, sub-chains included, gets a row; a level's next
// row is the one after it in its own list, and a variant's sub-chain replaces the rest of the chain below it. A
// second chain packs into the same data from its start row on.
export function packLevels(
  levels: Level[],
  far: Toward['levels'],
  start = 0,
  data = new Float32Array(MAX_LEVELS * ROW_TEXELS * 4),
): Float32Array<ArrayBuffer> {
  const rows = new Map(allLevels(levels).map(({ level }, i) => [level, start + i]))
  allLevels(levels).forEach(({ level, list }, i) => {
    const row = start + i
    const at = (texel: number, ...values: number[]) => data.set(values, (row * ROW_TEXELS + texel) * 4)
    const next = list[list.indexOf(level) + 1]
    const { affine, lattice, cell, colour, variants } = level
    at(0, level.weight.value, affine.scale.value, affine.turn.value * RAD, next ? rows.get(next)! : -1)
    at(1, affine.offset[0].value, affine.offset[1].value, lattice.e2[0].value, lattice.e2[1].value)
    const weights = VARIATIONS.map((kind) => variationWeight(level, kind))
    at(2, ...weights.slice(0, 8))
    at(VARY_TEXEL, ...weights.slice(8))
    at(4, CELLS.indexOf(cell.by), cell.turn.value * RAD, cell.phase.value * 2 * Math.PI, variants.length)
    at(
      5,
      colour.at.value,
      colour.speed.value,
      colour.cellSpread.value,
      variants.reduce((s, v) => s + v.share.value, 0),
    )
    const other = far[i]
    at(6, seedOf(level.id), seedOf(other?.id ?? level.id), other?.at ?? 0, cell.spill?.value ?? 0)
    at(
      7,
      LATTICES.indexOf(lattice.kind),
      lattice.sectors ?? 0,
      lattice.jitter?.value ?? 0,
      weights.every((w, i) => i === 0 || w === 0) ? 1 : 0,
    )
    variants.forEach(({ share, shape, below }, v) => {
      const base = 8 + VARIANT_TEXELS * v
      const { join } = shape
      at(base, share.value, shape.n, shape.m.value, shape.r.value)
      at(base + 1, shape.round.value, shape.twist.value * RAD, below ? rows.get(below[0])! : -1, shapeIndex(shape))
      at(base + 2, shape.form?.value ?? 0, shape.corner?.value ?? 0, shape.onion?.value ?? 0, join?.weight.value ?? 0)
      if (!join) return
      const s = join.shape
      at(base + 3, shapeIndex(s), s.n, s.m.value, s.r.value)
      at(base + 4, s.round.value, s.twist.value * RAD, s.form?.value ?? 0, s.corner?.value ?? 0)
      at(base + 5, join.offset[0].value, join.offset[1].value, join.blend.value, 0)
    })
  })
  return data
}

export type Renderer = {
  gl: WebGL2RenderingContext
  draw: (scene: Scene, live: Pick<Live, 'drift' | 'colour' | 'crawl'>, toward?: Toward, size?: [number, number]) => void
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true })
  if (!gl) throw new Error('WebGL2 is not available')
  const compile = (type: number, source: string) => {
    const s = gl.createShader(type)!
    gl.shaderSource(s, source)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader failed')
    return s
  }
  const program = gl.createProgram()
  gl.attachShader(
    program,
    compile(
      gl.VERTEX_SHADER,
      '#version 300 es\nvoid main() { gl_Position = vec4(vec2(gl_VertexID & 1, gl_VertexID >> 1) * 4. - 1., 0, 1); }',
    ),
  )
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, generateShader()))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link failed')
  gl.useProgram(program)
  const u = (name: string) => gl.getUniformLocation(program, name)
  const loc = {
    res: u('uRes'),
    frame: u('uFrame'),
    levels: u('uLevels'),
    depth: u('uDepth'),
    contour: u('uContour'),
    radial: u('uRadial'),
    line: u('uLine'),
    falloff: u('uFalloff'),
    dots: u('uDots'),
    crawl: u('uCrawl'),
    stopCount: u('uStopCount'),
    stops: u('uStops'),
    stopMix: u('uStopMix'),
    palette: u('uPalette'),
    trap: u('uTrap'),
    composite: u('uComposite'),
    bg: u('uBg'),
    bgSoak: u('uBgSoak'),
    aa: u('uAA'),
    gamma: u('uGamma'),
    toward: u('uToward'),
    towardRings: u('uTowardRings'),
    towardMix: u('uTowardMix'),
    cross: u('uCross'),
  }
  const texture = gl.createTexture()
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, ROW_TEXELS, MAX_LEVELS, 0, gl.RGBA, gl.FLOAT, null)
  gl.uniform1i(loc.levels, 0)
  gl.bindVertexArray(gl.createVertexArray())

  const draw: Renderer['draw'] = (scene, live, toward, [width, height] = [canvas.width, canvas.height]) => {
    const { frame, contour, line, palette, post } = scene
    // a scene drawn alone is its own far end
    const far = toward ?? {
      line: line.kind,
      rings: [contour.rings.value, contour.rings.spread ?? 0],
      units: line.units,
      composite: scene.composite,
      mixes: palette.stops.map((s) => s.mix),
      levels: [],
      drift: live.drift,
      colour: live.colour,
      crawl: live.crawl,
      at: 0,
    }
    const mixed = (a: boolean, b: boolean) => Number(a) * (1 - far.at) + Number(b) * far.at
    gl.viewport(0, 0, width, height)
    gl.uniform2f(loc.res, width, height)
    gl.uniform4f(loc.frame, frame.origin[0].value, frame.origin[1].value, frame.zoom.value, frame.turn.value * RAD)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    const rows = packLevels(scene.levels, far.levels)
    // a lone level's swap: the level with its other switches in the rows after the scene's, a chain of its own
    const start = allLevels(scene.levels).length
    if (far.cross) packLevels(far.cross.levels, far.levels, start, rows)
    gl.uniform2f(loc.cross, start, far.cross?.at ?? 0)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ROW_TEXELS, MAX_LEVELS, gl.RGBA, gl.FLOAT, rows)
    gl.uniform1f(loc.depth, Math.max(heaviest(scene.levels), 1e-6))
    gl.uniform4f(loc.contour, contour.rings.value, contour.rings.spread ?? 0, live.drift, 0)
    gl.uniform2f(loc.radial, contour.radialWeight.value, contour.radialWeight.spread ?? 0)
    gl.uniform4f(
      loc.line,
      LINES.indexOf(line.kind),
      line.width.value,
      line.width.spread ?? 0,
      mixed(line.units === 'screen', far.units === 'screen'),
    )
    gl.uniform2f(loc.falloff, line.falloff.value, line.falloff.spread ?? 0)
    const { dots } = line
    gl.uniform4f(
      loc.dots,
      dots?.count.value ?? 1,
      dots?.count.spread ?? 0,
      dots?.size.value ?? 0,
      dots?.size.spread ?? 0,
    )
    gl.uniform2f(loc.crawl, live.crawl, far.crawl)
    gl.uniform1i(loc.stopCount, palette.stops.length)
    gl.uniform4fv(
      loc.stops,
      palette.stops.flatMap((s) => [s.at, s.lch[0].value, s.lch[1].value, s.lch[2].value * RAD]),
    )
    gl.uniform1iv(
      loc.stopMix,
      palette.stops.map((s) => MIXES.indexOf(s.mix)),
    )
    gl.uniform1iv(
      loc.towardMix,
      far.mixes.map((m) => MIXES.indexOf(m)),
    )
    gl.uniform4f(loc.palette, palette.hue.value * RAD, palette.contrast.value, palette.radius.value, live.colour)
    gl.uniform2f(loc.trap, palette.trap?.weight.value ?? 0, palette.trap?.size.value ?? 0)
    gl.uniform1f(loc.composite, mixed(scene.composite === 'first', far.composite === 'first'))
    gl.uniform4f(loc.toward, LINES.indexOf(far.line), far.at, far.drift, far.colour)
    gl.uniform2f(loc.towardRings, ...far.rings)
    const bg = scene.background
    gl.uniform4f(
      loc.bg,
      bg ? BACKGROUNDS.indexOf(bg.kind) + 1 : 0,
      bg?.amount.value ?? 0,
      (bg?.turn.value ?? 0) * RAD,
      bg?.scale.value ?? 1,
    )
    gl.uniform4f(loc.bgSoak, bg?.at[0].value ?? 0, bg?.at[1].value ?? 0, bg?.edge.value ?? 0, bg?.seep.value ?? 0)
    gl.uniform1i(loc.aa, post.aa)
    gl.uniform1f(loc.gamma, post.gamma.value)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
  return { gl, draw }
}
