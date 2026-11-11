// The one shader compiles in WebGL2 (headless Chrome), and every look and preset renders finite and not blank.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { build, type Rollup } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LOOKS } from './looks'
import { advance, applyPreset, newLive } from './motion'
import type { Scene } from './scene'

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
  if (!chrome) throw new Error('chromium is not on the PATH')
  browser = await puppeteer.launch({
    executablePath: chrome,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  page = await browser.newPage()
  await page.setContent('<canvas width="160" height="90"></canvas>')
  await page.addScriptTag({ content: code })
}, 60_000)

afterAll(() => browser?.close())

// Draw a live scene into a float framebuffer and read back its pixels' stats.
const shoot = (live: Scene, drift: number, colour: number) =>
  page.evaluate(
    (live, drift, colour) => {
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
      renderer.draw(live, { drift, colour })
      const px = new Float32Array(canvas.width * canvas.height * 4)
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.FLOAT, px)
      let finite = true
      let sum = 0
      let sq = 0
      const n = canvas.width * canvas.height
      for (let i = 0; i < px.length; i += 4) {
        const l = (px[i] + px[i + 1] + px[i + 2]) / 3
        if (!Number.isFinite(px[i] + px[i + 1] + px[i + 2])) finite = false
        sum += l
        sq += l * l
      }
      const mean = sum / n
      return { finite, mean, spread: Math.sqrt(Math.max(0, sq / n - mean * mean)) }
    },
    live,
    drift,
    colour,
  )

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
})
