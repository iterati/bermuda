// The scroll wheel on the knobs, the app itself in headless Chrome at 1280x800, in Stage, Edit and Decks: a knob
// clicked and then wheeled where it was clicked takes every notch, a notch 1/40 of its play range, a wheel over a
// knob in a panel that scrolls turns the knob and leaves the panel where it was, a burst of wheel events in one frame
// takes every step up to 4 notches and drops the rest, and a wheel over the picture turns the knob Tab is on and
// leaves a clicked one alone. A drag turns no knob and no slider, the wheel turns the sliders, and the A/B fader and
// the lattice pad still drag.
import { execFileSync } from 'node:child_process'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { LOOKS } from './looks'
import { hardRange, notch } from './scene'

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
// a notch of it, as a share of its hard range
const STEP = notch(LOOKS[0], { knob: TURN }) / (hardRange(TURN)[1] - hardRange(TURN)[0])
const PANEL = { stage: '.stage .bottom', edit: '.edit .rack', decks: '.mixer > .panel:nth-child(2)' }
// a spot on the picture that no panel covers
const OPEN = { stage: { x: 640, y: 300 }, edit: { x: 360, y: 400 }, decks: { x: 640, y: 120 } }
const modes = ['stage', 'edit', 'decks'] as const
type Mode = (typeof modes)[number]

let mode: Mode
beforeEach(async () => {
  await page.goto(server.resolvedUrls!.local[0])
  await page.waitForSelector('.knob', { timeout: 55_000 })
  mode = 'stage'
}, 60_000)

const to = async (m: Mode) => {
  // Stage's every knob of the picked chip, past its Perform strip, in a panel that scrolls
  if (m === 'stage') await page.click('.perform-side button[title="every knob of the picked chip"]')
  else await page.keyboard.press(m === 'edit' ? 'e' : 'd')
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
        return [el.title.split('\n')[1].split(' · ')[0], { x: r.x + r.width / 2, y: r.y + r.height / 2, f }]
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
      expect(await settle(TURN, f + 3 * STEP)).toBeCloseTo(f + 3 * STEP, 6)
      expect(others(before, await knobs(), TURN)).toEqual([])
    },
    60_000,
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
      expect(await settle(TURN, f - 3 * STEP)).toBeCloseTo(f - 3 * STEP, 6)
      expect(await scrollOf()).toBe(top)
      expect(others(before, await knobs(), TURN)).toEqual([])
    },
    60_000,
  )

  // a burst of n wheel events up on the knob at address, sent in one go, so in one frame and before a render
  const burst = (n: number, address: string) =>
    page.evaluate(
      (n, address) => {
        const el = [...document.querySelectorAll<HTMLElement>('.knob')].find((k) =>
          k.title.split('\n')[1].startsWith(`${address} · `),
        )!
        for (let i = 0; i < n; i++)
          el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }))
      },
      n,
      address,
    )

  it('takes every one of a burst of wheel events before a render', async () => {
    const { f } = (await knobs())[TURN]
    await burst(4, TURN)
    expect(await settle(TURN, f + 4 * STEP)).toBeCloseTo(f + 4 * STEP, 6)
  }, 60_000)

  it('caps a burst of 8 wheel events in one frame at 4 notches', async () => {
    const { f } = (await knobs())[TURN]
    await burst(8, TURN)
    expect(await settle(TURN, f + 4 * STEP)).toBeCloseTo(f + 4 * STEP, 6)
    await new Promise((r) => setTimeout(r, 300))
    expect((await knobs())[TURN].f).toBeCloseTo(f + 4 * STEP, 6)
    // a later frame's turn lands
    await burst(1, TURN)
    expect(await settle(TURN, f + 5 * STEP)).toBeCloseTo(f + 5 * STEP, 6)
  }, 60_000)

  it.each(modes)(
    'in %s over the picture leaves a clicked knob alone',
    async (m) => {
      await to(m)
      const { x, y } = (await knobs())[TURN]
      await page.mouse.click(x, y)
      const before = await knobs()
      const open = OPEN[mode]
      expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, open)).toBe('CANVAS')
      await page.mouse.move(open.x, open.y)
      await notches(3)
      await new Promise((r) => setTimeout(r, 300))
      expect(others(before, await knobs(), '')).toEqual([])
    },
    60_000,
  )

  it.each(modes)(
    'in %s over the picture turns the Tab-focused knob',
    async (m) => {
      await to(m)
      // Tab on to the knob
      const on = () => page.evaluate(() => (document.activeElement as HTMLElement).dataset.knob)
      for (let i = 0; i < 200 && (await on()) !== TURN; i++) await page.keyboard.press('Tab')
      expect(await on()).toBe(TURN)
      const before = await knobs()
      const open = OPEN[mode]
      expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, open)).toBe('CANVAS')
      await page.mouse.move(open.x, open.y)
      await notches(3)
      expect(await settle(TURN, before[TURN].f + 3 * STEP)).toBeCloseTo(before[TURN].f + 3 * STEP, 6)
      expect(others(before, await knobs(), TURN)).toEqual([])
    },
    60_000,
  )
})

describe('a drag', () => {
  it('a drag on a knob leaves its value', async () => {
    await to('stage')
    const before = await knobs()
    const { x, y } = before[TURN]
    await page.mouse.move(x, y)
    await page.mouse.down()
    for (let i = 1; i <= 10; i++) await page.mouse.move(x + i * 3, y - i * 12)
    await page.mouse.up()
    // and a pointer moving over it after, with no button down
    await page.mouse.move(x, y - 60)
    await new Promise((r) => setTimeout(r, 300))
    expect(others(before, await knobs(), '')).toEqual([])
  }, 60_000)

  // the range input picked by its label, or the first macro's: its value, centre and width, scrolled into view
  const slider = (pick: string) =>
    page.evaluate((pick) => {
      const input = [...document.querySelectorAll<HTMLInputElement>('input[type=range]')].find((el) =>
        pick === 'macro' ? el.matches('.macro-slider') : el.closest('label')?.textContent?.startsWith(pick),
      )!
      input.scrollIntoView({ block: 'center' })
      const r = input.getBoundingClientRect()
      return { value: input.valueAsNumber, x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }
    }, pick)
  const tab = (name: string) =>
    page.evaluate((name) => {
      ;[...document.querySelectorAll<HTMLButtonElement>('.tabs button')].find((b) => b.textContent === name)!.click()
    }, name)
  const pause = () => new Promise((r) => setTimeout(r, 200))

  it('a press or drag on the macro slider, a Bank slider and the stagger leaves its value, and the wheel turns it', async () => {
    for (const [where, pick] of [
      ['Macros', 'macro'],
      ['Bank', 'busy'],
      [undefined, 'stagger'],
    ] as const) {
      if (where) await tab(where)
      const { value, x, y, w } = await slider(pick)
      // a click well off the thumb, then a drag along it
      await page.mouse.click(x + w / 3, y)
      await pause()
      expect((await slider(pick)).value, pick).toBe(value)
      await page.mouse.move(x, y)
      await page.mouse.down()
      for (let i = 1; i <= 10; i++) await page.mouse.move(x + (i * w) / 25, y)
      await page.mouse.up()
      await pause()
      expect((await slider(pick)).value, pick).toBe(value)
      // a notch is 1% of 0 to 1, each way
      await page.mouse.wheel({ deltaY: -100 })
      await pause()
      expect((await slider(pick)).value, pick).toBeCloseTo(value + 0.01, 6)
      await page.mouse.wheel({ deltaY: 100 })
      await pause()
      expect((await slider(pick)).value, pick).toBeCloseTo(value, 6)
    }
  }, 60_000)

  it('the A/B fader and the lattice pad still drag', async () => {
    const at = () => page.$eval('.fader-at', (el) => el.textContent)
    expect(await at()).toBe('0%')
    const r = await page.$eval('svg.fader', (el) => {
      const b = el.getBoundingClientRect()
      return { x: b.x, y: b.y + b.height / 2, w: b.width }
    })
    await page.mouse.move(r.x + 1, r.y)
    await page.mouse.down()
    for (let i = 1; i <= 10; i++) await page.mouse.move(r.x + (i * r.w) / 20, r.y)
    await page.mouse.up()
    await pause()
    expect(Number.parseInt((await at())!)).toBeGreaterThan(40)
    // the first level's pad moves its lattice's second vector, and nothing else
    await to('stage')
    const before = await knobs()
    const pad = await page.$eval('svg.pad', (el) => {
      el.scrollIntoView({ block: 'center' })
      const b = el.getBoundingClientRect()
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    })
    await page.mouse.move(pad.x, pad.y)
    await page.mouse.down()
    for (let i = 1; i <= 10; i++) await page.mouse.move(pad.x + i * 2, pad.y - i * 2)
    await page.mouse.up()
    await pause()
    const moved = others(before, await knobs(), '')
    expect(moved.length).toBeGreaterThan(0)
    expect(moved.every((k) => /^levels\[sq1\]\.lattice\.e2\[[01]\]$/.test(k))).toBe(true)
  }, 60_000)
})
