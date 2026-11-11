// The one shader compiles in WebGL2 (headless Chrome), every look and preset renders finite and not blank, a morph
// between two presets is finite and not blank at its middle and lands on each end exactly, and a collapsed level
// draws as if it were gone, a swap draws what it swapped, a loop's first and last frames draw the same, and the
// frames of Play's transitions along an autopilot walk are finite and not blank. Every shape draws alone and
// joined, screen lines hold their width through a warp, spill draws only what reaches over, and dots fade from one
// count to the next and crawl. The Decks' three pictures, each drawn at its own size in the canvas's corner, are
// finite and not blank. A background of each kind draws under the lines, and at amount 0 draws as none. Every
// variation warps finite and not blank, ring and mirror draw as none where they have nothing to do, and the orbit
// trap draws as none at weight 0.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { build, type Rollup } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findLevel, removeLevel, setLattice } from './edit'
import { snapLoop } from './loop'
import { background, BANK, join, level, LOOKS, scene, shape, star } from './looks'
import { morph, smooth } from './morph'
import { advance, applyPreset, newLive, update, type Live } from './motion'
import { bend, bendOf, entryScene, step, tangent, valuesOf, type Keyframe } from './play'
import type { Toward } from './render'
import {
  BACKGROUNDS,
  CELLS,
  LATTICES,
  SHAPES,
  SPILLS,
  VARIATIONS,
  type Edge,
  type Scene,
  type ShapeKind,
  type VariationKind,
} from './scene'

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

type Phases = Pick<Live, 'drift' | 'colour' | 'crawl'>

// Draw a live scene into a float framebuffer, over the whole canvas or at a size in its corner, and read back the
// whole canvas's pixels.
const pixels = (live: Scene, { drift, colour, crawl }: Phases, toward?: Toward, size?: [number, number]) =>
  page.evaluate(
    (live, phases, toward, size) => {
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
      renderer.draw(live, phases, toward, size)
      const px = new Float32Array(canvas.width * canvas.height * 4)
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.FLOAT, px)
      return Array.from(px)
    },
    live,
    { drift, colour, crawl },
    toward,
    size,
  )

// the pixels' stats: all finite, their mean lightness and its spread
const shoot = async (live: Scene, phases: Phases, toward?: Toward) => stats(await pixels(live, phases, toward))
function stats(px: number[]) {
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

// the first draw compiles the shader's software code, slow while another browser test runs beside it
describe('the one shader', { timeout: 30_000 }, () => {
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
      const { finite, mean, spread } = await shoot(frame, live)
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
      const { finite, mean, spread } = await shoot(advance(scene, live, t, 60), live)
      expect(finite, `at ${t} s`).toBe(true)
      expect(mean, `mean at ${t} s`).toBeGreaterThan(0.01)
      expect(spread, `spread at ${t} s`).toBeGreaterThan(0.01)
    }
  })

  it('draws voronoi at jitter 0 as the oblique pad, so the two swap without a jump', async () => {
    const oblique = kinds.find((k) => k.kind === 'oblique' && k.by === 'parity')!.scene
    const voronoi = update(oblique, (d) => ['a', 'b'].forEach((id) => setLattice(d, id, 'voronoi')))
    expect(furthest(await pixels(voronoi, newLive()), await pixels(oblique, newLive()))).toBeLessThan(1e-4)
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
    const [a, b] = [
      await pixels(at(1), newLive()),
      await pixels(at(Math.exp((Math.sqrt(3) * 2 * Math.PI) / 9)), newLive()),
    ]
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
      const { finite, mean, spread } = await shoot(scene, la, toward)
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
    ['Marching ants into Metaballs', look('Shapes - Marching ants'), look('Shapes - Metaballs')],
    ["iq's garden into Stairs and S", look("Shapes - iq's garden"), look('Shapes - Stairs')],
    ['Onion skins into Through the sphere', look('Shapes - Onion skins'), look('Shapes - Through the sphere')],
    [
      'Tapestry 1 over a soak into Tapestry 7 with none',
      { ...look('Tapestry 1'), background: background('soak') },
      look('Tapestry 7 '),
    ],
    ['Mirror tiles into Ripples', look('Cells - Mirror tiles'), look('Cells - Ripples')],
    ['Orbit traps into Tapestry 7', look('Colour - Orbit traps'), look('Tapestry 7 ')],
    ['Hearts and discs into Julia set', look('flam3 - Hearts and discs'), look('flam3 - Julia set')],
  ]
  it.each(ends)('%s lands on A and B exactly at its ends', async (_, a, b) => {
    for (const [x, end] of [
      [0, 'a'],
      [1, 'b'],
    ] as const) {
      const m = morphAt(a, b, x, staggered, 7.3)
      const [scene, live] = end === 'a' ? [m.sa, m.la] : [m.sb, m.lb]
      const want = await pixels(scene, live)
      expect(furthest(await pixels(m.scene, m.la, m.toward), want), `at ${x}`).toBeLessThan(1e-4)
    }
  })

  it.each(pairs.slice(0, 4))('%s swapped, B into A at 1 - x deep first, draws the same', async (_, a, b) => {
    const edge: Edge = { seconds: 2, stagger: 1, deepFirst: false }
    const there = morphAt(a, b, 0.4, edge, 7.3)
    const back = morph(there.sb, there.sa, 0.6, { ...edge, deepFirst: true }, there.la)
    const want = await pixels(there.scene, there.la, there.toward)
    expect(furthest(await pixels(back.scene, there.lb, back.toward), want)).toBeLessThan(1e-3)
  })

  it.each([
    ['Remix - Square into hex', 'hexA'],
    ['Remix - Pinwheel crosses', 'wheel'],
    ['Remix - Branching cells', 'sqA'],
    ['Cells - Mirror tiles', 'tile'],
    ['Cells - Ripples', 'pond'],
    ['Remix - Kaleidoscope pond', 'glass'],
  ])('%s: a level at weight 0 draws as if it were gone (%s)', async (name, id) => {
    const at = (s: Scene) => {
      const live = newLive()
      return { scene: advance(s, live, 7.3, 60), live }
    }
    const collapsed = at(update(look(name), (d) => (findLevel(d, id).level.weight.value = 0)))
    const gone = at(update(look(name), (d) => removeLevel(d, id)))
    const x = await pixels(collapsed.scene, collapsed.live)
    expect(furthest(x, await pixels(gone.scene, gone.live))).toBeLessThan(1e-4)
  })
})

describe('a background', () => {
  const drawn = async (s: Scene) => {
    const live = newLive()
    return pixels(advance(s, live, 7.3, 60), live)
  }

  it.each(BACKGROUNDS)('draws Tapestry 1 over a %s finite, not blank and not as without it', async (kind) => {
    const px = await drawn({ ...look('Tapestry 1'), background: background(kind) })
    const { finite, mean, spread } = stats(px)
    expect(finite).toBe(true)
    expect(mean).toBeGreaterThan(0.01)
    expect(spread).toBeGreaterThan(0.01)
    expect(furthest(px, await drawn(look('Tapestry 1')))).toBeGreaterThan(0.05)
  })

  it.each(BACKGROUNDS)('at amount 0 draws a %s as if there were none', async (kind) => {
    const px = await drawn({ ...look('Tapestry 1'), background: background(kind, 0) })
    expect(furthest(px, await drawn(look('Tapestry 1')))).toBeLessThan(1e-4)
  })

  it('draws Tapestry 7b, composite first, over a flat background finite and not blank', async () => {
    const { finite, mean, spread } = stats(await drawn({ ...look('Tapestry 7b'), background: background('flat') }))
    expect(finite).toBe(true)
    expect(mean).toBeGreaterThan(0.01)
    expect(spread).toBeGreaterThan(0.01)
  })
})

describe('the shapes and lines', () => {
  const still = { drift: 0, colour: 0, crawl: 0 }
  const drawn = (s: Scene, phases: Phases = still) => pixels(advance(s, newLive(), 0, 60), phases)
  const of = (kind: ShapeKind, r: number) => (kind === 'star' ? star(5, 2.5, r) : shape(kind, r, 0.5, { n: 5 }))

  it.each(SHAPES)('a %s draws finite and not blank, alone and joined into a star', async (kind) => {
    const s = scene({
      name: kind,
      zoom: 1.4,
      levels: [
        level('alone', { scale: 0.8, shape: of(kind, 0.4) }),
        level('joined', { scale: 2, shape: star(6, 2, 0.25, { join: join(of(kind, 0.2), [0.15, 0], 0.08) }) }),
      ],
      line: 'smooth',
      width: 0.01,
    })
    const { finite, mean, spread } = await shoot(s, still)
    expect(finite).toBe(true)
    expect(mean).toBeGreaterThan(0.01)
    expect(spread).toBeGreaterThan(0.01)
  })

  it("in screen units holds a line's width through a variation's stretch as through an affine scale", async () => {
    const lines = (s: Parameters<typeof level>[1]) =>
      scene({ name: 's', levels: [level('a', { shape: star(6, 2, 0.4), ...s })], units: 'screen', width: 0.01 })
    const scaled = await drawn(lines({ scale: 2 }))
    // the fisheye's touch makes the shader measure the stretch rather than read the linear weight
    const stretched: [VariationKind, number][][] = [
      [['linear', 2]],
      [
        ['linear', 2],
        ['fisheye', 1e-7],
      ],
    ]
    for (const vary of stretched) expect(furthest(await drawn(lines({ vary })), scaled)).toBeLessThan(0.02)
  })

  it('spill draws what the cells round a cell reach into it, and nothing where they do not reach', async () => {
    const hexes = (r: number, spill?: number) =>
      scene({ name: 's', levels: [level('a', { shape: star(6, 2, r), spill })], line: 'smooth', width: 0.01 })
    expect(furthest(await drawn(hexes(0.3, 1)), await drawn(hexes(0.3)))).toBeLessThan(1e-4)
    expect(furthest(await drawn(hexes(0.8, 1)), await drawn(hexes(0.8)))).toBeGreaterThan(0.1)
  })

  it.each(SPILLS)('spill on a %s lattice draws finite and reaches over from the cells round', async (lattice) => {
    const big = (spill?: number) =>
      scene({
        name: 's',
        levels: [
          level('a', {
            lattice,
            e2: [0.5, 0.9],
            ...(lattice === 'voronoi' && { jitter: 0.5 }),
            shape: star(6, 2, 0.8),
            spill,
          }),
        ],
        line: 'smooth',
        width: 0.01,
      })
    const [on, off] = [await drawn(big(1)), await drawn(big())]
    expect(on.every(Number.isFinite)).toBe(true)
    expect(furthest(on, off)).toBeGreaterThan(0.1)
  })

  it('dots fade from one whole count to the next, and crawl round their outlines', async () => {
    const dots = (count: number) =>
      scene({
        name: 's',
        levels: [level('a', { shape: shape('box', 0.35, 0.8) })],
        line: 'dots',
        dots: { count, size: 0.3, crawl: 1 },
        width: 0.02,
        gamma: 1,
      })
    const [twelve, half, thirteen] = await Promise.all([12, 12.5, 13].map((n) => drawn(dots(n))))
    expect(
      furthest(
        half,
        twelve.map((v, i) => (v + thirteen[i]) / 2),
      ),
    ).toBeLessThan(1e-4)
    expect(furthest(await drawn(dots(12), { ...still, crawl: 0.5 }), twelve)).toBeGreaterThan(0.1)
  })
})

describe('a loop', () => {
  it.each(['Tapestry 1', 'Tapestry 6'])('%s draws its frame a loop on as its first', async (name) => {
    const s = snapLoop({ ...look(name), loop: { seconds: 10 } }, 97)
    const live = newLive()
    const first = advance(s, live, 0.1, 97)
    const want = await pixels(first, live)
    for (let i = 1; i < 100; i++) advance(s, live, 0.1, 97)
    const last = advance(s, live, 0.1, 97)
    expect(furthest(await pixels(last, live), want)).toBeLessThan(1e-4)
  })
})

describe("Play's transitions", () => {
  // an autopilot walk of the built-in bank, the same each run
  let seed = 11
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  const walk: Keyframe[] = [{ entry: BANK.scenes[0], scene: entryScene(LOOKS, BANK.scenes[0])! }]
  while (walk.length < 9) walk.push(step(BANK, LOOKS, walk[walk.length - 1], random)!)
  const legs = walk.slice(1, -1).map((to, i) => ({
    name: `${walk[i].entry} into ${to.entry}`,
    before: walk[i - 1] ?? walk[i],
    from: walk[i],
    to,
    after: walk[i + 2],
  }))

  it.each(legs)('$name is finite and not blank through its curve', async ({ before, from, to, after }) => {
    const [vb, vf, vt, va] = [before, from, to, after].map((k) => valuesOf(k.scene))
    const curve = bendOf(from.scene, to.scene, tangent(vb, vt), tangent(vf, va))
    for (const t of [0.25, 0.5, 0.75]) {
      const [la, lb] = [newLive(), newLive()]
      const [a, b] = [advance(from.scene, la, 7.3 + 2 * t, 60), advance(to.scene, lb, 2 * t, 60)]
      const { scene, toward } = morph(a, b, smooth(0, 1, t), BANK.autopilot.edge, lb)
      bend(scene, curve, t)
      const { finite, mean, spread } = await shoot(scene, la, toward)
      expect(finite, `at ${t}`).toBe(true)
      expect(mean, `mean at ${t}`).toBeGreaterThan(0.01)
      expect(spread, `spread at ${t}`).toBeGreaterThan(0.01)
    }
  })
})

describe('the Decks view', () => {
  it('draws A, the mix and B, each at its own size in the corner and nowhere else, finite and not blank', async () => {
    const edge: Edge = { seconds: 2, stagger: 0.4, deepFirst: false }
    const m = morphAt(LOOKS[0], look('Tapestry 7 '), 0.5, edge, 7.3)
    const views: [string, Scene, Phases, Toward | undefined, [number, number]][] = [
      ['A', m.sa, m.la, undefined, [64, 36]],
      ['the mix', m.scene, m.la, m.toward, [128, 72]],
      ['B', m.sb, m.lb, undefined, [64, 36]],
    ]
    for (const [name, scene, phases, toward, [w, h]] of views) {
      const px = await pixels(scene, phases, toward, [w, h])
      // the canvas's 160 by 90 pixels, four values each, bottom row first
      const inCorner = (i: number) => (i >> 2) % 160 < w && (i >> 2) / 160 < h
      expect(
        px.filter((_, i) => !inCorner(i)).every((v) => v === 0),
        name,
      ).toBe(true)
      const { finite, mean, spread } = stats(px.filter((_, i) => inCorner(i)))
      expect(finite, name).toBe(true)
      expect(mean, name).toBeGreaterThan(0.01)
      expect(spread, name).toBeGreaterThan(0.01)
    }
  })
})

describe('the cells, colour and variations', () => {
  const still = { drift: 0, colour: 0, crawl: 0 }
  const drawn = (s: Scene) => pixels(advance(s, newLive(), 0, 60), still)

  // the variations after milestone 1's eight
  it.each(VARIATIONS.slice(8))('a %s warp draws finite and not blank', async (kind) => {
    const s = scene({
      name: kind,
      levels: [
        level('warp', { scale: 1.3, vary: [[kind, 1]], e2: [0.5, Math.sqrt(3) / 2], shape: star(6, 2, 0.42) }),
        level('fine', { scale: 1.7, turn: 30, shape: star(6, 3, 0.4), at: 0.5 }),
      ],
      rings: 1.5,
      width: 0.004,
    })
    const { finite, mean, spread } = await shoot(s, still)
    expect(finite).toBe(true)
    expect(mean).toBeGreaterThan(0.01)
    expect(spread).toBeGreaterThan(0.01)
  })

  const one = (by: Scene['levels'][number]['cell']['by'], o: Parameters<typeof level>[1] = {}) =>
    scene({ name: by, levels: [level('a', { by, shape: star(6, 2.5, 0.4), ...o })], rings: 2, width: 0.004 })

  it('draws ring as none where its cells neither turn nor shift, and moves them out from the middle', async () => {
    const none = await drawn(one('none'))
    expect(furthest(await drawn(one('ring')), none)).toBeLessThan(1e-4)
    expect(furthest(await drawn(one('ring', { cellPhase: 0.2 })), none)).toBeGreaterThan(0.1)
    // none shifts every cell's rings by the phase alike, so the middle cell, ring 0, draws as none at phase 0
    const middle = (px: number[]) => px.slice((45 * 160 + 80) * 4, (45 * 160 + 80) * 4 + 4)
    expect(furthest(middle(await drawn(one('ring', { cellPhase: 0.2 }))), middle(none))).toBeLessThan(1e-4)
  })

  it('draws mirror as none on a shape its reflections keep, and reflects a shape they do not', async () => {
    expect(furthest(await drawn(one('mirror')), await drawn(one('none')))).toBeLessThan(1e-4)
    const moon = { shape: shape('moon', 0.4, 0.5, { twist: 30 }) }
    expect(furthest(await drawn(one('mirror', moon)), await drawn(one('none', moon)))).toBeGreaterThan(0.1)
  })

  it('draws an orbit trap at weight 0 as none, and recolours by it', async () => {
    const none = await drawn(look('Tapestry 7 '))
    const trap = (weight: number) => ({
      ...look('Tapestry 7 '),
      palette: { ...look('Tapestry 7 ').palette, trap: { weight: { value: weight }, size: { value: 0.2 } } },
    })
    expect(furthest(await drawn(trap(0)), none)).toBeLessThan(1e-4)
    expect(furthest(await drawn(trap(2)), none)).toBeGreaterThan(0.1)
  })
})
