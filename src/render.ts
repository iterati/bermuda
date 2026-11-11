// The renderer: compiles the one shader once, then each frame packs a live scene into its uniforms
// and level rows and draws one full-screen triangle into whatever framebuffer is bound.
import { allLevels, depthOf, LINES, MAX_LEVELS, MIXES, VARIATIONS, type Level, type Scene } from './scene'
import { generateShader, ROW_TEXELS } from './shader'
import type { Live } from './motion'

const RAD = Math.PI / 180

// The level rows as shader.ts lays them out: every level, sub-chains included, gets a row; a level's next
// row is the one after it in its own list, and a variant's sub-chain replaces the rest of the chain below it.
export function packLevels(levels: Level[]): Float32Array {
  const data = new Float32Array(MAX_LEVELS * ROW_TEXELS * 4)
  const rows = new Map(allLevels(levels).map(({ level }, i) => [level, i]))
  for (const { level, list } of allLevels(levels)) {
    const at = (texel: number, ...values: number[]) => data.set(values, (rows.get(level)! * ROW_TEXELS + texel) * 4)
    const next = list[list.indexOf(level) + 1]
    const { affine, lattice, cell, colour, variants } = level
    at(0, level.weight.value, affine.scale.value, affine.turn.value * RAD, next ? rows.get(next)! : -1)
    at(1, affine.offset[0].value, affine.offset[1].value, lattice.e2[0].value, lattice.e2[1].value)
    at(
      2,
      ...VARIATIONS.map((kind) =>
        level.variations.filter((v) => v.kind === kind).reduce((sum, v) => sum + v.weight.value, 0),
      ),
    )
    at(4, cell.by === 'parity' ? 1 : 0, cell.turn.value * RAD, cell.phase.value * 2 * Math.PI, variants.length)
    at(
      5,
      colour.at.value,
      colour.speed.value,
      colour.cellSpread.value,
      variants.reduce((s, v) => s + v.share.value, 0),
    )
    variants.forEach(({ share, shape, below }, v) => {
      at(6 + 2 * v, share.value, shape.n, shape.m.value, shape.r.value)
      at(7 + 2 * v, shape.round.value, shape.twist.value * RAD, below ? rows.get(below[0])! : -1, 0)
    })
  }
  return data
}

export type Renderer = {
  gl: WebGL2RenderingContext
  draw: (scene: Scene, live: Pick<Live, 'drift' | 'colour'>) => void
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
    stopCount: u('uStopCount'),
    stops: u('uStops'),
    stopMix: u('uStopMix'),
    palette: u('uPalette'),
    composite: u('uComposite'),
    aa: u('uAA'),
    gamma: u('uGamma'),
  }
  const texture = gl.createTexture()
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, ROW_TEXELS, MAX_LEVELS, 0, gl.RGBA, gl.FLOAT, null)
  gl.uniform1i(loc.levels, 0)
  gl.bindVertexArray(gl.createVertexArray())

  const draw: Renderer['draw'] = (scene, live) => {
    const { frame, contour, line, palette, post } = scene
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.uniform2f(loc.res, canvas.width, canvas.height)
    gl.uniform4f(loc.frame, frame.origin[0].value, frame.origin[1].value, frame.zoom.value, frame.turn.value * RAD)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ROW_TEXELS, MAX_LEVELS, gl.RGBA, gl.FLOAT, packLevels(scene.levels))
    gl.uniform1f(loc.depth, depthOf(scene.levels))
    gl.uniform4f(loc.contour, contour.rings.value, contour.rings.spread ?? 0, live.drift, 0)
    gl.uniform2f(loc.radial, contour.radialWeight.value, contour.radialWeight.spread ?? 0)
    gl.uniform4f(
      loc.line,
      LINES.indexOf(line.kind),
      line.width.value,
      line.width.spread ?? 0,
      line.units === 'screen' ? 1 : 0,
    )
    gl.uniform2f(loc.falloff, line.falloff.value, line.falloff.spread ?? 0)
    gl.uniform1i(loc.stopCount, palette.stops.length)
    gl.uniform4fv(
      loc.stops,
      palette.stops.flatMap((s) => [s.at, s.lch[0].value, s.lch[1].value, s.lch[2].value * RAD]),
    )
    gl.uniform1iv(
      loc.stopMix,
      palette.stops.map((s) => MIXES.indexOf(s.mix)),
    )
    gl.uniform4f(loc.palette, palette.hue.value * RAD, palette.contrast.value, palette.radius.value, live.colour)
    gl.uniform1i(loc.composite, scene.composite === 'add' ? 0 : 1)
    gl.uniform1i(loc.aa, post.aa)
    gl.uniform1f(loc.gamma, post.gamma.value)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
  return { gl, draw }
}
