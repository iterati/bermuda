// The renderer: a cache of the shader's programs, each keyed by its sorted parts, compiled on first use or warmed
// between frames (a few at a time where the browser compiles in parallel), and ready once it has drawn once into a
// 1x1 target. A draw is given the parts its scene needs and draws on their program once it is ready; until then on
// main's everything program, the one of its three (every part but fills and metal, every part but metal, and every
// part) the live scene's fills need, where that is ready, else on the parts' program compiled then. It packs the
// scene into the program's uniforms (setting one the program leaves out does nothing) and level rows, and draws one
// full-screen triangle into whatever framebuffer is bound, over the whole canvas or a smaller picture in its
// bottom-left corner.
import {
  allLevels,
  BACKGROUNDS,
  CELLS,
  FIELDS,
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
import { ENGINES, LAYOUT, ROW_TEXELS } from './engines'
import { RAD, VARIANT_TEXELS } from './engines/engine'
import { generateShader, PARTS, type Part } from './shader'
import type { Live } from './motion'

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

// The level rows as shader.ts and its engines lay them out: every level, sub-chains included, gets a row; a level's next
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
    // each engine's own texels, from its first
    for (const engine of ENGINES) engine.pack?.(level, (texel, ...values) => at(LAYOUT[engine.name] + texel, ...values))
  })
  return data
}

// main's everything program, the fallback: plain, fills, and fills with metal, as the frame's fills need
export const EVERYTHING: readonly (readonly Part[])[] = [
  PARTS.filter((p) => p !== 'fill' && p !== 'metal'),
  PARTS.filter((p) => p !== 'metal'),
  PARTS,
]
// at most this many programs compile at once where the browser compiles in parallel
const IN_FLIGHT = 3

// What a draw drew on: its program's key (its sorted parts), whether that was the everything program standing in for
// the parts given, and the program's compile time in milliseconds, from its compile's start to its warm-up draw's end.
export type Drew = { parts: readonly Part[]; fallback: boolean; ms: number }

export type Renderer = {
  gl: WebGL2RenderingContext
  parallel: boolean // whether the context compiles in parallel (KHR_parallel_shader_compile)
  draw: (
    scene: Scene,
    live: Pick<Live, 'drift' | 'colour' | 'crawl'>,
    toward?: Toward,
    size?: [number, number],
    parts?: Iterable<Part>,
  ) => Drew
  warm: (sets: Iterable<Part>[]) => void
  step: () => boolean
}

// a program's uniforms, each null where the program leaves it out
const locate = (gl: WebGL2RenderingContext, program: WebGLProgram) => {
  const u = (name: string) => gl.getUniformLocation(program, name)
  return {
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
    field: u('uField'),
    fieldC: u('uFieldC'),
    cross: u('uCross'),
  }
}

// a program of the cache: compiling until it has its uniforms, and ready once it has its compile time too
type Program = {
  parts: Part[]
  program: WebGLProgram
  shaders: WebGLShader[]
  start: number
  loc?: ReturnType<typeof locate>
  ms?: number
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true })
  if (!gl) throw new Error('WebGL2 is not available')
  const khr = gl.getExtension('KHR_parallel_shader_compile')
  // the level rows, which every program reads
  const texture = gl.createTexture()
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, ROW_TEXELS, MAX_LEVELS, 0, gl.RGBA, gl.FLOAT, null)
  gl.bindVertexArray(gl.createVertexArray())
  // a shader's compile and a program's link are started without reading their status, which would wait for them
  const compile = (type: number, source: string) => {
    const s = gl.createShader(type)!
    gl.shaderSource(s, source)
    gl.compileShader(s)
    return s
  }
  let vertex: WebGLShader | undefined
  // the programs by key, their sorted parts, each compiled on first use or warmed, and ready once it has drawn its
  // warm-up
  const programs = new Map<string, Program>()
  const sortedOf = (parts: Iterable<Part>) => [...new Set(parts)].sort()
  const done = (parts: Part[]) => programs.get(parts.join(' '))?.ms !== undefined
  const begin = (parts: Part[]) => {
    const start = performance.now()
    vertex ??= compile(
      gl.VERTEX_SHADER,
      '#version 300 es\nvoid main() { gl_Position = vec4(vec2(gl_VertexID & 1, gl_VertexID >> 1) * 4. - 1., 0, 1); }',
    )
    const program = gl.createProgram()
    const shaders = [vertex, compile(gl.FRAGMENT_SHADER, generateShader(parts))]
    for (const s of shaders) gl.attachShader(program, s)
    gl.linkProgram(program)
    const entry: Program = { parts, program, shaders, start }
    programs.set(parts.join(' '), entry)
    return entry
  }
  // the 1x1 targets of the warm-up draws: a driver may build a program's code for each target it draws into, so a
  // warm-up draws into one shaped as the framebuffer bound is, the canvas's (bytes, and the 24-bit depth and 8-bit
  // stencil Chrome gives a canvas with depth) or one of floats
  const targets = new Map<boolean, WebGLFramebuffer>()
  // A program's statuses checked, its uniforms found, and its warm-up draw into a 1x1 target read back, so a driver
  // that does its real work at the first draw has done it.
  const finish = (entry: Program) => {
    const { program, shaders } = entry
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      for (const s of shaders)
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader failed')
      throw new Error(gl.getProgramInfoLog(program) ?? 'link failed')
    }
    const loc = locate(gl, program)
    gl.useProgram(program)
    gl.uniform1i(loc.levels, 0)
    const bound: WebGLFramebuffer | null = gl.getParameter(gl.FRAMEBUFFER_BINDING)
    const viewport: Int32Array = gl.getParameter(gl.VIEWPORT)
    const float =
      !!bound &&
      gl.getFramebufferAttachmentParameter(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE,
      ) === gl.FLOAT
    const [format, type] = float ? [gl.RGBA32F, gl.FLOAT] : [gl.RGBA8, gl.UNSIGNED_BYTE]
    let target = targets.get(float)
    if (!target) {
      target = gl.createFramebuffer()
      targets.set(float, target)
      const t = gl.createTexture()
      gl.bindFramebuffer(gl.FRAMEBUFFER, target)
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texImage2D(gl.TEXTURE_2D, 0, format, 1, 1, 0, gl.RGBA, type, null)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0)
      const { depth, stencil } = gl.getContextAttributes()!
      if (!float && (depth || stencil)) {
        const rb = gl.createRenderbuffer()
        gl.bindRenderbuffer(gl.RENDERBUFFER, rb)
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, 1, 1)
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, rb)
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, target)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.viewport(0, 0, 1, 1)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.readPixels(0, 0, 1, 1, gl.RGBA, type, float ? new Float32Array(4) : new Uint8Array(4))
    gl.bindFramebuffer(gl.FRAMEBUFFER, bound)
    gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3])
    entry.loc = loc
    entry.ms = performance.now() - entry.start
  }
  // the program of these sorted parts, compiled and warmed now if it is not ready
  const ready = (parts: Part[]) => {
    const entry = programs.get(parts.join(' ')) ?? begin(parts)
    if (entry.ms === undefined) finish(entry)
    return entry
  }
  // what to compile next, each its sorted parts: the programs a draw found not ready, then the warm-up's list
  const wanted: Part[][] = []
  let queue: Part[][] = []
  const warm: Renderer['warm'] = (sets) => {
    queue = [...new Map(sets.map(sortedOf).map((parts) => [parts.join(' '), parts])).values()]
  }
  // One slice of the work, between frames: where the context compiles in parallel, the programs whose compile has
  // completed finished and the next ones started, a few at a time; else the next one compiled and warmed. Whether
  // work is left.
  const step: Renderer['step'] = () => {
    const flying = () => [...programs.values()].filter((p) => p.ms === undefined)
    if (khr) for (const p of flying()) if (gl.getProgramParameter(p.program, khr.COMPLETION_STATUS_KHR)) finish(p)
    for (const list of [wanted, queue]) while (list.length && done(list[0])) list.shift()
    if (!khr) {
      const next = wanted.shift() ?? queue.shift()
      if (next) ready(next)
    } else {
      const next = () => [...wanted, ...queue].find((parts) => !programs.has(parts.join(' ')))
      for (let parts = next(); parts && flying().length < IN_FLIGHT; parts = next()) begin(parts)
    }
    return flying().length > 0 || [...wanted, ...queue].some((parts) => !done(parts))
  }
  const everything = EVERYTHING.map(sortedOf)

  const draw: Renderer['draw'] = (scene, live, toward, [width, height] = [canvas.width, canvas.height], parts) => {
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
    // the everything program the fills need: metal where a level paints metal, fills where one paints at all, else
    // plain (a morph's scene holds both ends' fills)
    const fills = allLevels(scene.levels).flatMap(({ level }) =>
      level.fill && level.fill.amount.value > 0 ? [level.fill] : [],
    )
    const all = everything[fills.some((f) => f.metal.value > 0) ? 2 : fills.length ? 1 : 0]
    // the parts' own program once ready; until then the everything program where it is ready, the parts' program
    // compiled between frames, else the parts' program compiled now
    const own = parts && sortedOf(parts)
    const stand = !!own && !done(own) && done(all)
    if (stand && !wanted.some((w) => w.join(' ') === own.join(' '))) wanted.push(own)
    const entry = ready(stand || !own ? all : own)
    const { program } = entry
    const loc = entry.loc!
    gl.useProgram(program)
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
    // no field: radial round the plane's centre at depth 0, which the radius reads as before and shifts nothing
    const fl = palette.field
    gl.uniform4f(
      loc.field,
      fl ? FIELDS.indexOf(fl.kind) : 0,
      (fl?.angle.value ?? 0) * RAD,
      fl?.scale.value ?? 0,
      fl?.depth.value ?? 0,
    )
    gl.uniform4f(loc.fieldC, fl?.centre[0].value ?? 0, fl?.centre[1].value ?? 0, fl?.steps ?? 0, fl?.atCells ? 1 : 0)
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
    return { parts: entry.parts, fallback: stand, ms: entry.ms! }
  }
  return { gl, parallel: !!khr, draw, warm, step }
}
