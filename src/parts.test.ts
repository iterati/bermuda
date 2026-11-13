// The shader's parts: needs gives a scene the variation, shape and lattice kinds and the features it holds, by
// presence, the same at every preset, dice and frame, and a morph both ends' and the morph's; the generator leaves out
// each part not given and, with every part on, gives the app's three programs; the engine registry gives every part to
// one engine, in PARTS' order. In WebGL2 (headless Chrome) the core alone and every part on compile and draw, and every
// look and preset, and every bank link's middle, draws on a program of only its own parts exactly as on the everything
// program, both from the renderer's cache. The cache draws a scene's first frame on its own program, compiled then, or
// on the everything program while its own is not ready; it warms the sets it is given in order, each once with a 1x1
// draw, keys a program by its sorted parts and gives its compile time.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { build, type Rollup } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ENGINES } from './engines'
import { background, BANK, fill, join, level, LOOKS, scene, shape, star } from './looks'
import { morph } from './morph'
import { advance, applyPreset, dice, newLive, update, type Live } from './motion'
import { entryScene } from './play'
import type { Drew, Toward } from './render'
import { knobsOf, LATTICES, SHAPES, VARIATIONS, type Scene } from './scene'
import { generateShader, needs, PARTS, type Part } from './shader'

declare global {
  interface Window {
    Bermuda: typeof import('./render')
    renderer?: import('./render').Renderer
    fresh: () => { renderer: import('./render').Renderer; log: Logged[] }
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
      ['shape.box', 'float sdBox('],
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

  it("calls vary, lattice, cellAt and drawn once each in render, with every part on and in main's three programs", () => {
    // each function's call sites, its name's every use but its definition: a compiler inlines each call, so the own
    // cell and the cells round it share one lattice and one cellAt, and the stretch's probes the level's one vary
    const calls = (text: string) =>
      Object.fromEntries(
        (['vary', 'lattice', 'cellAt', 'drawn'] as const).map((fn) => [
          fn,
          (text.match(new RegExp(`\\b${fn}\\(`, 'g'))?.length ?? 0) - 1,
        ]),
      )
    const once = { vary: 1, lattice: 1, cellAt: 1, drawn: 1 }
    for (const parts of [
      PARTS,
      PARTS.filter((p) => p !== 'metal'),
      PARTS.filter((p) => p !== 'metal' && p !== 'fill'),
      [],
    ])
      expect(calls(generateShader(parts)), `${parts.length} parts`).toEqual(once)
  })
})

describe('the engine registry', () => {
  it("gives every part to one engine, in PARTS' order", () => {
    const parts = ENGINES.flatMap((e) => e.parts)
    expect(parts).toEqual(PARTS)
    // each family's kinds but its first, the core's, then the family's feature, then the features alone
    const tail = (family: string, list: readonly string[]) => list.slice(1).map((kind) => `${family}.${kind}`)
    expect(parts).toEqual([
      ...tail('variation', VARIATIONS),
      'stretch',
      ...tail('shape', SHAPES),
      'join',
      ...tail('lattice', LATTICES),
      'spill',
      'dots',
      'soak',
      'morph',
      'fill',
      'metal',
    ])
    expect(new Set(parts).size).toBe(parts.length)
    expect(ENGINES.map((e) => e.name)).toEqual(['fractal', 'shapes', 'tiling', 'lines', 'backgrounds', 'morph', 'deco'])
  })
})

// what a fresh renderer's context did: each fragment shader compiled (its source, when its compile started), each
// draw's viewport and each read's size, and when it ended
type Logged = { compile: string; at: number } | { draw: number[] } | { read: [number, number]; at: number }

describe('in WebGL2', () => {
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
    // a renderer on a canvas of its own, its context's compiles, draws and reads logged
    await page.evaluate(() => {
      window.fresh = () => {
        const canvas = document.createElement('canvas')
        ;[canvas.width, canvas.height] = [120, 75]
        const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true })!
        const log: Logged[] = []
        const { compileShader, drawArrays, readPixels } = gl
        gl.compileShader = (s) => {
          if (gl.getShaderParameter(s, gl.SHADER_TYPE) === gl.FRAGMENT_SHADER)
            log.push({ compile: gl.getShaderSource(s)!, at: performance.now() })
          compileShader.call(gl, s)
        }
        gl.drawArrays = (...args) => {
          const viewport: Int32Array = gl.getParameter(gl.VIEWPORT)
          log.push({ draw: [...viewport] })
          drawArrays.apply(gl, args)
        }
        Object.defineProperty(gl, 'readPixels', {
          value: (...args: Parameters<typeof readPixels>) => {
            readPixels.apply(gl, args)
            log.push({ read: [args[2], args[3]], at: performance.now() })
          },
        })
        return { renderer: window.Bermuda.createRenderer(canvas), log }
      }
    })
  }, 60_000)

  afterAll(() => browser?.close())

  type Phases = Pick<Live, 'drift' | 'colour' | 'crawl'>

  // a scene of each few parts, its level's lattice, shape or variation
  const few = (s: Parameters<typeof level>[1]) => scene({ name: 'few', levels: [level('a', s)] })
  const triangle = few({ lattice: 'triangle' })
  const box = few({ shape: shape('box', 0.4, 0.5) })
  const swirl = few({ vary: [['swirl', 1]] })
  const both = few({ lattice: 'triangle', shape: shape('box', 0.4, 0.5) })

  // On a fresh renderer, draw each scene at t = 0 on these parts (none: the everything program), warming these sets
  // first and running steps where asked after a draw: what each draw drew on, and what the context did, its
  // fragment shaders named by the set (or everything program) whose shader they are.
  const run = async (
    draws: { scene: Scene; parts?: Part[]; warm?: Part[][]; step?: boolean }[],
    names: Record<string, Iterable<Part>>,
  ) => {
    const { drift, colour, crawl } = newLive()
    const { drew, log } = await page.evaluate(
      (draws, phases) => {
        const { renderer, log } = window.fresh()
        const drew: Drew[] = []
        for (const { scene, parts, warm, step } of draws) {
          if (warm) {
            renderer.warm(warm)
            while (renderer.step()) continue
          }
          drew.push(renderer.draw(scene, phases, undefined, undefined, parts))
          if (step) renderer.step()
        }
        renderer.gl.getExtension('WEBGL_lose_context')?.loseContext()
        return { drew, log }
      },
      draws,
      { drift, colour, crawl },
    )
    const named = new Map(Object.entries(names).map(([name, parts]) => [generateShader(parts), name]))
    return {
      drew,
      log: log.map((l) => ('compile' in l ? { ...l, compile: named.get(l.compile) ?? 'another' } : l)),
    }
  }
  const compiled = (log: Logged[]) => log.flatMap((l) => ('compile' in l ? [l.compile] : []))
  // what follows each compile: its warm-up draw at 1x1 and its one pixel read back
  const warmups = (log: Logged[]) =>
    log.flatMap((l, i) =>
      'compile' in l ? [log.slice(i + 1, i + 3).map((m) => ('draw' in m ? m.draw : 'read' in m ? m.read : m))] : [],
    )

  describe('the program cache', { timeout: 60_000 }, () => {
    it("draws a scene's first frame on its own program, compiled then", async () => {
      const { drew, log } = await run([{ scene: triangle, parts: [...needs(triangle)] }], { own: needs(triangle) })
      expect(drew).toEqual([{ parts: ['lattice.triangle'], fallback: false, ms: expect.any(Number) }])
      expect(compiled(log)).toEqual(['own'])
      expect(warmups(log)).toEqual([
        [
          [0, 0, 1, 1],
          [1, 1],
        ],
      ])
      // then the frame itself, over the whole canvas
      expect(log.at(-1)).toEqual({ draw: [0, 0, 120, 75] })
    })

    it(
      "draws on the everything program while a scene's program is not ready, then on its own once warmed",
      { timeout: 120_000 },
      async () => {
        const plainSet = PARTS.filter((p) => p !== 'fill' && p !== 'metal')
        const { drew, log } = await run(
          [{ scene: box }, { scene: box, parts: ['shape.box'], step: true }, { scene: box, parts: ['shape.box'] }],
          { plain: plainSet, own: ['shape.box'] },
        )
        expect(drew.map(({ parts, fallback }) => [parts, fallback])).toEqual([
          [sorted(plainSet), false],
          [sorted(plainSet), true],
          [['shape.box'], false],
        ])
        // the scene's own program compiled between the frames, after the one that fell back
        expect(compiled(log)).toEqual(['plain', 'own'])
      },
    )

    it('warms the sets it is given in their order, each once, with a 1x1 draw, skipping those ready', async () => {
      const { drew, log } = await run(
        [
          { scene: triangle, parts: ['lattice.triangle'] },
          {
            scene: box,
            parts: ['shape.box'],
            warm: [['shape.box'], ['lattice.triangle'], ['variation.swirl'], ['shape.box']],
          },
          { scene: swirl, parts: ['variation.swirl'] },
        ],
        { triangle: needs(triangle), box: needs(box), swirl: needs(swirl) },
      )
      expect(compiled(log)).toEqual(['triangle', 'box', 'swirl'])
      expect(warmups(log)).toEqual(
        Array(3).fill([
          [0, 0, 1, 1],
          [1, 1],
        ]),
      )
      expect(drew.map((d) => d.fallback)).toEqual([false, false, false])
      // the warmed programs draw their frames with no compile of their own
      expect(log.filter((l) => 'draw' in l)).toHaveLength(6)
    })

    it('keys a program by its sorted parts, so the same parts in another order draw on it', async () => {
      const { drew, log } = await run(
        [
          { scene: both, parts: ['shape.box', 'lattice.triangle'] },
          { scene: both, parts: ['lattice.triangle', 'shape.box'] },
          { scene: both, parts: ['shape.box', 'lattice.triangle', 'shape.box'] },
        ],
        { both: needs(both) },
      )
      expect(compiled(log)).toEqual(['both'])
      expect(drew.map((d) => d.parts)).toEqual(Array(3).fill(['lattice.triangle', 'shape.box']))
      expect(new Set(drew.map((d) => d.ms)).size).toBe(1)
    })

    it("gives each program's compile time, to the end of its warm-up draw", async () => {
      const { drew, log } = await run(
        [
          { scene: triangle, parts: ['lattice.triangle'] },
          { scene: box, parts: ['shape.box'] },
          { scene: triangle, parts: ['lattice.triangle'] },
        ],
        { triangle: needs(triangle), box: needs(box) },
      )
      // from its fragment shader's compile to its warm-up's read: the renderer's own span holds that one, and a
      // few milliseconds more at most, the vertex shader's compile and the generator's text
      const spans = log.flatMap((l, i) => {
        if (!('compile' in l)) return []
        const read = log.slice(i).find((m) => 'read' in m)!
        return 'at' in read ? [read.at - l.at] : []
      })
      expect(spans).toHaveLength(2)
      for (const [i, span] of spans.entries()) {
        expect(drew[i].ms).toBeGreaterThanOrEqual(span)
        expect(drew[i].ms).toBeLessThan(span + 100)
      }
      expect(drew[2].ms).toBe(drew[0].ms)
    })
  })

  // a program of a few parts builds in about a second on its first draw, and draws in a fraction of one: 2 s at most
  describe('the parts programs', { timeout: 15_000 }, () => {
    // Draw a live scene on the program of these parts, warmed first, and on the everything program, each from the one
    // renderer's cache on the canvas's one context and into a float framebuffer: the largest difference of any
    // component, the parts program's pixels' stats, and what its draw drew on.
    const compare = (live: Scene, { drift, colour, crawl }: Phases, toward: Toward | undefined, parts: Part[]) =>
      page.evaluate(
        (live, phases, toward, parts) => {
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
          // warmed with the float target bound, so its warm-up draw is in the format it draws in
          renderer.warm([parts])
          while (renderer.step()) continue
          const [[a], [b, drew]] = [undefined, parts].map((p) => {
            gl.activeTexture(gl.TEXTURE0)
            const drew = renderer.draw(live, phases, toward, undefined, p)
            const px = new Float32Array(canvas.width * canvas.height * 4)
            gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.FLOAT, px)
            return [px, drew] as const
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
          return { furthest, finite, mean: sum / (a.length / 4), drew }
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
        const { finite, mean, drew } = await compare(frame, live, undefined, parts)
        expect(drew, `${parts.length} parts`).toEqual({ parts, fallback: false, ms: expect.any(Number) })
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
          const { furthest, drew } = await compare(advance(scene, live, t, t), live, undefined, parts)
          expect(drew, `at ${t} s`).toEqual({ parts, fallback: false, ms: expect.any(Number) })
          expect(furthest, `at ${t} s on ${parts.join(' ')}`).toBe(0)
        }
      })
    }

    // a scene whose one level swaps its lattice kind, its sectors or a mirror, as render.test.ts has them
    const alone = (s: Parameters<typeof level>[1]) =>
      scene({
        name: 'alone',
        levels: [level('l', { turn: 20, cellTurn: 25, shape: star(6, 2.5, 0.4), ...s })],
        rings: 2,
      })
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
        const { furthest, drew } = await compare(scene, la, toward, parts)
        expect(drew).toEqual({ parts, fallback: false, ms: expect.any(Number) })
        expect(furthest, parts.join(' ')).toBe(0)
      },
    )
  })
})
