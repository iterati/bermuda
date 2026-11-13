// MIDI map mode, the app itself in headless Chrome at 1280x800, on Tapestry 1, with a fake controller: ◎ map or M
// outlines every control a controller can drive, tagged with what drives it, and a press on one arms its learn and
// does nothing else; Esc ends it. The knob's and the macros' MIDI learn show only while mapping, and what is
// learning shows under the bar on every view. Direct and Play have no map mode; undocked, it works in the controls
// window.
import { execFileSync } from 'node:child_process'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { LOOKS } from './looks'
import { strip, type Controls, type TriggerTarget } from './scene'

let server: ViteDevServer
let browser: Browser
let page: Page

// what the fake controller puts on the main window: send() delivers a message as a plugged-in controller would, and
// ready() says the app is hearing it
type Fake = { send: (...bytes: number[]) => void; ready: () => boolean }

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
  // a fake MIDI access with one controller, as midi.test.ts's fakeController
  await page.evaluateOnNewDocument(() => {
    type Port = { name: string; state: string; onmidimessage: ((e: { data: Uint8Array; target: Port }) => void) | null }
    const input: Port = { name: 'Fake knobs', state: 'connected', onmidimessage: null }
    const access = {
      inputs: new Map([['fake', input]]),
      outputs: new Map([['fake', { name: 'Fake knobs', state: 'connected', send: () => {} }]]),
      onstatechange: null,
    }
    Object.defineProperty(Navigator.prototype, 'requestMIDIAccess', {
      configurable: true,
      value: () => Promise.resolve(access),
    })
    const fake: Fake = {
      send: (...bytes) => input.onmidimessage?.({ data: new Uint8Array(bytes), target: input }),
      ready: () => !!input.onmidimessage,
    }
    Object.assign(window, { fake })
  })
}, 60_000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

beforeEach(async () => {
  await page.bringToFront()
  await page.goto(server.resolvedUrls!.local[0])
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.waitForSelector('.knob', { timeout: 55_000 })
}, 60_000)

const t1 = LOOKS[0]
// the first page of the strip, on the first level, as the app opens: a knob and a macro of it
const FIRST = strip(t1, t1.levels[0].id).slice(0, 8)
const KNOB = FIRST.flatMap((t) => ('knob' in t ? [t.knob] : []))[0]
const MACRO = FIRST.flatMap((t) => ('macro' in t ? [t.macro] : []))[0]
const KNOB_NAME = KNOB.replace(/^levels/, '')
const MACRO_NAME = t1.macros.find((m) => m.id === MACRO)!.name
const knob = (address: string) => `.knob[data-knob="${address}"]`
const macro = (id: string) => `.knob[data-macro="${id}"]`
const MAP = '.bar .map'
const BANNER = 'MIDI map: click a control, then move a knob or press a button on the controller · Esc ends'
// the captain's rig: the strip on ch1 cc1-8, the A/B fader on cc9 with pickup, and 13 buttons on notes 8-20
const RIG: Controls = {
  buttons: [
    ...Array.from({ length: 8 }, (_, i) => ({ channel: 1, note: 8 + i, slot: i })),
    { channel: 1, note: 16, page: -1 },
    { channel: 1, note: 17, page: 1 },
    { channel: 1, note: 18, mode: 'stage' },
    { channel: 1, note: 19, mode: 'edit' },
    { channel: 1, note: 20, mode: 'decks' },
  ],
  fader: { channel: 1, control: 9, pickup: true },
  strip: Array.from({ length: 8 }, (_, i) => ({ channel: 1, control: 1 + i, index: i })),
}
// what the rig's pads learn, notes 8 to 23, the last three none
const PADS = Array.from({ length: 16 }, (_, i): TriggerTarget | null => {
  const b = RIG.buttons.find((x) => x.note === 8 + i)
  return !b ? null : 'slot' in b ? { slot: b.slot } : 'page' in b ? { page: b.page } : { mode: b.mode }
})

const pause = (ms = 200) => new Promise((r) => setTimeout(r, ms))
async function seed(controls: Controls) {
  await page.evaluate((c) => localStorage.setItem('bermuda.midi', JSON.stringify(c)), controls)
  await page.reload()
  await page.waitForSelector('.knob', { timeout: 55_000 })
}
// whether map mode is on: ◎ map's text and class, and the app's class
const mapState = (p: Page = page) =>
  p.evaluate(() => {
    const b = document.querySelector('.bar .map')
    return { text: b?.textContent, on: b?.classList.contains('on'), mapping: !!document.querySelector('.app.mapping') }
  })
const OFF = { text: '◎ map', on: false, mapping: false }
const ON = { text: '◉ map on', on: true, mapping: true }
// the learning line's text, if it shows
const line = (p: Page = page) =>
  p.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.midi-learning')
    return el?.checkVisibility() ? el.querySelector('span')!.textContent : null
  })
// a CC moved and a note pressed on the controller's channel 1, once the app hears it
async function cc(control: number, value = 64) {
  await page.waitForFunction(() => (window as unknown as { fake: Fake }).fake.ready(), { polling: 100 })
  await page.evaluate((c, v) => (window as unknown as { fake: Fake }).fake.send(0xb0, c, v), control, value)
  await pause()
}
async function note(n: number) {
  await page.waitForFunction(() => (window as unknown as { fake: Fake }).fake.ready(), { polling: 100 })
  await page.evaluate((n) => (window as unknown as { fake: Fake }).fake.send(0x90, n, 100), n)
  await pause()
}
// a button, by where it is and how its text starts, pressed as a hand would
async function press(within: string, text: string, p: Page = page) {
  const all = await p.$$(`${within} button`)
  for (const b of all)
    if (await b.evaluate((el, text) => el.textContent!.startsWith(text) && el.checkVisibility(), text)) return b.click()
  throw new Error(`no ${within} button ${text}`)
}
const tab = (name: string) => press('.tabs', name)
const lookName = (i: number) => `.stage .right ol.looks > li:nth-child(${i + 1}) .look-name`
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('bermuda.midi') ?? '{}') as Controls)
// what the app shows: the view, the strip's page, the fader, the look, a strip knob's value, the focus (the app's
// and the browser's, on nothing) and a typing field
const showing = () =>
  page.evaluate((k) => {
    const app = document.querySelector('.app')!
    return {
      view: ['stage', 'edit', 'decks'].find((v) => app.classList.contains(v)),
      page: document.querySelector('.pager > span')?.textContent,
      fader: document.querySelector('.fader-at')?.textContent,
      look: document.querySelector<HTMLInputElement>('.look-title')!.value,
      value: document.querySelector(`.knob[data-knob="${k}"] .knob-value`)?.textContent,
      focused: document.querySelectorAll('.knob.focused').length,
      blurred: document.activeElement === document.body,
      typing: !!document.querySelector('.knob-type'),
    }
  }, KNOB)

describe('MIDI map mode', () => {
  it('M and ◎ map turn map mode on and off, Esc ends it, and M on a focused knob still learns that knob', async () => {
    expect(await mapState()).toEqual(OFF)
    expect(await page.$eval(MAP, (el) => el.getAttribute('title'))).toBe(
      'MIDI map: every control a controller can drive shows its mapping; click one, move a control (M)',
    )
    // just before ⚙ setup
    expect(await page.$eval(MAP, (el) => el.nextElementSibling!.textContent)).toBe('⚙ setup')
    expect(await line()).toBe(null)
    await page.keyboard.press('m')
    expect(await mapState()).toEqual(ON)
    expect(await line()).toBe(BANNER)
    await page.keyboard.press('M')
    expect(await mapState()).toEqual(OFF)
    expect(await line()).toBe(null)
    await page.click(MAP)
    expect(await mapState()).toEqual(ON)
    await page.click(MAP)
    expect(await mapState()).toEqual(OFF)
    await page.keyboard.press('m')
    await page.keyboard.press('Escape')
    expect(await mapState()).toEqual(OFF)
    // it and the setup sheet open together, and Esc ends both
    await page.keyboard.press('g')
    await page.keyboard.press('m')
    expect(await mapState()).toEqual(ON)
    expect(await page.$('.setup-sheet')).not.toBe(null)
    await page.keyboard.press('Escape')
    expect(await mapState()).toEqual(OFF)
    expect(await page.$('.setup-sheet')).toBe(null)
    // not with Ctrl or Cmd held
    for (const held of ['Control', 'Meta'] as const) {
      await page.keyboard.down(held)
      await page.keyboard.press('m')
      await page.keyboard.up(held)
      expect(await mapState()).toEqual(OFF)
    }
    // Esc while a control learns cancels the learning, and map mode stays on; then Esc ends it
    await page.keyboard.press('m')
    await page.click(knob(KNOB))
    expect(await line()).toBe(`move a control for ${KNOB_NAME}`)
    await page.keyboard.press('Escape')
    expect(await line()).toBe(BANNER)
    expect(await mapState()).toEqual(ON)
    await page.keyboard.press('Escape')
    expect(await mapState()).toEqual(OFF)
    expect(await line()).toBe(null)
    // M on a focused knob learns it at once, map mode left off
    await page.click(knob(KNOB))
    expect(await page.$eval(knob(KNOB), (el) => el.classList.contains('focused'))).toBe(true)
    await page.keyboard.press('m')
    expect(await page.$eval(knob(KNOB), (el) => el.classList.contains('learning'))).toBe(true)
    expect(await line()).toBe(`move a control for ${KNOB_NAME}`)
    expect(await mapState()).toEqual(OFF)
    await cc(30)
    expect(await page.$eval(`${knob(KNOB)} .knob-midi`, (el) => el.textContent)).toBe('cc30')
    expect(await line()).toBe(null)
  }, 60_000)

  it('map mode outlines every mappable control, and tags each with what drives it', async () => {
    await seed(RIG)
    // a knob and a macro of the look mapped
    await page.keyboard.press('m')
    await page.click(knob(KNOB))
    await cc(21)
    await page.click(macro(MACRO))
    await cc(22)
    // each control a controller can drive, by what it learns, whether it is outlined and what its tag reads
    const marked = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-learn]')]
          .filter((el) => el.checkVisibility())
          .map((el) => ({
            learns: el.getAttribute('data-learn'),
            outlined: getComputedStyle(el).outlineStyle === 'dashed',
          })),
      )
    const tags = () =>
      page.$$eval('.map-tag', (els) =>
        els.map((el) => [
          el.parentElement!.getAttribute('data-learn') ?? el.parentElement!.className,
          el.textContent,
          el.getAttribute('title'),
        ]),
      )
    const stage = await marked()
    expect(stage.every((m) => m.outlined)).toBe(true)
    const learns = stage.map((m) => m.learns)
    expect(learns).toEqual(
      expect.arrayContaining([
        '{"mode":"stage"}',
        '{"mode":"edit"}',
        '{"mode":"decks"}',
        '{"fader":true}',
        '{"page":-1}',
        '{"page":1}',
        JSON.stringify({ knob: KNOB }),
        JSON.stringify({ macro: MACRO }),
      ]),
    )
    // last on the page, the 13 learned pads and the drawn fader beside them
    expect(learns.slice(-14)).toEqual([...PADS.flatMap((t) => (t ? [JSON.stringify(t)] : [])), '{"fader":true}'])
    // nothing else of the bar
    expect(await page.$$eval('.bar [data-learn]', (els) => els.length)).toBe(3)
    expect(await tags()).toEqual([
      ['{"mode":"stage"}', 'n18', 'ch1 note 18'],
      ['{"mode":"edit"}', 'n19', 'ch1 note 19'],
      ['{"mode":"decks"}', 'n20', 'ch1 note 20'],
      ['fader-row', 'cc9', 'ch1 cc9'],
      ...Array.from({ length: 8 }, (_, i) => ['slot', `E${i + 1} · cc${i + 1}`, `ch1 cc${i + 1}`]),
      ['{"page":-1}', 'n16', 'ch1 note 16'],
      ['{"page":1}', 'n17', 'ch1 note 17'],
      // the pads under the strip, each its note, and the drawn fader under the pager
      ...PADS.map((t, i) =>
        t
          ? [JSON.stringify(t), `n${8 + i}`, `ch1 note ${8 + i}`]
          : ['hwpad empty', `n${8 + i}`, `note ${8 + i}: not learned`],
      ),
      ['{"fader":true}', 'cc9', 'ch1 cc9'],
    ])
    // the knob and the macro their look's CC, in their corner
    expect(await page.$eval(`${knob(KNOB)} .knob-midi`, (el) => el.textContent)).toBe('cc21')
    expect(await page.$eval(`${macro(MACRO)} .knob-midi`, (el) => el.textContent)).toBe('cc22')
    // the looks, by their place
    await tab('Bank')
    const looks = await page.$$eval('.stage .right .look-name', (els) =>
      els.map((el) => [
        el.getAttribute('data-learn'),
        getComputedStyle(el).outlineStyle,
        el.querySelector('.map-tag')?.textContent ?? null,
      ]),
    )
    expect(looks).toEqual(LOOKS.map((_, i) => [JSON.stringify({ slot: i }), 'dashed', i < 8 ? `n${8 + i}` : null]))
    // each macro's slider, and its head's mapping
    await tab('Macros')
    const sliders = await page.$$eval('.macro-slider', (els) =>
      els.map((el) => [el.getAttribute('data-learn'), getComputedStyle(el).outlineStyle]),
    )
    expect(sliders).toEqual(t1.macros.map((m) => [JSON.stringify({ macro: m.id }), 'dashed']))
    expect(await page.$$eval('.macro-head .chip-midi', (els) => els.map((el) => el.textContent))).toEqual(['ch1 cc22'])
    // the knobs of more, of Edit's Rack and of Decks' section
    await press('.perform-side', 'more')
    expect((await marked()).filter((m) => m.learns?.startsWith('{"knob"')).length).toBeGreaterThan(8)
    for (const [key, view] of [
      ['e', '.rack'],
      ['d', '.mixer'],
    ] as const) {
      await page.keyboard.press(key)
      await page.waitForSelector(`${view} .knob`)
      expect(await mapState()).toEqual(ON)
      const knobs = await page.$$eval(`${view} .knob`, (els) =>
        els.map((el) => [!!el.getAttribute('data-learn'), getComputedStyle(el).outlineStyle]),
      )
      expect(knobs.length).toBeGreaterThan(0)
      expect(knobs.every(([learns, outline]) => learns && outline === 'dashed')).toBe(true)
    }
    // map mode off, nothing is outlined or tagged
    await page.keyboard.press('Escape')
    expect((await marked()).some((m) => m.outlined)).toBe(false)
    expect(await page.$$('.map-tag')).toEqual([])
  }, 60_000)

  it('in map mode a press on a control arms its learn and changes nothing else, and a press on the one learning cancels it', async () => {
    await tab('Bank')
    await page.evaluate(() => (document.activeElement as HTMLElement).blur())
    const before = await showing()
    expect(before).toEqual({
      view: 'stage',
      page: 'page 1/2',
      fader: '0%',
      look: t1.name,
      value: before.value,
      focused: 0,
      blurred: true,
      typing: false,
    })
    await page.keyboard.press('m')
    for (const [what, words] of [
      [knob(KNOB), `move a control for ${KNOB_NAME}`],
      [macro(MACRO), `move a control for macro ${MACRO_NAME}`],
      ['svg.fader', 'move a control for the A/B fader'],
      ['.pager button[data-learn=\'{"page":1}\']', 'press a button for next strip page'],
      ['.pager button[data-learn=\'{"page":-1}\']', 'press a button for previous strip page'],
      ['.bar button[data-learn=\'{"mode":"edit"}\']', 'press a button for Edit'],
      [lookName(2), `press a button for look 3 · ${LOOKS[2].name}`],
    ] as const) {
      await page.click(what)
      expect(await line()).toBe(words)
      expect(await showing()).toEqual(before)
      // pressed again, its learn ends
      await page.click(what)
      expect(await line()).toBe(BANNER)
      expect(await showing()).toEqual(before)
    }
    // a drag along the fader moves it no more
    const bar = (await (await page.$('svg.fader'))!.boundingBox())!
    await page.mouse.move(bar.x + bar.width * 0.2, bar.y + bar.height / 2)
    await page.mouse.down()
    await page.mouse.move(bar.x + bar.width * 0.8, bar.y + bar.height / 2, { steps: 5 })
    await page.mouse.up()
    expect(await line()).toBe('move a control for the A/B fader')
    expect(await showing()).toEqual(before)
    await page.click('svg.fader')
    // the knob learning pulses, and another press moves the learn to what it is on
    await page.click(knob(KNOB))
    expect(await page.$eval(knob(KNOB), (el) => el.classList.contains('learning'))).toBe(true)
    await page.click('svg.fader')
    expect(await line()).toBe('move a control for the A/B fader')
    expect(await page.$eval(knob(KNOB), (el) => el.classList.contains('learning'))).toBe(false)
    // a double-click types nothing, and a macro's slider keeps its value
    await page.click(knob(KNOB), { count: 2 })
    expect(await showing()).toEqual(before)
    await tab('Macros')
    await page.evaluate(() => (document.activeElement as HTMLElement).blur())
    const slider = () => page.$eval('.macro-slider', (el) => (el as HTMLInputElement).valueAsNumber)
    const value = await slider()
    const box = (await (await page.$('.macro-slider'))!.boundingBox())!
    await page.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2)
    expect(await line()).toBe(`move a control for macro ${t1.macros[0].name}`)
    expect(await slider()).toBe(value)
    // the wheel is not a press, and still turns a knob (down, as it sits at its top)
    await page.hover(knob(KNOB))
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel({ deltaY: 100 })
      await pause(100)
    }
    expect((await showing()).value).not.toBe(before.value)
    // and the keys still reach the app: Esc cancels the learning, then ends map mode
    expect((await showing()).blurred).toBe(true)
    await page.keyboard.press('Escape')
    expect(await line()).toBe(BANNER)
    await page.keyboard.press('Escape')
    expect(await mapState()).toEqual(OFF)
  }, 60_000)

  it('a knob and a macro pressed in map mode learn the next control moved, and the A/B fader, a page, a view and a look the next one moved or pressed', async () => {
    await page.keyboard.press('m')
    await page.click(knob(KNOB))
    await cc(21)
    expect(await page.$eval(`${knob(KNOB)} .knob-midi`, (el) => el.textContent)).toBe('cc21')
    expect(await line()).toBe(BANNER)
    await page.click(macro(MACRO))
    await cc(22)
    expect(await page.$eval(`${macro(MACRO)} .knob-midi`, (el) => el.textContent)).toBe('cc22')
    await page.click('svg.fader')
    await cc(9)
    expect((await stored()).fader).toEqual({ channel: 1, control: 9, pickup: true })
    await page.click('.pager button[data-learn=\'{"page":1}\']')
    await note(17)
    await page.click('.bar button[data-learn=\'{"mode":"decks"}\']')
    await note(20)
    await tab('Bank')
    await page.click(lookName(3))
    await note(11)
    expect(await line()).toBe(BANNER)
    expect((await stored()).buttons).toEqual([
      { channel: 1, note: 17, page: 1 },
      { channel: 1, note: 20, mode: 'decks' },
      { channel: 1, note: 11, slot: 3 },
    ])
    // the tags show what was learned, and nothing was played by it
    expect(await page.$eval('.fader-row .map-tag', (el) => el.textContent)).toBe('cc9')
    expect(await page.$eval(`${lookName(3)} .map-tag`, (el) => el.textContent)).toBe('n11')
    expect(await showing()).toMatchObject({ view: 'stage', page: 'page 1/2', look: t1.name })
    // and with map mode off, they play
    await page.keyboard.press('Escape')
    await note(20)
    await page.waitForSelector('.app.decks')
  }, 60_000)

  it('the knob detail and the macros show MIDI learn only in map mode, and a mapping is forgotten there', async () => {
    const learnIn = (within: string) =>
      page.$$eval(`${within} button, ${within} .chip-midi`, (els) =>
        els
          .filter((el) => ['MIDI learn', 'move a control…'].includes(el.textContent!) || el.matches('.chip-midi'))
          .map((el) => el.textContent),
      )
    await page.keyboard.press('e')
    await page.click(`.rack ${knob(KNOB)}`)
    const detail = '.rack .knob-slot'
    expect(await learnIn(detail)).toEqual([])
    await page.click(MAP)
    expect(await learnIn(detail)).toEqual(['MIDI learn'])
    await press(detail, 'MIDI learn')
    expect(await learnIn(detail)).toEqual(['move a control…'])
    await cc(23)
    expect(await learnIn(detail)).toEqual(['ch1 cc23'])
    await page.click(MAP)
    expect(await learnIn(detail)).toEqual([])
    expect(await page.$$(`${detail} button[title="forget the MIDI control"]`)).toEqual([])
    // the knob's face keeps its badge
    expect(await page.$eval(`.rack ${knob(KNOB)} .knob-midi`, (el) => el.textContent)).toBe('cc23')
    await page.click(MAP)
    await page.click(`${detail} button[title="forget the MIDI control"]`)
    expect(await learnIn(detail)).toEqual(['MIDI learn'])
    expect(await page.$(`.rack ${knob(KNOB)} .knob-midi`)).toBe(null)
    // the macros
    await page.keyboard.press('Escape')
    await page.keyboard.press('e')
    await page.waitForSelector('.app.stage')
    await tab('Macros')
    expect(await learnIn('.right')).toEqual([])
    await page.keyboard.press('m')
    expect(await learnIn('.right')).toEqual(t1.macros.map(() => 'MIDI learn'))
    await page.click('.macro-head button[title^="map the next MIDI control"]')
    await cc(24)
    expect(await learnIn('.right')).toEqual(t1.macros.map((_, i) => (i ? 'MIDI learn' : 'ch1 cc24')))
    await page.keyboard.press('m')
    expect(await learnIn('.right')).toEqual([])
    await page.keyboard.press('m')
    await page.click('.macro-head button[title="forget the MIDI control"]')
    expect(await learnIn('.right')).toEqual(t1.macros.map(() => 'MIDI learn'))
  }, 60_000)

  it('the learning line shows in Stage, Edit, Decks, Direct and Play while a control learns, the sheet closed, and its cancel ends the learning', async () => {
    const words = `move a control for ${KNOB_NAME}`
    // the line where it shows: under the bar, centred (in Edit over its picture, clear of the Rack), over the panels,
    // a panel of its own
    const placed = () =>
      page.$eval('.midi-learning', (el) => {
        const r = el.getBoundingClientRect()
        const style = getComputedStyle(el)
        const middle = el.closest('.edit') ? (innerWidth - 560) / 2 : innerWidth / 2
        return {
          top: Math.round(r.top),
          centred: Math.abs(r.left + r.width / 2 - middle) < 2,
          z: style.zIndex,
          panel: el.matches('.app > .midi-learning.panel'),
          cancel: el.querySelector('button')?.textContent,
        }
      })
    const where = { top: 128, centred: true, z: '4', panel: true, cancel: 'cancel' }
    await page.click(knob(KNOB))
    await page.keyboard.press('m')
    expect(await page.$('.setup-sheet')).toBe(null)
    expect(await line()).toBe(words)
    expect(await placed()).toEqual(where)
    for (const [key, view] of [
      ['e', 'edit'],
      ['d', 'decks'],
      ['t', 'direct'],
    ] as const) {
      await page.keyboard.press(key)
      await page.waitForSelector(`.app.${view}`)
      expect(await line()).toBe(words)
      expect(await placed()).toEqual(where)
    }
    await page.keyboard.press('t')
    await page.waitForSelector('.app.stage')
    await page.keyboard.press('f')
    await page.waitForSelector('.app.play')
    expect(await line()).toBe(words)
    expect(await placed()).toEqual(where)
    await page.click('.midi-learning button')
    expect(await line()).toBe(null)
    await page.keyboard.press('Escape')
    await page.waitForSelector('.app.stage')
    expect(await page.$$('.knob.learning')).toEqual([])
    expect(await line()).toBe(null)
  }, 60_000)

  it('Direct and Play have no map mode, M does nothing there, and going to them ends it', async () => {
    await page.keyboard.press('t')
    await page.waitForSelector('.app.direct')
    expect(await page.$eval(MAP, (el) => el.checkVisibility())).toBe(false)
    await page.keyboard.press('m')
    await pause()
    expect(await page.$('.app.mapping')).toBe(null)
    expect(await line()).toBe(null)
    await page.keyboard.press('t')
    await page.waitForSelector('.app.stage')
    expect(await mapState()).toEqual(OFF)
    await page.keyboard.press('f')
    await page.waitForSelector('.app.play')
    await page.keyboard.press('m')
    await pause()
    expect(await page.$('.app.mapping')).toBe(null)
    expect(await line()).toBe(null)
    await page.keyboard.press('Escape')
    await page.waitForSelector('.app.stage')
    expect(await mapState()).toEqual(OFF)
    // on, it ends on the way there
    for (const [key, view] of [
      ['t', 'direct'],
      ['f', 'play'],
    ] as const) {
      await page.keyboard.press('m')
      expect(await mapState()).toEqual(ON)
      await page.keyboard.press(key)
      await page.waitForSelector(`.app.${view}`)
      expect(await page.$('.app.mapping')).toBe(null)
      expect(await line()).toBe(null)
      await page.keyboard.press(view === 'direct' ? 't' : 'Escape')
      await page.waitForSelector('.app.stage')
      expect(await mapState()).toEqual(OFF)
    }
  }, 60_000)

  it('map mode off, every control does what it did', async () => {
    // once on and off again
    await page.keyboard.press('m')
    await page.keyboard.press('m')
    expect(await mapState()).toEqual(OFF)
    await page.click(knob(KNOB))
    expect(await page.$eval(knob(KNOB), (el) => el.classList.contains('focused'))).toBe(true)
    expect(await line()).toBe(null)
    // a double-click types its value
    await page.click(knob(KNOB), { count: 2 })
    expect((await showing()).typing).toBe(true)
    await page.keyboard.press('Escape')
    expect((await showing()).typing).toBe(false)
    await page.click('.pager button[title^="the next page"]')
    expect((await showing()).page).toBe('page 2/2')
    await page.click('svg.fader')
    expect((await showing()).fader).toBe('50%')
    await tab('Bank')
    await page.click(lookName(2))
    await pause()
    expect((await showing()).look).toBe(LOOKS[2].name)
    await press('.bar .seg', 'Edit')
    await page.waitForSelector('.app.edit .rack .knob')
    expect(await line()).toBe(null)
  }, 60_000)

  it('undocked, M and ◎ map work in the controls window, and a control pressed there learns from the controller', async () => {
    const before = new Set(browser.targets())
    await page.keyboard.press('u')
    const target = await browser.waitForTarget((t) => !before.has(t) && t.type() === 'page', { timeout: 10_000 })
    const popup = (await target.page())!
    await popup.setViewport({ width: 1280, height: 800 })
    await popup.waitForSelector('.knob')
    await popup.keyboard.press('m')
    expect(await mapState(popup)).toEqual(ON)
    expect(await line(popup)).toBe(BANNER)
    expect(await line()).toBe(null)
    await popup.click(MAP)
    expect(await mapState(popup)).toEqual(OFF)
    await popup.click(MAP)
    expect(await mapState(popup)).toEqual(ON)
    expect(
      await popup.$eval(knob(KNOB), (el) => [getComputedStyle(el).outlineStyle, el.classList.contains('focused')]),
    ).toEqual(['dashed', false])
    await popup.click(knob(KNOB))
    expect(await line(popup)).toBe(`move a control for ${KNOB_NAME}`)
    expect(await popup.$eval(knob(KNOB), (el) => el.classList.contains('focused'))).toBe(false)
    // the controller is heard in the main window
    await cc(25)
    expect(await popup.$eval(`${knob(KNOB)} .knob-midi`, (el) => el.textContent)).toBe('cc25')
    expect(await line(popup)).toBe(BANNER)
    // M pressed in the main window ends it where the UI is
    await page.bringToFront()
    await page.keyboard.press('m')
    expect(await mapState(popup)).toEqual(OFF)
    await popup.close()
  }, 60_000)
})
