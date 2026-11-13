// The keys on the knobs, the app itself in headless Chrome at 1280x800, on Tapestry 1: Tab and Shift-Tab walk the
// live knobs on screen, the Perform strip first, round from the last to the first, past the idle and dead ones; a
// knob turned joins the walk until a look is loaded. Enter or a double-click types a knob's value in a field of its
// own: Enter sets it inside the hard range, Esc or a click away leaves it, Tab sets it and walks on, and digits typed
// there load no look. H hides the UI, in Direct too, and Tab no longer does.
import { execFileSync } from 'node:child_process'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { LOOKS } from './looks'
import { hardRange, KINDS, kindOf, knobsOf, liveKnob, strip } from './scene'

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
  await page.goto(server.resolvedUrls!.local[0])
  await page.waitForSelector('.knob', { timeout: 55_000 })
}, 60_000)

const t1 = LOOKS[0]
const TURN = 'levels[sq1].affine.turn'
// a spot on Stage's picture that no panel covers
const OPEN = { x: 640, y: 300 }
// the first page of the first level's strip, by knob address or macro id
const STRIP = strip(t1, 'sq1')
  .slice(0, 8)
  .map((t) => ('knob' in t ? t.knob : t.macro))
const pause = (ms = 200) => new Promise((r) => setTimeout(r, ms))

// the knob or macro the browser's focus is on
const on = () =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement
    return el.dataset.knob ?? el.dataset.macro ?? el.tagName
  })
// the knobs and macros n presses of key reach, one after another
async function walk(n: number, key: 'Tab' | 'Shift-Tab' = 'Tab') {
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    if (key === 'Tab') await page.keyboard.press('Tab')
    else {
      await page.keyboard.down('Shift')
      await page.keyboard.press('Tab')
      await page.keyboard.up('Shift')
    }
    out.push(await on())
  }
  return out
}
// the knobs on screen in the page's order: each one's address, and whether it is a stop of the walk
const shown = () =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.knob[data-knob]')]
      .filter((el) => el.checkVisibility())
      .map((el) => ({ at: el.dataset.knob!, stop: el.dataset.tab !== undefined })),
  )
const knob = (address: string) => `.knob[data-knob="${address}"]`
const KNOB = Object.fromEntries(knobsOf(t1).map((k) => [k.address, k]))
// the value the knob or macro is set to (its text shows where it plays, a glide on the way there), from its arc
const valueOf = (address: string) =>
  page
    .$eval(address in KNOB ? knob(address) : `.knob[data-macro="${address}"]`, (el) => {
      const d = el.querySelector('path.value')!.getAttribute('d')!
      const [x, y] = d.split(' ').slice(-2).map(Number)
      return d ? ((Math.atan2(x - 22, 22 - y) * 180) / Math.PI + 135) / 270 : 0
    })
    .then((f) => {
      const [lo, hi] = address in KNOB ? hardRange(address) : [0, 1]
      return Number((lo + f * (hi - lo)).toFixed(6))
    })
const centre = (selector: string) =>
  page.$eval(selector, (el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
// the field typing a value, if one is open: its text, whether it holds the browser's focus with its text selected, the
// knob or macro it types, and its hint
const field = () =>
  page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('.knob-type')
    if (!input) return null
    const el = input.closest<HTMLElement>('.knob')!
    return {
      text: input.value,
      selected:
        document.activeElement === input && input.selectionStart === 0 && input.selectionEnd === input.value.length,
      of: el.dataset.knob ?? el.dataset.macro,
      hint: document.querySelector('.type-hint')?.textContent,
    }
  })
// the field opened on a knob by a click on it and Enter
async function typeOn(address: string) {
  const { x, y } = await centre(knob(address))
  await page.mouse.click(x, y)
  await page.keyboard.press('Enter')
  await page.waitForSelector('.knob-type')
}
// the context panel opened on the picked chip's every knob, beside the strip, by more ▸, the walk starting afresh
const toMore = async () => {
  await page.click('.perform-side button[title="every knob of the picked chip"]')
  await page.waitForSelector('.context .group')
  await page.evaluate(() => (document.activeElement as HTMLElement).blur())
}
// each knob once, at its first place: one on the strip and in the context panel is the strip's
const once = (addresses: string[]) => [...new Set(addresses)]

describe('Tab', () => {
  it('Tab walks the strip first, then the live knobs on screen, and Shift-Tab walks back', async () => {
    expect(await walk(STRIP.length)).toEqual(STRIP)
    // its first knob opened the context panel on the chip's every knob: the strip's, then the panel's live ones on
    // screen, in the page's order, each a stop once
    const live = new Set(
      knobsOf(t1)
        .filter((at) => liveKnob(t1, at, strip(t1, 'sq1'), new Set()))
        .map((at) => at.address),
    )
    const stops = once((await shown()).filter((k) => live.has(k.at)).map((k) => k.at))
    // the strip's later pages among them
    expect(stops.filter((a) => !STRIP.includes(a)).length).toBeGreaterThan(0)
    expect(once((await shown()).filter((k) => k.stop).map((k) => k.at))).toEqual(stops)
    const round = once([...STRIP, ...stops])
    expect(await walk(round.length - STRIP.length + 1)).toEqual([...round.slice(STRIP.length), round[0]])
    expect(await walk(2, 'Shift-Tab')).toEqual([round[round.length - 1], round[round.length - 2]])
    // a scene knob takes the app's focus with it, as a click does
    expect(await page.$eval(knob(round[round.length - 2]), (el) => el.classList.contains('focused'))).toBe(true)
  }, 60_000)

  it('Tab skips idle and dead knobs, and a knob turned joins the walk until a look is loaded', async () => {
    await toMore()
    // every row opened, its folded knobs shown, the dead ones with them
    for (const fold of await page.$$('.stage .row .fold')) await fold.click()
    const dead = knobsOf(t1)
      .filter((at) => {
        const kind = KINDS[kindOf(at.address)]
        return kind.shows && !kind.shows(t1, at)
      })
      .map((at) => at.address)
    const all = await shown()
    const idle = once(all.filter((k) => !k.stop).map((k) => k.at))
    expect(idle).toContain('levels[sq1].variants[0].share')
    expect(idle.some((a) => !dead.includes(a))).toBe(true)
    const stops = once([...STRIP, ...all.filter((k) => k.stop).map((k) => k.at)])
    expect(await walk(stops.length)).toEqual(stops)
    // a wheel notch on an idle knob, not a dead one, makes it a stop
    const turned = idle.find((a) => !dead.includes(a))!
    // scrolled into the context panel's view
    await page.$eval(knob(turned), (el) => el.scrollIntoView({ block: 'center' }))
    const { x, y } = await centre(knob(turned))
    await page.mouse.move(x, y)
    await page.mouse.wheel({ deltaY: -100 })
    await pause()
    const joined = once([...STRIP, ...(await shown()).filter((k) => k.stop).map((k) => k.at)])
    expect(joined).toContain(turned)
    await page.evaluate(() => (document.activeElement as HTMLElement).blur())
    expect(await walk(joined.length)).toEqual(joined)
    // until the look is loaded again
    await page.keyboard.press('1')
    await pause()
    expect((await shown()).filter((k) => k.stop).map((k) => k.at)).not.toContain(turned)
  }, 60_000)
})

describe('a typed value', () => {
  it("Enter types the focused knob's value and Enter sets it", async () => {
    await typeOn(TURN)
    expect(await field()).toEqual({
      text: '0',
      selected: true,
      of: TURN,
      hint: 'Enter sets · Esc · Tab next · -360° to 360°',
    })
    await page.keyboard.type('45')
    await page.keyboard.press('Enter')
    await pause()
    expect(await field()).toBe(null)
    expect(await valueOf(TURN)).toBe(45)
    // the knob keeps the browser's focus, and a trailing ° is allowed
    expect(await on()).toBe(TURN)
    await page.keyboard.press('Enter')
    await page.keyboard.type('90°')
    await page.keyboard.press('Enter')
    await pause()
    expect(await valueOf(TURN)).toBe(90)
    // and on the strip's macro Tab is on, from a click on the picture
    await page.mouse.click(OPEN.x, OPEN.y)
    expect(await walk(1)).toEqual([STRIP[0]])
    await page.keyboard.press('Enter')
    expect(await field()).toMatchObject({ of: STRIP[0], selected: true, hint: 'Enter sets · Esc · Tab next · 0 to 1' })
    await page.keyboard.type('0.5')
    await page.keyboard.press('Enter')
    await pause()
    expect(await valueOf(STRIP[0])).toBe(0.5)
  }, 60_000)

  it('Esc cancels a typed value, and so does a click away', async () => {
    const before = await valueOf(TURN)
    await typeOn(TURN)
    await page.keyboard.type('12')
    await page.keyboard.press('Escape')
    await pause()
    expect(await field()).toBe(null)
    expect(await valueOf(TURN)).toBe(before)
    // the Esc was the field's: the knob keeps the app's focus
    expect(await page.$eval(knob(TURN), (el) => el.classList.contains('focused'))).toBe(true)
    await typeOn(TURN)
    await page.keyboard.type('12')
    await page.mouse.click(OPEN.x, OPEN.y)
    await pause()
    expect(await field()).toBe(null)
    expect(await valueOf(TURN)).toBe(before)
    // and a field that is not a number sets nothing, and closes
    await typeOn(TURN)
    await page.keyboard.type('abc')
    await page.keyboard.press('Enter')
    await pause()
    expect(await field()).toBe(null)
    expect(await valueOf(TURN)).toBe(before)
  }, 60_000)

  it('Tab sets a typed value and moves to the next live knob', async () => {
    const at = STRIP.indexOf(TURN)
    expect(await walk(at + 1)).toEqual(STRIP.slice(0, at + 1))
    await page.keyboard.press('Enter')
    await page.keyboard.type('30')
    await page.keyboard.press('Tab')
    await pause()
    expect(await field()).toBe(null)
    expect(await valueOf(TURN)).toBe(30)
    expect(await on()).toBe(STRIP[at + 1])
    // and Shift-Tab sets it and moves to the one before
    await page.keyboard.press('Enter')
    await page.keyboard.type('0.5')
    await page.keyboard.down('Shift')
    await page.keyboard.press('Tab')
    await page.keyboard.up('Shift')
    await pause()
    expect(await valueOf(STRIP[at + 1])).toBe(0.5)
    expect(await on()).toBe(TURN)
  }, 60_000)

  it('a double-click types', async () => {
    const { x, y } = await centre(knob(TURN))
    await page.mouse.click(x, y, { clickCount: 2 })
    expect(await field()).toMatchObject({ of: TURN, selected: true })
    await page.keyboard.press('Escape')
    const macro = await centre(`.knob[data-macro="${STRIP[1]}"]`)
    await page.mouse.click(macro.x, macro.y, { clickCount: 2 })
    expect(await field()).toMatchObject({ of: STRIP[1], selected: true })
  }, 60_000)

  it('a typed value past the hard range lands at its end', async () => {
    await typeOn(TURN)
    await page.keyboard.type('9999')
    await page.keyboard.press('Enter')
    await pause()
    expect(await valueOf(TURN)).toBe(360)
    await page.keyboard.press('Enter')
    await page.keyboard.type('-9999')
    await page.keyboard.press('Enter')
    await pause()
    expect(await valueOf(TURN)).toBe(-360)
  }, 60_000)

  it('digits typed in the field load no look, and outside it still load one', async () => {
    const title = () => page.$eval('.look-title', (el) => (el as HTMLInputElement).value)
    expect(await title()).toBe(t1.name)
    await typeOn(TURN)
    await page.keyboard.type('3')
    await pause()
    expect(await title()).toBe(t1.name)
    await page.keyboard.press('Escape')
    await page.keyboard.press('3')
    await pause()
    expect(await title()).toBe(LOOKS[2].name)
  }, 60_000)
})

describe('H', () => {
  it('H hides the UI and shows it again, and Tab does not', async () => {
    const hidden = () => page.$eval('.app', (el) => el.classList.contains('hidden'))
    const hints = () => page.$eval('.keys', (el) => el.textContent)
    // the keys, behind ?
    await page.click('.bar .help')
    expect(await hints()).toMatch(/^H hides · Tab live knobs · Enter types · /)
    await page.keyboard.press('h')
    expect(await hidden()).toBe(true)
    await page.keyboard.press('h')
    expect(await hidden()).toBe(false)
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    expect(await hidden()).toBe(false)
    // in Direct too
    await page.keyboard.press('t')
    await page.waitForSelector('.app.direct')
    expect(await hints()).toMatch(/^H hides · /)
    await page.keyboard.press('Tab')
    expect(await hidden()).toBe(false)
    await page.keyboard.press('H')
    expect(await hidden()).toBe(true)
    await page.keyboard.press('h')
    expect(await hidden()).toBe(false)
  }, 60_000)
})
