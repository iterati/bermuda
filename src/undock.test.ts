// Undocking the Stage, the app itself in headless Chrome at 1280x800, on Tapestry 1: U or ⇱ undock opens the
// controls window, the UI in it over a copy of the picture, and the main window keeps the picture alone; open, either
// brings the window to the front. The keys, Tab, Enter and the wheel work in the controls window, a text field there
// keeps its keys, and keys pressed in the main window still reach the app. Closing the controls window, or leaving
// the Stage, docks the UI back, the picture never rebuilt.
import { execFileSync } from 'node:child_process'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { LOOKS } from './looks'
import { hardRange, notch, strip } from './scene'

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

beforeEach(async () => {
  await page.bringToFront()
  await page.goto(server.resolvedUrls!.local[0])
  await page.waitForSelector('.knob', { timeout: 55_000 })
}, 60_000)

const t1 = LOOKS[0]
const TURN = 'levels[sq1].affine.turn'
// a notch of it, as a share of its hard range
const STEP = notch(t1, { knob: TURN }) / (hardRange(TURN)[1] - hardRange(TURN)[0])
// a spot on the Stage's picture that no panel covers
const OPEN = { x: 640, y: 300 }
// the first page of the first level's strip, by knob address or macro id
const STRIP = strip(t1, 'sq1')
  .slice(0, 8)
  .map((t) => ('knob' in t ? t.knob : t.macro))
const pause = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const UNDOCK = '.bar button[title^="undock"]'
const knob = (address: string) => `.knob[data-knob="${address}"]`

// the controls window, caught as the press opens it, at 1280x800 with its knobs drawn
async function undock(press: () => Promise<unknown>) {
  const before = new Set(browser.targets())
  await press()
  const target = await browser.waitForTarget((t) => !before.has(t) && t.type() === 'page', { timeout: 10_000 })
  const popup = (await target.page())!
  await popup.setViewport({ width: 1280, height: 800 })
  await popup.waitForSelector('.knob')
  return popup
}
const pages = async () => (await browser.pages()).length
const title = (p: Page) => p.$eval('.look-title', (el) => (el as HTMLInputElement).value)
// the knob or macro the browser's focus is on in a window
const on = (p: Page) =>
  p.evaluate(() => {
    const el = document.activeElement as HTMLElement
    return el.dataset.knob ?? el.dataset.macro ?? el.tagName
  })
// where a knob's value arc ends, 0 to 1 of its range
const arcOf = (p: Page, address: string) =>
  p.$eval(knob(address), (el) => {
    const d = el.querySelector('path.value')!.getAttribute('d')!
    const [x, y] = d.split(' ').slice(-2).map(Number)
    return d ? ((Math.atan2(x - 22, 22 - y) * 180) / Math.PI + 135) / 270 : 0
  })
// the arc once it reaches want, or as it is after a few seconds
async function settle(p: Page, address: string, want: number) {
  let f = NaN
  for (const end = Date.now() + 5000; Date.now() < end; await pause(50)) {
    f = await arcOf(p, address)
    if (Math.abs(f - want) < 1e-6) break
  }
  return f
}
async function notches(p: Page, n: number) {
  for (let i = 0; i < n; i++) {
    await p.mouse.wheel({ deltaY: -100 })
    await pause(150)
  }
}
// what the main window shows of its app, by class
const showing = () =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.app > *')]
      .filter((el) => el.checkVisibility())
      .map((el) => el.className),
  )

describe('undocking', () => {
  it('U opens the controls window, and the main window keeps the picture alone', async () => {
    const popup = await undock(() => page.keyboard.press('u'))
    expect(await popup.title()).toBe('bermuda · controls')
    expect(await showing()).toEqual(['picture'])
    expect(await page.$$('.bar, .knob, .error')).toEqual([])
    // the Stage in the controls window, over its copy of the picture, styled as the main window was
    const stage = await popup.evaluate(() => ({
      app: document.querySelector('body > .app')?.className,
      monitor: document.querySelector('.app > canvas.picture')?.getBoundingClientRect().width,
      bar: getComputedStyle(document.querySelector('.bar')!).position,
      margin: getComputedStyle(document.body).margin,
      button: document.querySelector('.bar button[title^="undock"]')?.textContent,
      keys: document.querySelector('.bar .keys')?.textContent,
    }))
    expect(stage).toMatchObject({ app: 'app stage', monitor: 1280, bar: 'absolute', margin: '0px' })
    expect(stage.button).toBe('⇲ docked out')
    expect(stage.keys).toContain('F play · U undock · O autopilot')
  }, 60_000)

  it('⇱ undock opens it too, and pressed again focuses the one open', async () => {
    expect(await page.$eval(UNDOCK, (el) => el.textContent)).toBe('⇱ undock')
    const popup = await undock(() => page.click(UNDOCK))
    const n = await pages()
    // each call of the controls window's focus, from either window
    await popup.evaluate(() => {
      const w = window as Window & { focused?: number }
      const focus = w.focus.bind(w)
      w.focused = 0
      w.focus = () => {
        w.focused!++
        focus()
      }
    })
    const focused = () => popup.evaluate(() => (window as Window & { focused?: number }).focused)
    await popup.click(UNDOCK)
    expect(await focused()).toBe(1)
    await page.bringToFront()
    await page.keyboard.press('U')
    expect(await focused()).toBe(2)
    await pause()
    expect(await pages()).toBe(n)
  }, 60_000)

  it('a digit pressed in the controls window loads a look, and one pressed in the main window too', async () => {
    const popup = await undock(() => page.keyboard.press('u'))
    expect(await title(popup)).toBe(t1.name)
    await popup.keyboard.press('2')
    await pause()
    expect(await title(popup)).toBe(LOOKS[1].name)
    await page.bringToFront()
    await page.keyboard.press('3')
    await pause()
    expect(await title(popup)).toBe(LOOKS[2].name)
  }, 60_000)

  it("typing in the look's name in the controls window loads no look", async () => {
    const popup = await undock(() => page.keyboard.press('u'))
    await popup.click('.look-title')
    await popup.keyboard.press('End')
    await popup.keyboard.type(' 5')
    await pause()
    expect(await title(popup)).toBe(`${t1.name} 5`)
  }, 60_000)

  it('a knob in the controls window turns by the wheel', async () => {
    const popup = await undock(() => page.keyboard.press('u'))
    const f = await arcOf(popup, TURN)
    const { x, y } = await popup.$eval(knob(TURN), (el) => {
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
    await popup.mouse.click(x, y)
    await pause()
    await popup.mouse.move(x, y)
    await notches(popup, 3)
    expect(await settle(popup, TURN, f + 3 * STEP)).toBeCloseTo(f + 3 * STEP, 6)
    // and over the copy of the picture, the knob Tab is on, from a click there
    await popup.mouse.click(OPEN.x, OPEN.y)
    for (let i = 0; i < 20 && (await on(popup)) !== TURN; i++) await popup.keyboard.press('Tab')
    expect(await on(popup)).toBe(TURN)
    expect(await popup.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className, OPEN)).toBe('picture')
    await popup.mouse.move(OPEN.x, OPEN.y)
    await notches(popup, 3)
    expect(await settle(popup, TURN, f + 6 * STEP)).toBeCloseTo(f + 6 * STEP, 6)
  }, 60_000)

  it('Tab walks the live knobs in the controls window, and Enter types there', async () => {
    const popup = await undock(() => page.keyboard.press('u'))
    const walked: string[] = []
    for (let i = 0; i < 9; i++) {
      await popup.keyboard.press('Tab')
      walked.push(await on(popup))
    }
    expect(walked).toEqual([...STRIP, STRIP[0]])
    for (let i = 0; i < STRIP.indexOf(TURN); i++) await popup.keyboard.press('Tab')
    expect(await on(popup)).toBe(TURN)
    await popup.keyboard.press('Enter')
    await popup.waitForSelector('.knob-type')
    expect(
      await popup.evaluate(() => {
        const input = document.querySelector<HTMLInputElement>('.knob-type')!
        return {
          text: input.value,
          selected: document.activeElement === input && input.selectionEnd === input.value.length,
          hint: document.querySelector('.type-hint')?.textContent,
        }
      }),
    ).toEqual({ text: '0', selected: true, hint: 'Enter sets · Esc · Tab next · -360° to 360°' })
    await popup.keyboard.type('45')
    await popup.keyboard.press('Enter')
    await pause()
    expect(await popup.$('.knob-type')).toBe(null)
    expect(await arcOf(popup, TURN)).toBeCloseTo(405 / 720, 6)
    expect(await on(popup)).toBe(TURN)
  }, 60_000)

  it('the monitor copies the picture', async () => {
    const popup = await undock(() => page.keyboard.press('u'))
    // paused, so the picture holds still between the two reads
    await popup.keyboard.press(' ')
    await pause(500)
    // the mean colour of each window's picture, drawn into a canvas of its own
    const mean = (p: Page) =>
      p.evaluate(() => {
        const c = document.createElement('canvas')
        c.width = 64
        c.height = 40
        const g = c.getContext('2d')!
        g.drawImage(document.querySelector<HTMLCanvasElement>('.app > canvas.picture')!, 0, 0, 64, 40)
        const px = g.getImageData(0, 0, 64, 40).data
        const sum = [0, 0, 0]
        for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += px[i + k]
        return sum.map((s) => s / (px.length / 4))
      })
    const [shown, copied] = [await mean(page), await mean(popup)]
    expect(Math.max(...shown)).toBeGreaterThan(10)
    for (let k = 0; k < 3; k++) expect(Math.abs(copied[k] - shown[k])).toBeLessThan(6)
    // H hides the UI over it, and leaves it showing
    await popup.keyboard.press('h')
    expect(
      await popup.evaluate(() => ({
        monitor: document.querySelector('.app > canvas.picture')!.checkVisibility(),
        bar: document.querySelector('.bar')!.checkVisibility(),
      })),
    ).toEqual({ monitor: true, bar: false })
  }, 60_000)

  it('closing the controls window docks the UI back', async () => {
    await page.$eval('.picture', (el) => ((el as HTMLElement).dataset.kept = ''))
    const popup = await undock(() => page.keyboard.press('u'))
    await popup.close()
    await page.waitForSelector('.knob')
    expect(await page.$eval(UNDOCK, (el) => el.textContent)).toBe('⇱ undock')
    expect(await showing()).toContain('bar panel')
    // the picture is the one it was, never rebuilt
    expect(await page.$$eval('.app > .picture', (els) => els.map((el) => (el as HTMLElement).dataset.kept))).toEqual([
      '',
    ])
    expect(await title(page)).toBe(t1.name)
  }, 60_000)

  it('leaving the Stage docks the UI back', async () => {
    const n = await pages()
    // the controls window gone, as it closes after the view opens here
    const gone = async () => {
      for (const end = Date.now() + 5000; Date.now() < end && (await pages()) > n;) await pause(50)
      return pages()
    }
    // the key down alone, as the window closes on it before the key comes up
    let popup = await undock(() => page.keyboard.press('u'))
    await popup.keyboard.down('e')
    await page.waitForSelector('.app.edit .knob')
    expect(await gone()).toBe(n)
    // a view button
    await page.keyboard.press('e')
    await page.waitForSelector('.app.stage .knob')
    popup = await undock(() => page.keyboard.press('u'))
    await popup.click('.bar .seg button[title^="A and B"]')
    await page.waitForSelector('.app.decks .knob')
    expect(await gone()).toBe(n)
    // and F, Play opening here without full screen, as the gesture was the controls window's
    await page.keyboard.press('d')
    await page.waitForSelector('.app.stage .knob')
    popup = await undock(() => page.keyboard.press('u'))
    await popup.keyboard.down('f')
    await page.waitForSelector('.app.play .playbar')
    expect(await gone()).toBe(n)
    expect(await page.evaluate(() => document.fullscreenElement)).toBe(null)
  }, 60_000)
})
