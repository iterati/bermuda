// The app as built, in headless Chrome: Stage, Edit and Decks each show a picture that is not blank, Decks its
// two decks and the mix between them, and a look cued onto B changes B's deck and nothing A shows.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { build, type Rollup } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ORIGIN = 'http://bermuda.test'

let browser: Browser
let page: Page

beforeAll(async () => {
  const out = (await build({
    root: fileURLToPath(new URL('..', import.meta.url)),
    logLevel: 'silent',
    build: { write: false },
  })) as Rollup.RollupOutput
  const files = new Map(out.output.map((f) => [f.fileName, f.type === 'chunk' ? f.code : f.source]))
  const chrome = execFileSync('sh', ['-c', 'command -v chromium'], { encoding: 'utf8' }).trim()
  browser = await puppeteer.launch({
    executablePath: chrome,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  page = await browser.newPage()
  // the layout at its usual size, its pictures drawn at a quarter of it, as software GL is slow
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 0.25 })
  // the build served from memory
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    const name = new URL(req.url()).pathname.slice(1)
    const body = files.get(name)
    if (body === undefined) return req.respond({ status: 404 })
    const type = name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript'
    req.respond({ status: 200, contentType: type, body: typeof body === 'string' ? body : Buffer.from(body) })
  })
  await page.goto(`${ORIGIN}/index.html`)
  await page.waitForSelector('canvas.picture')
  // the clock stopped, so each picture holds still
  await page.keyboard.press('Space')
}, 60_000)

afterAll(() => browser?.close())

// a few frames drawn, so a canvas resized by the view has been drawn again
const frames = () =>
  page.evaluate(async () => {
    for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame)
  })

// each canvas the selector names: its pixels, lightness 0 to 1, their mean and spread
const canvases = (selector: string) =>
  page.evaluate((selector) => {
    return [...document.querySelectorAll('canvas')]
      .filter((c) => c.matches(selector))
      .map((c) => {
        const copy = document.createElement('canvas')
        ;[copy.width, copy.height] = [c.width, c.height]
        const ctx = copy.getContext('2d')!
        ctx.drawImage(c, 0, 0)
        const data = ctx.getImageData(0, 0, c.width, c.height).data
        const px: number[] = []
        for (let i = 0; i < data.length; i += 4) px.push((data[i] + data[i + 1] + data[i + 2]) / 765)
        const mean = px.reduce((s, v) => s + v, 0) / px.length
        const spread = Math.sqrt(px.reduce((s, v) => s + (v - mean) ** 2, 0) / px.length)
        return { px, mean, spread }
      })
  }, selector)

// Decks' three pictures: A's deck, the mix and B's deck
const decks = async () => {
  const [[a], [mix], [b]] = await Promise.all(
    ['.deck-column.a canvas', 'canvas.picture', '.deck-column.b canvas'].map(canvases),
  )
  return { a, mix, b }
}

const view = async (name: string) => {
  await page.$$eval('.seg button', (buttons, name) => buttons.find((b) => b.textContent === name)!.click(), name)
  await frames()
}

const furthest = (x: number[], y: number[]) => x.reduce((most, v, i) => Math.max(most, Math.abs(v - y[i])), 0)

describe('the views', { timeout: 30_000 }, () => {
  it.each(['Stage', 'Edit', 'Decks'])('%s shows a picture that is not blank', async (name) => {
    await view(name)
    const pictures = name === 'Decks' ? Object.values(await decks()) : await canvases('*')
    expect(pictures).toHaveLength(name === 'Decks' ? 3 : 1)
    for (const { mean, spread } of pictures) {
      expect(mean).toBeGreaterThan(0.01)
      expect(spread).toBeGreaterThan(0.01)
    }
  })

  it('cues a look onto B in Decks without changing what A shows', async () => {
    await view('Decks')
    const before = await decks()
    const cue = await page.$eval('.deck-column.b select', (select) => {
      const look = [...select.options].find((o) => o.text.startsWith('Tapestry 3'))!
      return { value: look.value, name: look.text }
    })
    await page.select('.deck-column.b select', cue.value)
    await frames()
    expect(await page.$eval('.deck-column.b .deck-title b', (b) => b.textContent)).toBe(cue.name)
    expect(await page.$eval('.deck-column.b .deck-state', (s) => s.textContent)).toBe('cued')
    const after = await decks()
    expect(furthest(after.a.px, before.a.px)).toBe(0)
    expect(furthest(after.mix.px, before.mix.px)).toBe(0)
    expect(furthest(after.b.px, before.b.px)).toBeGreaterThan(0.1)
  })
})
