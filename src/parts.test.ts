// The shader's parts: needs gives a scene the variation, shape and lattice kinds and the features it holds, by
// presence, the same at every preset, dice and frame, and a morph both ends' and the morph's; the generator leaves
// out each part not given and, with every part on, gives the app's three programs. In WebGL2 (headless Chrome) the
// core alone and every part on compile and draw, and every look and preset, and every bank link's middle, draws on a
// program of only its own parts exactly as on the everything program.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { build, type Rollup } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { background, BANK, fill, join, level, LOOKS, scene, shape, star } from './looks'
import { morph } from './morph'
import { advance, applyPreset, dice, newLive, update, type Live } from './motion'
import { entryScene } from './play'
import type { Toward } from './render'
import { knobsOf, LATTICES, SHAPES, VARIATIONS, type Scene } from './scene'
import { generateShader, needs, PARTS, type Part } from './shader'

declare global {
  interface Window {
    Bermuda: typeof import('./render')
    everything?: import('./render').Renderer
    programs?: Map<string, import('./render').Renderer>
  }
}

const look = (name: string) => LOOKS.find((l) => l.name.startsWith(name))!
const plain = scene({ name: 'plain', levels: [level('a')] })
const sorted = (parts: Iterable<Part>) => [...parts].sort()

describe('needs', () => {
  it('needs nothing but the core for one linear, oblique, star level with glow lines', () => {
    expect(sorted(needs(plain))).toEqual([])
  })

  it('needs each variation, shape and lattice kind a scene uses, and no other', () => {
    for (const kind of VARIATIONS) {
      const s = scene({ name: kind, levels: [level('a', { vary: [[kind, 1]] })] })
      expect(sorted(needs(s)), kind).toEqual(kind === 'linear' ? [] : [`variation.${kind}`])
    }
    for (const kind of SHAPES) {
      const s = scene({
        name: kind,
        levels: [level('a', { shape: kind === 'star' ? star(5, 2, 0.4) : shape(kind, 0.4, 0.5) })],
      })
      expect(sorted(needs(s)), kind).toEqual(kind === 'star' ? [] : [`shape.${kind}`])
    }
    for (const kind of LATTICES) {
      const s = scene({ name: kind, levels: [level('a', { lattice: kind })] })
      expect(sorted(needs(s)), kind).toEqual(kind === 'oblique' ? [] : [`lattice.${kind}`])
    }
    // a heart variation and a heart shape are two parts, and a sub-chain's kinds count too
    const below = level('b', { vary: [['swirl', 0.5]], lattice: 'voronoi', shape: shape('box', 0.4, 0.5) })
    const s = scene({
      name: 'mixed',
      levels: [
        level('a', {
          vary: [
            ['linear', 1],
            ['heart', 0.2],
          ],
          lattice: 'triangle',
          variants: [
            { share: 1, shape: shape('heart', 0.4, 0) },
            { share: 1, shape: star(6, 2, 0.4), below: [below] },
          ],
        }),
      ],
    })
    expect(sorted(needs(s))).toEqual(
      sorted(['variation.heart', 'variation.swirl', 'shape.heart', 'shape.box', 'lattice.triangle', 'lattice.voronoi']),
    )
  })

  it('needs a join, spill, dots, a soak and a fill only where the scene has them, and the stretch for screen lines or metal', () => {
    const at = (s: Partial<Parameters<typeof scene>[0]>, l: Parameters<typeof level>[1] = {}) =>
      sorted(needs(scene({ name: 'at', levels: [level('a', l)], ...s })))
    expect(at({}, { shape: star(6, 2, 0.4, { join: join(shape('box', 0.2, 0.5), [0.1, 0], 0.05, 0) }) })).toEqual([
      'join',
      'shape.box',
    ])
    expect(at({}, { spill: 0 })).toEqual(['spill'])
    expect(at({ line: 'dots', dots: { count: 12, size: 0.5, crawl: 0 } })).toEqual(['dots'])
    expect(at({ background: background('soak') })).toEqual(['soak'])
    expect(at({ background: background('flat') })).toEqual([])
    expect(at({ background: background('gradient') })).toEqual([])
    // a fill brings metal by presence, at metal 0, and metal the stretch
    expect(at({}, { fill: fill({ amount: 0 }) })).toEqual(['fill', 'metal', 'stretch'])
    expect(at({ units: 'screen' })).toEqual(['stretch'])
  })

  it('needs the same parts for each look at its presets, dice over its knobs, and its frames at 0, 7.3 and 41 s', () => {
    let seed = 1
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (const l of LOOKS) {
      const parts = sorted(needs(l))
      for (const p of l.presets) expect(sorted(needs(applyPreset(l, p))), `${l.name} / ${p.name}`).toEqual(parts)
      const diced = update(l, (d) =>
        dice(
          d,
          knobsOf(d).map((k) => k.address),
          random,
        ),
      )
      expect(sorted(needs(diced)), `${l.name} diced`).toEqual(parts)
      for (const t of [0, 7.3, 41])
        expect(sorted(needs(advance(l, newLive(), t, t))), `${l.name} at ${t}`).toEqual(parts)
    }
  })

  it("needs both ends' parts and the morph's for a morph, and nothing else", () => {
    expect(sorted(needs(plain, plain))).toEqual(['morph'])
    for (const [a, b] of BANK.links) {
      const [sa, sb] = [entryScene(LOOKS, a)!, entryScene(LOOKS, b)!]
      const both = needs(sa, sb)
      expect(sorted(both), `${a} into ${b}`).toEqual(sorted(new Set([...needs(sa), ...needs(sb), 'morph' as const])))
      // the middle's scene and a lone level's other switches draw with nothing more
      const { scene, toward } = morph(sa, sb, 0.5, BANK.autopilot.edge, newLive())
      const cross = toward.cross ? needs({ ...scene, levels: toward.cross.levels }) : new Set<Part>()
      for (const part of [...needs(scene), ...cross]) expect(both.has(part), `${a} into ${b}: ${part}`).toBe(true)
    }
  })
})

// the kinds a program's text holds, by the comment the generator writes on each kind's line
const kindsIn = (text: string) => ({
  variation: [...text.matchAll(/; \} \/\/ (\w+)$/gm)].map((m) => m[1]),
  shape: [...text.matchAll(/^ {4}case \d+: .*; \/\/ (\w+)$/gm)].map((m) => m[1]),
  lattice: [...text.matchAll(/\{ \/\/ (\w+)$/gm)].map((m) => m[1]),
})
const every = { variation: [...VARIATIONS], shape: [...SHAPES], lattice: [...LATTICES] }

describe('generateShader', () => {
  it('generates each variation, shape and lattice only when its part is on', () => {
    const core = { variation: ['linear'], shape: ['star'], lattice: ['oblique'] }
    expect(kindsIn(generateShader([]))).toEqual(core)
    for (const part of PARTS) {
      const [family, kind] = part.split('.') as [keyof typeof core, string?]
      if (!kind) continue
      const text = generateShader([part])
      expect(kindsIn(text), part).toEqual({
        ...core,
        [family]: every[family].filter((k) => core[family].includes(k) || k === kind),
      })
    }
    // the kinds' own functions go with them
    for (const [part, fn] of [
      ['variation.ex', 'vec2 ex('],
      ['variation.foci', 'vec2 foci('],
      ['shape.ziggurat', 'float sdZiggurat('],
      ['shape.heart', 'float sdHeart('],
      ['lattice.voronoi', 'vec4 voronoi('],
      ['join', 'float smin('],
      ['dots', 'float dotted('],
      ['soak', 'float fbm('],
      ['stretch', 'mat2 stretch('],
    ] as const) {
      expect(generateShader([]), part).not.toContain(fn)
      expect(generateShader([part]), part).toContain(fn)
    }
  })

  it("generates main's three programs with every part on, without metal, and without fill and metal", () => {
    const programs = [
      generateShader(),
      generateShader(PARTS.filter((p) => p !== 'metal')),
      generateShader(PARTS.filter((p) => p !== 'metal' && p !== 'fill')),
    ]
    // the defines before METAL's, which brings FILL
    const defines = (text: string) => text.split('#ifdef METAL')[0].match(/^#define \w+$/gm) ?? []
    expect(programs.map(defines)).toEqual([['#define METAL'], ['#define FILL'], []])
    for (const text of programs) expect(kindsIn(text)).toEqual(every)
    expect(generateShader(PARTS)).toBe(programs[0])
  })
})

// a program of a few parts builds in about a second on its first draw, and draws in a fraction of one: 2 s at most
describe('the parts programs', { timeout: 15_000 }, () => {
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
    await page.setContent('<canvas width="120" height="75"></canvas>')
    await page.addScriptTag({ content: code })
  }, 60_000)

  afterAll(() => browser?.close())

  type Phases = Pick<Live, 'drift' | 'colour' | 'crawl'>

  // Draw a live scene on the program of these parts (every parts set compiled once, all on the canvas's one
  // context) and on the everything program, each into a float framebuffer: the largest difference of any component,
  // and the parts program's pixels' stats.
  const compare = (live: Scene, { drift, colour, crawl }: Phases, toward: Toward | undefined, parts: Part[]) =>
    page.evaluate(
      (live, phases, toward, parts) => {
        const canvas = document.querySelector('canvas')!
        const everything = (window.everything ??= window.Bermuda.createRenderer(canvas))
        const programs = (window.programs ??= new Map())
        const key = parts.join(' ')
        if (!programs.has(key)) programs.set(key, window.Bermuda.createRenderer(canvas, parts))
        const { gl } = everything
        if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('no float framebuffers')
        const target = gl.createTexture()
        gl.bindTexture(gl.TEXTURE_2D, target)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, canvas.width, canvas.height, 0, gl.RGBA, gl.FLOAT, null)
        const fb = gl.createFramebuffer()
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0)
        const [a, b] = [everything, programs.get(key)!].map((renderer) => {
          gl.activeTexture(gl.TEXTURE0)
          renderer.draw(live, phases, toward)
          const px = new Float32Array(canvas.width * canvas.height * 4)
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.FLOAT, px)
          return px
        })
        gl.deleteFramebuffer(fb)
        gl.deleteTexture(target)
        let furthest = 0
        let finite = true
        let sum = 0
        for (let i = 0; i < a.length; i++) {
          furthest = Math.max(furthest, Math.abs(a[i] - b[i]))
          if (!Number.isFinite(b[i])) finite = false
          if (i % 4 < 3) sum += b[i] / 3
        }
        return { furthest, finite, mean: sum / (a.length / 4) }
      },
      live,
      { drift, colour, crawl },
      toward,
      parts,
    )

  // the core alone and every part on, and the everything program's plain one: each builds its software code on its
  // first draw, 43 to 53 s the three, every part's the longest
  it('compiles and links the core alone and every part on', { timeout: 90_000 }, async () => {
    const live = newLive()
    const frame = advance(look('Tapestry 7 '), live, 0, 0)
    for (const parts of [[], sorted(PARTS)]) {
      const { finite, mean } = await compare(frame, live, undefined, parts)
      expect(finite, `${parts.length} parts`).toBe(true)
      expect(mean, `${parts.length} parts`).toBeGreaterThan(0.01)
    }
  })

  const cases = LOOKS.flatMap((look): [string, Scene][] => [
    [look.name, look],
    ...look.presets.map((p): [string, Scene] => [`${look.name} / ${p.name}`, applyPreset(look, p)]),
  ])
  // a look with a fill builds its own program's fills and metal on its first draw, and the first look of each of the
  // everything program's fills and metal builds that too: up to 29 s
  for (const [name, scene] of cases) {
    const parts = sorted(needs(scene))
    const timeout = parts.includes('fill') ? 60_000 : 15_000
    it(`draws ${name} on its own parts as on the everything program`, { timeout }, async () => {
      for (const t of [0, 7.3]) {
        const live = newLive()
        const { furthest } = await compare(advance(scene, live, t, t), live, undefined, parts)
        expect(furthest, `at ${t} s on ${parts.join(' ')}`).toBe(0)
      }
    })
  }

  // a scene whose one level swaps its lattice kind, its sectors or a mirror, as render.test.ts has them
  const alone = (s: Parameters<typeof level>[1]) =>
    scene({ name: 'alone', levels: [level('l', { turn: 20, cellTurn: 25, shape: star(6, 2.5, 0.4), ...s })], rings: 2 })
  const links: [string, Scene, Scene][] = [
    ...BANK.links.map(([a, b]): [string, Scene, Scene] => [
      `${a} into ${b}`,
      entryScene(LOOKS, a)!,
      entryScene(LOOKS, b)!,
    ]),
    ['a lone square level into triangles', alone({}), alone({ lattice: 'triangle' })],
    [
      'a lone polar level of 6 sectors into 9',
      alone({ lattice: 'polar', sectors: 6 }),
      alone({ lattice: 'polar', sectors: 9 }),
    ],
    ['a lone level into its mirror', alone({}), alone({ by: 'mirror' })],
  ]
  // at its middle, on the autopilot's edge, both ends 7.3 s in, as render.test.ts's morphAt draws it
  it.each(links)(
    "draws the middle of %s on both ends' parts and the morph's as on the everything program",
    async (_, a, b) => {
      const t = 7.3
      const [la, lb] = [newLive(), newLive()]
      const [sa, sb] = [advance(a, la, t, t), advance(b, lb, t, t)]
      const { scene, toward } = morph(sa, sb, 0.5, BANK.autopilot.edge, lb)
      const parts = sorted(needs(a, b))
      const { furthest } = await compare(scene, la, toward, parts)
      expect(furthest, parts.join(' ')).toBe(0)
    },
  )
})
