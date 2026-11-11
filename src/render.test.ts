// The one shader compiles in WebGL2 (headless Chrome), every look and preset renders finite and not blank, a morph
// between two presets is finite and not blank at its middle and lands on each end exactly, and a collapsed level
// draws as if it were gone, a swap draws what it swapped, and a loop's first and last frames draw the same.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { build, type Rollup } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findLevel, removeLevel, setLattice } from './edit'
import { snapLoop } from './loop'
import { level, LOOKS, scene, star } from './looks'
import { morph } from './morph'
import { advance, applyPreset, newLive, update } from './motion'
import type { Toward } from './render'
import { CELLS, LATTICES, type Edge, type Scene } from './scene'

declare global {
  interface Window {
    Bermuda: typeof import('./render')
    renderer?: import('./render').Renderer
  }
}

let browser: Browser
let page: Page

beforeAll(async () => {
  const out = (await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: { entry: fileURLToPath(new URL('./render.ts', import.meta.url)), formats: ['iife'], name: 'Bermuda' },
    },
  })) as Rollup.RollupOutput[]
  const code = out[0].output[0].code
  const chrome = execFileSync('sh', ['-c', 'command -v chromium'], { encoding: 'utf8' }).trim()
  browser = await puppeteer.launch({
    executablePath: chrome,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  page = await browser.newPage()
  await page.setContent('<canvas width="160" height="90"></canvas>')
  await page.addScriptTag({ content: code })
}, 60_000)

afterAll(() => browser?.close())

// Draw a live scene into a float framebuffer and read back its pixels.
const pixels = (live: Scene, drift: number, colour: number, toward?: Toward) =>
  page.evaluate(
    (live, drift, colour, toward) => {
      const canvas = document.querySelector('canvas')!
      const renderer = (window.renderer ??= window.Bermuda.createRenderer(canvas))
      const { gl } = renderer
      if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('no float framebuffers')
      const target = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, target)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, canvas.width, canvas.height, 0, gl.RGBA, gl.FLOAT, null)
      const fb = gl.createFramebuffer()
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0)
      gl.activeTexture(gl.TEXTURE0)
      renderer.draw(live, { drift, colour }, toward)
      const px = new Float32Array(canvas.width * canvas.height * 4)
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.FLOAT, px)
      return Array.from(px)
    },
    live,
    drift,
    colour,
    toward,
  )

// the pixels' stats: all finite, their mean lightness and its spread
async function shoot(live: Scene, drift: number, colour: number, toward?: Toward) {
  const px = await pixels(live, drift, colour, toward)
  let finite = true
  let sum = 0
  let sq = 0
  const n = px.length / 4
  for (let i = 0; i < px.length; i += 4) {
    const l = (px[i] + px[i + 1] + px[i + 2]) / 3
    if (!Number.isFinite(px[i] + px[i + 1] + px[i + 2])) finite = false
    sum += l
    sq += l * l
  }
  const mean = sum / n
  return { finite, mean, spread: Math.sqrt(Math.max(0, sq / n - mean * mean)) }
}

const furthest = (x: number[], y: number[]) => x.reduce((most, v, i) => Math.max(most, Math.abs(v - y[i])), 0)
const look = (name: string) => LOOKS.find((l) => l.name.startsWith(name))!
const preset = (name: string, p: string) =>
  applyPreset(
    look(name),
    look(name).presets.find((x) => x.name === p)!,
  )

// both scenes on their own clocks t seconds in, and the morph between them at fader x
function morphAt(a: Scene, b: Scene, x: number, edge: Edge, t: number) {
  const [la, lb] = [newLive(), newLive()]
  const [sa, sb] = [advance(a, la, t, 60), advance(b, lb, t, 60)]
  return { sa, sb, la, lb, ...morph(sa, sb, x, edge, lb) }
}

describe('the one shader', () => {
  it('compiles and links', async () => {
    const ok = await page.evaluate(
      () => !!(window.renderer ??= window.Bermuda.createRenderer(document.querySelector('canvas')!)),
    )
    expect(ok).toBe(true)
  })

  const cases = LOOKS.flatMap((look) => [
    { name: look.name, scene: look },
    ...look.presets.map((p) => ({ name: `${look.name} / ${p.name}`, scene: applyPreset(look, p) })),
  ])
  it.each(cases)('renders $name finite and not blank', async ({ scene }) => {
    for (const t of [0, 7.3, 41]) {
      const live = newLive()
      const frame = advance(scene, live, t, 60)
      const { finite, mean, spread } = await shoot(frame, live.drift, live.colour)
      expect(finite, `at ${t} s`).toBe(true)
      expect(mean, `mean at ${t} s`).toBeGreaterThan(0.01)
      expect(spread, `spread at ${t} s`).toBeGreaterThan(0.01)
    }
  })

  // two levels of each lattice kind under each cell step, the first re-tiling the plane and the second its cells
  const kinds = LATTICES.flatMap((kind) =>
    CELLS.map((by) => {
      const base = scene({
        name: `${kind} by ${by}`,
        levels: ['a', 'b'].map((id, i) =>
          level(id, { scale: i ? 1.7 : 1, turn: 20, by, cellTurn: 25, shape: star(6, 2.5, 0.4), at: i / 2 }),
        ),
        rings: 2,
      })
      return { kind, by, scene: update(base, (d) => ['a', 'b'].forEach((id) => setLattice(d, id, kind))) }
    }),
  )
  it.each(kinds)('renders a $kind lattice by $by finite and not blank', async ({ scene }) => {
    for (const t of [0, 7.3]) {
      const live = newLive()
      const { finite, mean, spread } = await shoot(advance(scene, live, t, 60), live.drift, live.colour)
      expect(finite, `at ${t} s`).toBe(true)
      expect(mean, `mean at ${t} s`).toBeGreaterThan(0.01)
      expect(spread, `spread at ${t} s`).toBeGreaterThan(0.01)
    }
  })

  it('draws voronoi at jitter 0 as the oblique pad, so the two swap without a jump', async () => {
    const oblique = kinds.find((k) => k.kind === 'oblique' && k.by === 'parity')!.scene
    const voronoi = update(oblique, (d) => ['a', 'b'].forEach((id) => setLattice(d, id, 'voronoi')))
    expect(furthest(await pixels(voronoi, 0, 0), await pixels(oblique, 0, 0))).toBeLessThan(1e-4)
  })

  it("zooms log-polar by one of its pad's vectors back onto the same picture, so the zoom loops", async () => {
    const at = (scale: number) =>
      scene({
        name: 'zoom',
        levels: [
          level('z', { scale, lattice: 'logpolar', sectors: 9, e2: [0.5, Math.sqrt(3) / 2], shape: star(6, 2, 0.45) }),
        ],
        rings: 2,
      })
    // e^(√3 · 2π / 9): the shift (0, √3) along log r, the pad's vector (-1, 2)
    const [a, b] = [await pixels(at(1), 0, 0), await pixels(at(Math.exp((Math.sqrt(3) * 2 * Math.PI) / 9)), 0, 0)]
    expect(furthest(a, b)).toBeLessThan(1e-3)
  })
})

describe('the morph', () => {
  const staggered: Edge = { seconds: 2, stagger: 0.4, deepFirst: false }
  const pairs: [string, Scene, Scene][] = [
    ['Square into Hex', preset('Remix - Square to hex', 'Square'), preset('Remix - Square to hex', 'Hex')],
    ['Ice into Dusk', preset('Tapestry 7 ', 'Ice'), preset('Tapestry 7 ', 'Dusk')],
    ['Tapestry 3 into its preset', look('Tapestry 3'), preset('Tapestry 3', 'Green stars on red circles')],
    ['Tapestry 1 into Tapestry 7', look('Tapestry 1'), look('Tapestry 7 ')],
    ...LOOKS.map((a, i): [string, Scene, Scene] => {
      const b = LOOKS[(i + 1) % LOOKS.length]
      return [`${a.name} into ${b.name}`, a, b]
    }),
  ]

  it.each(pairs)('%s is finite and not blank at its middle', async (_, a, b) => {
    for (const edge of [staggered, { ...staggered, stagger: 1, deepFirst: true }]) {
      const { scene, toward, la } = morphAt(a, b, 0.5, edge, 7.3)
      const { finite, mean, spread } = await shoot(scene, la.drift, la.colour, toward)
      expect(finite).toBe(true)
      expect(mean).toBeGreaterThan(0.01)
      expect(spread).toBeGreaterThan(0.01)
    }
  })

  const reordered = update(look('Remix - Square into hex'), (d) => d.levels.push(d.levels.shift()!))
  const ends: [string, Scene, Scene][] = [
    ...pairs.slice(0, 4),
    ['Branching cells into Tapestry 8', look('Remix - Branching cells'), look('Tapestry 8')],
    ['Tapestry 8 into Branching cells', look('Tapestry 8'), look('Remix - Branching cells')],
    ['Square into hex into its reorder', look('Remix - Square into hex'), reordered],
    ['Tapestry 2 into Tapestry 7b', look('Tapestry 2'), look('Tapestry 7b')],
  ]
  it.each(ends)('%s lands on A and B exactly at its ends', async (_, a, b) => {
    for (const [x, end] of [
      [0, 'a'],
      [1, 'b'],
    ] as const) {
      const m = morphAt(a, b, x, staggered, 7.3)
      const [scene, live] = end === 'a' ? [m.sa, m.la] : [m.sb, m.lb]
      const want = await pixels(scene, live.drift, live.colour)
      expect(furthest(await pixels(m.scene, m.la.drift, m.la.colour, m.toward), want), `at ${x}`).toBeLessThan(1e-4)
    }
  })

  it.each(pairs.slice(0, 4))('%s swapped, B into A at 1 - x deep first, draws the same', async (_, a, b) => {
    const edge: Edge = { seconds: 2, stagger: 1, deepFirst: false }
    const there = morphAt(a, b, 0.4, edge, 7.3)
    const back = morph(there.sb, there.sa, 0.6, { ...edge, deepFirst: true }, there.la)
    const want = await pixels(there.scene, there.la.drift, there.la.colour, there.toward)
    expect(furthest(await pixels(back.scene, there.lb.drift, there.lb.colour, back.toward), want)).toBeLessThan(1e-3)
  })

  it.each([
    ['Remix - Square into hex', 'hexA'],
    ['Remix - Pinwheel crosses', 'wheel'],
    ['Remix - Branching cells', 'sqA'],
  ])('%s: a level at weight 0 draws as if it were gone (%s)', async (name, id) => {
    const at = (s: Scene) => {
      const live = newLive()
      return { scene: advance(s, live, 7.3, 60), live }
    }
    const collapsed = at(update(look(name), (d) => (findLevel(d, id).level.weight.value = 0)))
    const gone = at(update(look(name), (d) => removeLevel(d, id)))
    const x = await pixels(collapsed.scene, collapsed.live.drift, collapsed.live.colour)
    expect(furthest(x, await pixels(gone.scene, gone.live.drift, gone.live.colour))).toBeLessThan(1e-4)
  })
})

describe('a loop', () => {
  it.each(['Tapestry 1', 'Tapestry 6'])('%s draws its frame a loop on as its first', async (name) => {
    const s = snapLoop({ ...look(name), loop: { seconds: 10 } }, 97)
    const live = newLive()
    const first = advance(s, live, 0.1, 97)
    const want = await pixels(first, live.drift, live.colour)
    for (let i = 1; i < 100; i++) advance(s, live, 0.1, 97)
    const last = advance(s, live, 0.1, 97)
    expect(furthest(await pixels(last, live.drift, live.colour), want)).toBeLessThan(1e-4)
  })
})
