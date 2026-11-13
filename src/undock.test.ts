// Undocking, the app itself in headless Chrome at 1280x800, on Tapestry 1: U or ⇱ undock opens the controls window,
// the UI in it over a copy of the picture, and the main window keeps the picture alone; open, either brings the
// window to the front. The keys, Tab, Enter and the wheel work in the controls window, a text field there keeps its
// keys, and keys pressed in the main window still reach the app. Edit, Decks and Direct undock the same way, each
// view's copy of the picture in its picture's place and whole in its own shape, the main window's picture whole,
// Direct's framed; moving among them keeps the UI undocked, and Direct's panel moves without a remount. Closing the
// controls window docks the UI back in its view, the picture never rebuilt, and Play docks it back.
import { execFileSync } from 'node:child_process'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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

// a timeline a case seeded, or edited in Direct, is not the next case's
afterEach(() => page.evaluate(() => localStorage.removeItem('bermuda.timeline')))

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

// the controls window, caught as the press opens it, at 1280x800 with its knobs (or what is named) drawn
async function undock(press: () => Promise<unknown>, ready = '.knob') {
  const before = new Set(browser.targets())
  await press()
  const target = await browser.waitForTarget((t) => !before.has(t) && t.type() === 'page', { timeout: 10_000 })
  const popup = (await target.page())!
  await popup.setViewport({ width: 1280, height: 800 })
  await popup.waitForSelector(ready)
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
// each view's key in the main window, its class, and what its panels show once drawn
const VIEWS = [
  { key: 'e', view: 'edit', ready: '.rack .knob' },
  { key: 'd', view: 'decks', ready: '.deck canvas' },
  { key: 't', view: 'direct', ready: '.direct-panel' },
] as const
// a timeline of three keys over no song, 17 s long with the 10 s past its last key
const TIMELINE = {
  song: 'tone.wav',
  bpm: 96,
  keys: [0, 4, 7].map((at, i) => ({
    at,
    scene: LOOKS[[0, 3, 6][i]].name,
    edge: { seconds: i ? 2 : 0, stagger: 0.4, deepFirst: false },
  })),
  curves: [],
}
// Direct, on the timeline seeded at load
async function direct() {
  await page.evaluate((t) => localStorage.setItem('bermuda.timeline', JSON.stringify(t)), TIMELINE)
  await page.reload()
  await page.waitForSelector('.knob', { timeout: 55_000 })
  await page.keyboard.press('t')
  await page.waitForSelector('.direct-panel .key')
}
// a box on screen, in whole pixels
const rect = (p: Page, selector: string) =>
  p.$eval(selector, (el) => {
    const r = el.getBoundingClientRect()
    return [r.x, r.y, r.width, r.height].map(Math.round)
  })
const PICTURE = '.app > canvas.picture'
// the mean colour of a window's picture, or of a box of its pixels, drawn into a canvas of its own
const meanOf = (p: Page, box?: number[]) =>
  p.evaluate((box) => {
    const src = document.querySelector<HTMLCanvasElement>('.app > canvas.picture')!
    const [x, y, w, h] = box ?? [0, 0, src.width, src.height]
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 40
    const g = c.getContext('2d')!
    g.drawImage(src, x, y, w, h, 0, 0, 64, 40)
    const px = g.getImageData(0, 0, 64, 40).data
    const sum = [0, 0, 0]
    for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += px[i + k]
    return sum.map((s) => s / (px.length / 4))
  }, box)
// each deck's preview: its width and its pixels' red, green and blue
const previews = (p: Page) =>
  p.$$eval('.deck canvas', (els) =>
    (els as HTMLCanvasElement[]).map((c) => ({
      width: c.width,
      px: [...c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data].filter((_, i) => i % 4 < 3),
    })),
  )
// the controls window gone, once it closes
async function gone(n: number) {
  for (const end = Date.now() + 5000; Date.now() < end && (await pages()) > n;) await pause(50)
  return pages()
}

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
    }))
    expect(stage).toMatchObject({ app: 'app stage', monitor: 1280, bar: 'absolute', margin: '0px' })
    expect(stage.button).toBe('⇲ docked out')
    // the keys, behind ?
    await popup.click('.bar .help')
    expect(await popup.$eval('.keys', (el) => el.textContent)).toContain('F play · U undock · O autopilot')
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
    // the strip, then the knobs of the context panel the first stop opened
    expect(walked.slice(0, 8)).toEqual(STRIP)
    expect(await popup.$eval('.context', (c) => c.contains(document.activeElement))).toBe(true)
    await popup.keyboard.down('Shift')
    for (let i = 0; i < STRIP.length - STRIP.indexOf(TURN); i++) await popup.keyboard.press('Tab')
    await popup.keyboard.up('Shift')
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

  it('Edit undocks: the Rack in the controls window over the monitor, and the whole picture alone in the main window', async () => {
    await page.keyboard.press('e')
    await page.waitForSelector('.app.edit .rack .knob')
    const docked = await rect(page, PICTURE)
    const popup = await undock(() => page.keyboard.press('u'))
    expect(await popup.$eval('body > .app', (el) => el.className)).toBe('app edit')
    expect(await popup.$eval('.rack', (el) => el.checkVisibility())).toBe(true)
    // the monitor where the picture sits docked, left of the Rack
    expect(await rect(popup, PICTURE)).toEqual(docked)
    expect(docked[2]).toBeLessThan(1280 - 540)
    expect(await page.$eval('.app', (el) => el.className)).toBe('app')
    expect(await showing()).toEqual(['picture'])
    expect(await rect(page, PICTURE)).toEqual([0, 0, 1280, 800])
  }, 60_000)

  it("Decks undocks: both decks and their previews in the controls window over the mix's monitor, and the mix alone and whole in the main window", async () => {
    await page.keyboard.press('d')
    await page.waitForSelector('.app.decks .deck canvas')
    // paused, so the decks hold still between the reads, and drawn at their size
    await page.keyboard.press(' ')
    await page.waitForFunction(() =>
      [...document.querySelectorAll('canvas')].every((c) => c.width === Math.round(c.clientWidth * devicePixelRatio)),
    )
    await pause(500)
    const docked = await rect(page, PICTURE)
    const before = await previews(page)
    expect(Math.max(...before.flatMap((p) => p.px))).toBeGreaterThan(10)
    const popup = await undock(() => page.keyboard.press('u'), '.deck canvas')
    expect(await popup.$eval('body > .app', (el) => el.className)).toBe('app decks')
    // the mix's monitor between the two columns, where the mix sits docked
    expect(await rect(popup, PICTURE)).toEqual(docked)
    const [a, b] = [await rect(popup, '.deck-column.a'), await rect(popup, '.deck-column.b')]
    expect(a[0] + a[2]).toBeLessThan(docked[0])
    expect(b[0]).toBeGreaterThan(docked[0] + docked[2])
    // each deck's preview drawn there as it was docked
    await pause(1000)
    const after = await previews(popup)
    expect(after.map((p) => p.width)).toEqual(before.map((p) => p.width))
    for (const [i, { px }] of after.entries())
      expect(Math.max(...px.map((v, j) => Math.abs(v - before[i].px[j])))).toBeLessThan(8)
    expect(await page.$$('.deck')).toEqual([])
    expect(await showing()).toEqual(['picture'])
    expect(await rect(page, PICTURE)).toEqual([0, 0, 1280, 800])
  }, 60_000)

  it('Direct undocks: the timeline in the controls window over the framed monitor, and the framed picture alone in the main window', async () => {
    await direct()
    const docked = await rect(page, PICTURE)
    const popup = await undock(() => page.keyboard.press('u'), '.direct-panel .key')
    expect(await popup.$eval('body > .app', (el) => el.className)).toBe('app direct')
    expect(await popup.$$eval('.direct-panel .key', (els) => els.length)).toBe(3)
    expect(await popup.$eval('.direct-panel', (el) => el.checkVisibility())).toBe(true)
    // the monitor framed where the framed picture sits docked, and the timeline's frame copied to it
    expect(await popup.$eval(PICTURE, (el) => el.className)).toBe('picture framed')
    expect(await rect(popup, PICTURE)).toEqual(docked)
    await pause(1000)
    const [shown, copied] = [await meanOf(page), await meanOf(popup)]
    expect(Math.max(...shown)).toBeGreaterThan(3)
    for (let c = 0; c < 3; c++) expect(Math.abs(copied[c] - shown[c])).toBeLessThan(6)
    // the main window: the framed picture alone, 16:9 as large as fits and centred
    expect(await page.$$('.direct-panel')).toEqual([])
    expect(await showing()).toEqual(['picture framed'])
    expect(await rect(page, PICTURE)).toEqual([0, 40, 1280, 720])
  }, 60_000)

  it('⇱ undock and U undock Edit, Decks and Direct too', async () => {
    const n = await pages()
    for (const { key, view, ready } of VIEWS) {
      await page.bringToFront()
      await page.keyboard.press(key)
      await page.waitForSelector(`.app.${view} ${ready}`)
      expect(await page.$eval(UNDOCK, (el) => [el.textContent, el.checkVisibility()])).toEqual(['⇱ undock', true])
      if (view === 'direct') {
        await page.click('.bar .help')
        expect(await page.$eval('.keys', (el) => el.textContent)).toContain('U undock')
        await page.click('.bar .help')
      }
      // not with Ctrl held
      await page.keyboard.down('Control')
      await page.keyboard.press('u')
      await page.keyboard.up('Control')
      await pause()
      expect(await pages()).toBe(n)
      for (const press of [() => page.keyboard.press('U'), () => page.click(UNDOCK)]) {
        await page.bringToFront()
        const popup = await undock(press, ready)
        expect(await popup.$eval('body > .app', (el) => el.className)).toBe(`app ${view}`)
        expect(await popup.$eval(UNDOCK, (el) => [el.textContent, el.checkVisibility()])).toEqual([
          '⇲ docked out',
          true,
        ])
        await popup.close()
        await page.waitForSelector(`.app.${view} ${ready}`)
        expect(await gone(n)).toBe(n)
      }
      await page.keyboard.press(key)
      await page.waitForSelector('.app.stage .knob')
    }
    // moving among the views keeps the UI undocked, each view opening in the controls window
    const popup = await undock(() => page.keyboard.press('u'))
    for (const { key, view, ready } of VIEWS) {
      await popup.keyboard.press(key)
      await popup.waitForSelector(`body > .app.${view} ${ready}`)
      expect(await page.$eval('.app', (el) => el.className)).toBe('app')
      await popup.keyboard.press(view === 'direct' ? 'Escape' : key)
      await popup.waitForSelector('body > .app.stage .knob')
    }
    await popup.click('.bar .seg button[title^="A and B"]')
    await popup.waitForSelector('body > .app.decks .deck canvas')
    expect(await pages()).toBe(n + 1)
  }, 120_000)

  it('the monitor shows the whole picture in its own shape', async () => {
    await page.keyboard.press('e')
    await page.waitForSelector('.app.edit .rack .knob')
    const popup = await undock(() => page.keyboard.press('u'))
    // paused, so the picture holds still between the reads
    await popup.keyboard.press(' ')
    await pause(500)
    const size = (p: Page) =>
      p.$eval(PICTURE, (el) => [(el as HTMLCanvasElement).width, (el as HTMLCanvasElement).height])
    const [[ew, eh], [mw, mh]] = [await size(page), await size(popup)]
    // the picture's shape as large as fits, centred: beside the Rack the monitor is the taller, so its bands are
    // above and below
    const k = Math.min(mw / ew, mh / eh)
    const [w, h] = [ew * k, eh * k]
    const [x, y] = [(mw - w) / 2, (mh - h) / 2]
    expect(y).toBeGreaterThan(50)
    // cleared outside it, from a pixel off its edge
    const bands = [
      [0, 0, mw, Math.floor(y) - 1],
      [0, Math.ceil(y + h) + 1, mw, mh - Math.ceil(y + h) - 1],
      [0, 0, Math.floor(x) - 1, mh],
      [Math.ceil(x + w) + 1, 0, mw - Math.ceil(x + w) - 1, mh],
    ].filter(([, , bw, bh]) => bw > 0 && bh > 0)
    const alpha = await popup.$eval(
      PICTURE,
      (el, bands) => {
        const g = (el as HTMLCanvasElement).getContext('2d')!
        let most = 0
        for (const [bx, by, bw, bh] of bands) {
          const px = g.getImageData(bx, by, bw, bh).data
          for (let i = 3; i < px.length; i += 4) most = Math.max(most, px[i])
        }
        return most
      },
      bands,
    )
    expect(alpha).toBe(0)
    // and inside it, the main window's picture
    const [shown, copied] = [await meanOf(page), await meanOf(popup, [x + 2, y + 2, w - 4, h - 4])]
    expect(Math.max(...shown)).toBeGreaterThan(3)
    for (let c = 0; c < 3; c++) expect(Math.abs(copied[c] - shown[c])).toBeLessThan(6)
  }, 60_000)

  it("Direct's zoom, loop and picked key hold through undocking and docking back", async () => {
    await direct()
    await page.$eval('.direct-panel', (el) => ((el as HTMLElement).dataset.kept = ''))
    // the last key picked, a lane opened, the tracks zoomed in by the wheel and a loop shift-dragged on the ruler
    await (await page.$$('.keys-track .key'))[2].click()
    const lanes = 'select[title^="a lane"]'
    const lane = await page.$eval(`${lanes} option:nth-child(2)`, (el) => (el as HTMLOptionElement).value)
    await page.select(lanes, lane)
    const [rx, ry, rw, rh] = await rect(page, '.ruler')
    await page.mouse.move(rx + rw / 2, ry + rh / 2)
    await page.mouse.wheel({ deltaY: -300 })
    await pause()
    await page.keyboard.down('Shift')
    await page.mouse.move(rx + rw * 0.3, ry + rh / 2)
    await page.mouse.down()
    await page.mouse.move(rx + rw * 0.45, ry + rh / 2, { steps: 4 })
    await page.mouse.up()
    await page.keyboard.up('Shift')
    await pause()
    const state = (p: Page) =>
      p.$eval('.direct-panel', (panel) => {
        const keys = [...panel.querySelectorAll<HTMLElement>('.keys-track .key')]
        return {
          kept: (panel as HTMLElement).dataset.kept,
          at: keys.map((k) => k.style.left),
          picked: keys.findIndex((k) => k.matches('.picked')),
          lanes: [...panel.querySelectorAll('.curve-name')].map((el) => el.getAttribute('title')),
          loop: panel.querySelector('.direct-row .check')!.textContent,
          looping: panel.querySelector<HTMLInputElement>('.direct-row .check input')!.checked,
        }
      })
    const before = await state(page)
    expect(before).toMatchObject({ kept: '', picked: 2, lanes: [lane], looping: true })
    expect(before.at[0]).not.toBe('0%')
    expect(before.loop).not.toContain('shift-drag')
    const popup = await undock(() => page.keyboard.press('u'), '.direct-panel .key')
    expect(await state(popup)).toEqual(before)
    await popup.close()
    await page.waitForSelector('.app.direct .direct-panel .key')
    expect(await state(page)).toEqual(before)
  }, 60_000)

  it('Space and Home in the controls window reach Direct, and its text fields keep their keys', async () => {
    await direct()
    const popup = await undock(() => page.keyboard.press('u'), '.direct-panel .key')
    const clock = () => popup.$eval('.direct-panel .time > span:first-child', (el) => el.textContent)
    // Space, with no song picked, asks for it
    await popup.keyboard.press(' ')
    await popup.waitForSelector('.error')
    expect(await popup.$eval('.error', (el) => el.textContent)).toContain('pick the song (tone.wav) to play')
    await popup.click('.error')
    // Home rewinds from where the ruler was clicked
    const [rx, ry, rw, rh] = await rect(popup, '.ruler')
    await popup.mouse.click(rx + rw / 2, ry + rh / 2)
    await pause()
    expect(await clock()).not.toBe('0:00.00')
    await popup.keyboard.press('Home')
    await pause()
    expect(await clock()).toBe('0:00.00')
    // a field keeps what is typed in it, Home and Space too, the song neither rewound nor asked for
    await popup.mouse.click(rx + rw / 2, ry + rh / 2)
    const field = '.direct-panel label[title^="seconds the edge"] input'
    await popup.click(field, { count: 3 })
    await popup.keyboard.type('1.5')
    await popup.keyboard.press('Home')
    await popup.keyboard.type('2')
    await popup.keyboard.press(' ')
    await pause()
    expect(await popup.$eval(field, (el) => (el as HTMLInputElement).value)).toBe('21.5')
    expect(await clock()).not.toBe('0:00.00')
    expect(await popup.$('.error')).toBe(null)
    // and Space on a checkbox ticks it, playing nothing
    await popup.keyboard.down('Shift')
    await popup.mouse.move(rx + rw * 0.2, ry + rh / 2)
    await popup.mouse.down()
    await popup.mouse.move(rx + rw * 0.4, ry + rh / 2, { steps: 4 })
    await popup.mouse.up()
    await popup.keyboard.up('Shift')
    await pause()
    const box = '.direct-row .check input'
    await popup.click(box)
    expect(await popup.$eval(box, (el) => (el as HTMLInputElement).checked)).toBe(false)
    await popup.keyboard.press(' ')
    await pause()
    expect(await popup.$eval(box, (el) => (el as HTMLInputElement).checked)).toBe(true)
    expect(await popup.$('.error')).toBe(null)
  }, 60_000)

  it('closing the controls window docks Edit, Decks or Direct back in its view', async () => {
    const n = await pages()
    for (const { key, view, ready } of VIEWS) {
      await page.bringToFront()
      await page.keyboard.press(key)
      await page.waitForSelector(`.app.${view} ${ready}`)
      const docked = await rect(page, PICTURE)
      const popup = await undock(() => page.keyboard.press('u'), ready)
      await popup.close()
      await page.waitForSelector(`.app.${view} ${ready}`)
      expect(await gone(n)).toBe(n)
      expect(await page.$eval('.app', (el) => el.className)).toBe(`app ${view}`)
      expect(await page.$eval(ready, (el) => el.checkVisibility())).toBe(true)
      expect(await rect(page, PICTURE)).toEqual(docked)
      expect(await page.$eval(UNDOCK, (el) => el.textContent)).toBe('⇱ undock')
      await page.keyboard.press(key)
      await page.waitForSelector('.app.stage .knob')
    }
  }, 120_000)

  it('Play docks the UI back', async () => {
    const n = await pages()
    // the Play button, from Edit undocked
    await page.keyboard.press('e')
    await page.waitForSelector('.app.edit .rack .knob')
    let popup = await undock(() => page.keyboard.press('u'))
    await popup.click('.bar .seg button[title^="the picture alone"]')
    await page.waitForSelector('.app.play .playbar')
    expect(await gone(n)).toBe(n)
    // and F, Play opening here without full screen, as the gesture was the controls window's: the key down alone, as
    // the window closes on it before the key comes up
    await page.keyboard.press('Escape')
    await page.waitForSelector('.app.stage .knob')
    popup = await undock(() => page.keyboard.press('u'))
    await popup.keyboard.down('f')
    await page.waitForSelector('.app.play .playbar')
    expect(await gone(n)).toBe(n)
    expect(await page.evaluate(() => document.fullscreenElement)).toBe(null)
  }, 60_000)
})
