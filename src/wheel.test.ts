// The scroll wheel on the knobs, the app itself in headless Chrome at 1280x800, in Stage, Edit and Decks: a knob
// clicked and then wheeled where it was clicked takes every notch, a wheel over a knob in a panel that scrolls turns
// the knob and leaves the panel where it was, a burst of wheel events before one render takes every step, and a
// wheel over the picture turns the focused knob.
import { execFileSync } from 'node:child_process'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

let server: ViteDevServer
let browser: Browser
let page: Page

beforeAll(async () => {
  server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0, hmr: false } })
  await server.listen()
  const chrome = execFileSync('sh', ['-c', 'command -v chromium'], { encoding: 'utf8' }).trim()
  browser = await puppeteer.launch({
    executablePath: chrome,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })
  // the picture drawn a few pixels across, which swiftshader keeps up with; the panels lay out as at full size
  await page.evaluateOnNewDocument(() => Object.defineProperty(window, 'devicePixelRatio', { get: () => 0.05 }))
}, 60_000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

// a knob of Tapestry 1's first level, on screen in every view, at 0°
const TURN = 'levels[sq1].affine.turn'
const PANEL = { stage: '.stage .bottom', edit: '.edit .rack', decks: '.mixer > .panel:nth-child(2)' }
// a spot on the picture that no panel covers
const OPEN = { stage: { x: 640, y: 300 }, edit: { x: 360, y: 400 }, decks: { x: 640, y: 120 } }
const modes = ['stage', 'edit', 'decks'] as const
type Mode = (typeof modes)[number]

let mode: Mode
beforeEach(async () => {
  await page.goto(server.resolvedUrls!.local[0])
  await page.waitForSelector('.knob')
  mode = 'stage'
}, 60_000)

const to = async (m: Mode) => {
  if (m !== 'stage') await page.keyboard.press(m === 'edit' ? 'e' : 'd')
  await page.waitForSelector(`.${m} .knob`)
  mode = m
}

// every knob on screen by its address: its centre, and where its value arc ends, 0 to 1 of its range
const knobs = () =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>('.knob')].map((el) => {
        const r = el.getBoundingClientRect()
        const d = el.querySelector('path.value')!.getAttribute('d')!
        const [x, y] = d.split(' ').slice(-2).map(Number)
        const f = d ? ((Math.atan2(x - 22, 22 - y) * 180) / Math.PI + 135) / 270 : 0
        return [el.title.split('\n')[0], { x: r.x + r.width / 2, y: r.y + r.height / 2, f }]
      }),
    ),
  )

// the knob's value once it reaches want, or as it is after a few seconds
async function settle(address: string, want: number) {
  let f = NaN
  for (const end = Date.now() + 5000; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) {
    f = (await knobs())[address].f
    if (Math.abs(f - want) < 1e-6) break
  }
  return f
}

// the knobs whose values moved, but the one aimed at
const others = (before: Record<string, { f: number }>, after: Record<string, { f: number }>, aimed: string) =>
  Object.keys(after).filter((k) => k !== aimed && k in before && Math.abs(after[k].f - before[k].f) > 1e-6)

// wheel notches up where the pointer is, a hand's turn apart
async function notches(n: number) {
  for (let i = 0; i < n; i++) {
    await page.mouse.wheel({ deltaY: -100 })
    await new Promise((r) => setTimeout(r, 150))
  }
}

const scrollOf = () => page.$eval(PANEL[mode], (el) => el.scrollTop)

describe('the wheel on a knob', () => {
  it.each(modes)(
    'in %s turns a knob clicked and then wheeled where it was clicked, by every notch',
    async (m) => {
      await to(m)
      const before = await knobs()
      const { x, y, f } = before[TURN]
      await page.mouse.click(x, y)
      await new Promise((r) => setTimeout(r, 200))
      await notches(3)
      expect(await settle(TURN, f + 0.03)).toBeCloseTo(f + 0.03, 6)
      expect(others(before, await knobs(), TURN)).toEqual([])
    },
    30_000,
  )

  it.each(modes)(
    'in %s turns a knob down in a panel that scrolls, and the panel stays where it was',
    async (m) => {
      await to(m)
      const before = await knobs()
      const top = await scrollOf()
      expect(await page.$eval(PANEL[mode], (el) => el.scrollHeight > el.clientHeight)).toBe(true)
      const { x, y, f } = before[TURN]
      await page.mouse.move(x, y)
      for (let i = 0; i < 3; i++) await page.mouse.wheel({ deltaY: 100 })
      expect(await settle(TURN, f - 0.03)).toBeCloseTo(f - 0.03, 6)
      expect(await scrollOf()).toBe(top)
      expect(others(before, await knobs(), TURN)).toEqual([])
    },
    30_000,
  )

  it('takes every one of a burst of wheel events before a render', async () => {
    const { f } = (await knobs())[TURN]
    await page.evaluate((address) => {
      const el = [...document.querySelectorAll<HTMLElement>('.knob')].find((k) => k.title.startsWith(`${address}\n`))!
      for (let i = 0; i < 8; i++)
        el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }))
    }, TURN)
    expect(await settle(TURN, f + 0.08)).toBeCloseTo(f + 0.08, 6)
  }, 30_000)

  it.each(modes)(
    'in %s over the picture turns the focused knob',
    async (m) => {
      await to(m)
      const { x, y } = (await knobs())[TURN]
      await page.mouse.click(x, y)
      const before = await knobs()
      const open = OPEN[mode]
      expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, open)).toBe('CANVAS')
      await page.mouse.move(open.x, open.y)
      await notches(3)
      expect(await settle(TURN, before[TURN].f + 0.03)).toBeCloseTo(before[TURN].f + 0.03, 6)
      expect(others(before, await knobs(), TURN)).toEqual([])
    },
    30_000,
  )
})
