// The pads row and the drawn controller, the app itself in headless Chrome at 1280x800, on Tapestry 1, with a fake
// controller that keeps what the app sends it: the X-Touch Mini's 16 buttons drawn under the Stage's strip, each as its
// button is learned and lit as its LED, with the drawn fader under the pager; a pad pressed does what its button does,
// and in map mode learns. The setup sheet's MIDI page draws the controller, its encoders, fader and pads learned on.
import { execFileSync } from 'node:child_process'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { LOOKS } from './looks'
import { strip, type Controls, type TriggerTarget } from './scene'

let server: ViteDevServer
let browser: Browser
let page: Page

// what the fake controller puts on the main window: send() delivers a message as a plugged-in controller would,
// ready() says the app is hearing it, and led(n) is the last velocity the app sent note n, if any
type Fake = { send: (...bytes: number[]) => void; ready: () => boolean; led: (note: number) => number | undefined }

// a fake MIDI access with one controller, as map.test.ts's, its output keeping what it is sent
const fakeController = () => {
  type Port = { name: string; state: string; onmidimessage: ((e: { data: Uint8Array; target: Port }) => void) | null }
  const input: Port = { name: 'Fake knobs', state: 'connected', onmidimessage: null }
  const sent: number[][] = []
  const access = {
    inputs: new Map([['fake', input]]),
    outputs: new Map([['fake', { name: 'Fake knobs', state: 'connected', send: (b: number[]) => sent.push([...b]) }]]),
    onstatechange: null,
  }
  Object.defineProperty(Navigator.prototype, 'requestMIDIAccess', {
    configurable: true,
    value: () => Promise.resolve(access),
  })
  const fake: Fake = {
    send: (...bytes) => input.onmidimessage?.({ data: new Uint8Array(bytes), target: input }),
    ready: () => !!input.onmidimessage,
    led: (note) => sent.findLast((b) => (b[0] & 0xf0) === 0x90 && b[1] === note)?.[2],
  }
  Object.assign(window, { fake })
}

// what the captain's two controllers, plugged in at once, put on a window: send(name, ...) delivers a message as that
// controller would, ready() says the app is hearing both, and sent(name) is all the app sent that controller
type Pair = {
  send: (name: string, ...bytes: number[]) => void
  ready: () => boolean
  sent: (name: string) => number[][]
}

// a fake MIDI access with a DJ2GO2 and an X-Touch Mini, each an input and an output of its name, as Chrome lists them
const fakePair = () => {
  type Port = { name: string; state: string; onmidimessage: ((e: { data: Uint8Array; target: Port }) => void) | null }
  const names = ['DJ2GO2', 'X-TOUCH MINI']
  const inputs = new Map(names.map((name): [string, Port] => [name, { name, state: 'connected', onmidimessage: null }]))
  const sent = new Map(names.map((name): [string, number[][]] => [name, []]))
  const send = (name: string) => (b: number[]) => sent.get(name)!.push([...b])
  const access = {
    inputs,
    outputs: new Map(names.map((name) => [name, { name, state: 'connected', send: send(name) }])),
    onstatechange: null,
  }
  Object.defineProperty(Navigator.prototype, 'requestMIDIAccess', {
    configurable: true,
    value: () => Promise.resolve(access),
  })
  const pair: Pair = {
    send: (name, ...bytes) => {
      const input = inputs.get(name)!
      input.onmidimessage?.({ data: new Uint8Array(bytes), target: input })
    },
    ready: () => [...inputs.values()].every((i) => !!i.onmidimessage),
    sent: (name) => sent.get(name)!,
  }
  Object.assign(window, { pair })
}

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
  // MIDI let in, as the captain's browser has it, so the app hears the controller from its load
  await browser.defaultBrowserContext().overridePermissions(new URL(server.resolvedUrls!.local[0]).origin, ['midi'])
  // the picture drawn a few pixels across, which swiftshader keeps up with; the panels lay out as at full size
  await page.evaluateOnNewDocument(() => Object.defineProperty(window, 'devicePixelRatio', { get: () => 0.05 }))
  await page.evaluateOnNewDocument(fakeController)
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
// the strip's first slot, as the app opens
const FIRST = strip(t1, t1.levels[0].id)[0]
// the strip's pages on a look, as it opens on its first level
const pagesOf = (i: number) => Math.ceil(strip(LOOKS[i], LOOKS[i].levels[0].id).length / 8)
const SLOT_1 = 'knob' in FIRST ? `.knob[data-knob="${FIRST.knob}"]` : `.knob[data-macro="${FIRST.macro}"]`
const BANNER = 'MIDI map: click a control, then move a knob or press a button on the controller · Esc ends'
// the captain's rig: the strip on ch1 cc1-8, the A/B fader on cc9 with pickup, and 13 buttons on notes 8-20
const TARGETS: TriggerTarget[] = [
  ...Array.from({ length: 8 }, (_, i) => ({ slot: i })),
  { page: -1 },
  { page: 1 },
  { mode: 'stage' },
  { mode: 'edit' },
  { mode: 'decks' },
]
const RIG: Controls = {
  buttons: TARGETS.map((t, i) => ({ channel: 1, note: 8 + i, ...t })),
  fader: { channel: 1, control: 9, pickup: true },
  strip: Array.from({ length: 8 }, (_, i) => ({ channel: 1, control: 1 + i, index: i })),
}
// what the rig's pads read and are titled, notes 8 to 23
const RIG_PADS = [
  ...LOOKS.slice(0, 8).map((l, i) => `${i + 1} ${l.name}`),
  '◂ page',
  'page ▸',
  'Stage',
  'Edit',
  'Decks',
  '·',
  '·',
  '·',
]
const RIG_TITLES = [
  ...LOOKS.slice(0, 8).map((l, i) => `ch1 note ${8 + i}: look ${i + 1} · ${l.name}`),
  'ch1 note 16: previous strip page',
  'ch1 note 17: next strip page',
  'ch1 note 18: Stage',
  'ch1 note 19: Edit',
  'ch1 note 20: Decks',
  'note 21: not learned',
  'note 22: not learned',
  'note 23: not learned',
]
const EMPTY = Array.from({ length: 16 }, () => '·')
const ROW = '.pads-row'
const SHEET = '.setup-body'
// the sheet's grids: the fake controller's, and the buttons' learned with no device
const FAKE = `${SHEET} .grid[data-device="Fake knobs"]`
const ANY = `${SHEET} .grid[data-device=""]`

const pause = (ms = 200) => new Promise((r) => setTimeout(r, ms))
async function seed(controls: Controls) {
  await page.evaluate((c) => localStorage.setItem('bermuda.midi', JSON.stringify(c)), controls)
  await page.reload()
  await page.waitForSelector('.knob', { timeout: 55_000 })
}
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
// the pads where they are, each as it shows: its text, its title, its note's tag, what it learns and its classes
const pads = (within: string, p: Page = page) =>
  p.$$eval(`${within} .hwpad`, (els) =>
    els.map((el) => ({
      text: el.querySelector('span')!.textContent,
      title: el.getAttribute('title'),
      tag: el.querySelector('.map-tag')?.textContent ?? null,
      tagTitle: el.querySelector('.map-tag')?.getAttribute('title') ?? null,
      learns: el.getAttribute('data-learn'),
      lit: el.classList.contains('lit'),
      empty: el.classList.contains('empty'),
      learning: el.classList.contains('learning'),
      outline: getComputedStyle(el).outlineStyle,
    })),
  )
const texts = async (within: string, p: Page = page) => (await pads(within, p)).map((x) => x.text)
// the pad on a note pressed as a hand would
const pad = (within: string, n: number, p: Page = page) => p.click(`${within} .hwpad:nth-child(${n - 7})`)
// a grid's pad on a note, by its tag
const padOf = async (within: string, n: number, p: Page = page) => {
  const tags = (await pads(within, p)).map((x) => x.tag)
  await p.click(`${within} .hwpad:nth-child(${tags.indexOf(`n${n}`) + 1})`)
}
// a controller's grid on the sheet: its pads' tags, and the line an empty one shows
const grid = (device: string, p: Page = page) =>
  p.$eval(`${SHEET} .grid[data-device="${device}"]`, (el) => ({
    pads: [...el.querySelectorAll('.hwpad .map-tag')].map((t) => t.textContent),
    none: el.querySelector('.pads-none')?.textContent ?? null,
  }))
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('bermuda.midi') ?? '{}') as Controls)
// the learning line's text, if it shows
const line = (p: Page = page) =>
  p.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.midi-learning')
    return el?.checkVisibility() ? el.querySelector('span')!.textContent : null
  })
// what the app shows: the view, the strip's page, the fader, the look and the strip's first knob's value
const showing = (p: Page = page) =>
  p.evaluate((k) => {
    const app = document.querySelector('.app')!
    return {
      view: ['stage', 'edit', 'decks', 'play', 'direct'].find((v) => app.classList.contains(v)),
      page: document.querySelector('.pager > span')?.textContent,
      fader: document.querySelector('.fader-at')?.textContent,
      look: document.querySelector<HTMLInputElement>('.look-title')?.value,
      value: document.querySelector(`${k} .knob-value`)?.textContent,
    }
  }, SLOT_1)
// the drawn fader: its words, its cap's place along its track (0 at its left, 1 at its right), whether it waits and
// its cap's colour
const drawn = () =>
  page.$eval('.hw-fader', (el) => {
    const track = el.querySelector('.hw-track')!.getBoundingClientRect()
    const cap = el.querySelector('.hw-cap')!.getBoundingClientRect()
    return {
      words: [...el.children].map((c) => c.textContent),
      at: Math.round(((cap.left + cap.width / 2 - track.left) / track.width) * 100) / 100,
      waiting: el.classList.contains('waiting'),
      cap: getComputedStyle(el.querySelector('.hw-cap')!).backgroundColor,
    }
  })
const AMBER = 'rgb(255, 200, 120)'
const ACCENT = 'rgb(127, 216, 255)'
const visible = (selector: string, p: Page = page) =>
  p.evaluate((s) => [...document.querySelectorAll(s)].filter((el) => el.checkVisibility()).length, selector)

describe('the pads row and the drawn controller', () => {
  it('the Stage shows the 16 pads under the strip, each as its button is learned, and the drawn fader', async () => {
    await seed(RIG)
    const shown = await pads(ROW)
    expect(shown.map((x) => x.text)).toEqual(RIG_PADS)
    expect(shown.map((x) => x.title)).toEqual(RIG_TITLES)
    expect(shown.map((x) => x.empty)).toEqual(RIG_PADS.map((t) => t === '·'))
    // no note shows with map mode off
    expect(shown.every((x) => x.tag === null)).toBe(true)
    // each under its strip slot, in two rows of 8, under the strip, in the Stage's bottom panel
    const boxes = await page.evaluate(() => {
      const box = (el: Element) => {
        const r = el.getBoundingClientRect()
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }
      }
      return {
        slots: [...document.querySelectorAll('.stage .bottom .perform .slot')].map(box),
        pads: [...document.querySelectorAll('.stage .bottom .pads-row .hwpad')].map(box),
        side: box(document.querySelector('.perform-side')!),
        fader: box(document.querySelector('.stage .bottom .pads-row .hw-fader')!),
      }
    })
    expect(boxes.slots.length).toBe(8)
    boxes.pads.forEach((b, i) => {
      const slot = boxes.slots[i % 8]
      expect([b.left, b.width]).toEqual([slot.left, slot.width])
      expect(b.top).toBeGreaterThan(slot.bottom)
      if (i >= 8) expect(b.top).toBeGreaterThan(boxes.pads[i - 8].bottom)
    })
    // the drawn fader right of the pads, under the pager and more
    expect(boxes.fader.left).toBeGreaterThan(boxes.pads[7].right)
    expect(boxes.fader.top).toBeGreaterThan(boxes.side.bottom)
    expect(Math.abs(boxes.fader.right - boxes.side.right)).toBeLessThan(2)
    expect(await drawn()).toEqual({ words: ['A', '', 'B'], at: 0, waiting: true, cap: AMBER })
    // with nothing learned, 16 empty pads
    await seed({ buttons: [] })
    const empty = await pads(ROW)
    expect(empty.map((x) => x.text)).toEqual(EMPTY)
    expect(empty.map((x) => x.title)).toEqual(Array.from({ length: 16 }, (_, i) => `note ${8 + i}: not learned`))
    expect(empty.every((x) => x.empty && !x.lit && !x.learns)).toBe(true)
    expect(await drawn()).toMatchObject({ words: ['A', '', 'B'], waiting: false, cap: ACCENT })
  }, 60_000)

  it("a pad pressed does what its button does, as the controller's button still does, and an empty pad does nothing", async () => {
    await seed(RIG)
    await pad(ROW, 10)
    await pause()
    expect((await showing()).look).toBe(LOOKS[2].name)
    // the controller's button still does it
    await note(11)
    expect((await showing()).look).toBe(LOOKS[3].name)
    await pad(ROW, 8)
    await pause()
    const at = await showing()
    expect(at).toMatchObject({ view: 'stage', page: 'page 1/2', look: t1.name })
    // the strip turns its page
    await pad(ROW, 17)
    expect((await showing()).page).toBe('page 2/2')
    await note(16)
    expect((await showing()).page).toBe('page 1/2')
    await pad(ROW, 16)
    expect((await showing()).page).toBe('page 2/2')
    await pad(ROW, 16)
    expect(await showing()).toEqual(at)
    // an empty pad does nothing
    for (const n of [21, 22, 23]) {
      await pad(ROW, n)
      await pause()
      expect(await showing()).toEqual(at)
    }
    // the view changes
    await pad(ROW, 18)
    expect(await showing()).toEqual(at)
    await pad(ROW, 19)
    await page.waitForSelector('.app.edit')
    await note(18)
    await page.waitForSelector('.app.stage .pads-row')
    await pad(ROW, 20)
    await page.waitForSelector('.app.decks')
    await note(18)
    await page.waitForSelector('.app.stage .pads-row')
  }, 60_000)

  it("each pad is lit as its button's LED is", async () => {
    await seed(RIG)
    // the app sends the controller its LEDs once the controller has sent something
    await cc(100)
    const leds = async () => {
      await pause(300)
      const shown = await pads(ROW)
      const sent = await page.evaluate(() =>
        Array.from({ length: 16 }, (_, i) => (window as unknown as { fake: Fake }).fake.led(8 + i) ?? null),
      )
      return { lit: shown.map((x) => x.lit), sent }
    }
    const check = async (lit: number[]) => {
      const { lit: shown, sent } = await leds()
      expect(shown).toEqual(sent.map((v) => !!v))
      expect(sent).toEqual(RIG_PADS.map((t, i) => (t === '·' ? null : lit.includes(8 + i) ? 1 : 0)))
    }
    // look 1, the strip's pages and the Stage
    await check([8, 16, 17, 18])
    // look 3 loaded
    await pad(ROW, 10)
    await check([10, 16, 17, 18])
    // the strip's page turned
    await pad(ROW, 17)
    expect((await showing()).page).toBe(`page 2/${pagesOf(2)}`)
    await check([10, 16, 17, 18])
    // a look loaded from the controller
    await note(15)
    await check([15, 16, 17, 18])
  }, 60_000)

  it('the drawn fader shows where the A/B fader is, amber while the MIDI fader waits to pick up', async () => {
    await seed(RIG)
    expect(await drawn()).toEqual({ words: ['A', '', 'B'], at: 0, waiting: true, cap: AMBER })
    expect(await page.$eval('.hw-fader', (el) => el.getAttribute('title'))).toBe(
      "the A/B fader, as the controller's fader drives it: waiting to pick up",
    )
    // moved by the keys, still waiting
    for (let i = 0; i < 10; i++) await page.keyboard.press('.')
    expect((await showing()).fader).toBe('50%')
    expect(await drawn()).toMatchObject({ at: 0.5, waiting: true, cap: AMBER })
    // the MIDI fader picks it up, and then drives it
    await cc(9, 64)
    expect(await drawn()).toMatchObject({ at: 0.5, waiting: false, cap: ACCENT })
    expect(await page.$eval('.hw-fader', (el) => el.getAttribute('title'))).toBe(
      "the A/B fader, as the controller's fader drives it",
    )
    await cc(9, 127)
    expect((await showing()).fader).toBe('100%')
    expect(await drawn()).toMatchObject({ at: 1, waiting: false })
    // no drag and no wheel
    const track = (await (await page.$('.hw-track'))!.boundingBox())!
    await page.mouse.move(track.x + track.width * 0.9, track.y + track.height / 2)
    await page.mouse.down()
    await page.mouse.move(track.x + track.width * 0.1, track.y + track.height / 2, { steps: 5 })
    await page.mouse.up()
    await page.mouse.wheel({ deltaY: 100 })
    await pause()
    expect((await showing()).fader).toBe('100%')
    // without pickup it never waits
    await seed({ ...RIG, fader: { channel: 1, control: 9 } })
    expect(await drawn()).toMatchObject({ at: 0, waiting: false, cap: ACCENT })
  }, 60_000)

  it('in map mode each pad shows its note, and a learned pad pressed arms its learn and does nothing else, the next button pressed taking it', async () => {
    await seed(RIG)
    // the strip's first knob turned off where look 1 has it, so loading the look again would show
    const fresh = (await showing()).value
    await cc(1, 0)
    const before = await showing()
    expect(before.value).not.toBe(fresh)
    // the pads and the drawn fader's words and track, where they are
    const boxes = () =>
      page.$$eval(`${ROW} .hwpad, ${ROW} .hw-fader > :not(.map-tag)`, (els) =>
        els.map((el) => JSON.stringify(el.getBoundingClientRect())),
      )
    const off = await boxes()
    await page.keyboard.press('m')
    const shown = await pads(ROW)
    expect(shown.map((x) => x.text)).toEqual(RIG_PADS)
    expect(shown.map((x) => x.tag)).toEqual(Array.from({ length: 16 }, (_, i) => `n${8 + i}`))
    expect(shown.map((x) => x.tagTitle)).toEqual(
      RIG_PADS.map((t, i) => (t === '·' ? `note ${8 + i}: not learned` : `ch1 note ${8 + i}`)),
    )
    // a learned pad its target, outlined; an empty one neither
    expect(shown.map((x) => x.learns)).toEqual([...TARGETS.map((t) => JSON.stringify(t)), null, null, null])
    expect(shown.map((x) => x.outline)).toEqual(RIG_PADS.map((t) => (t === '·' ? 'none' : 'dashed')))
    // turning map mode on moves no pad, and not the drawn fader, its cc9 under it
    expect(await boxes()).toEqual(off)
    expect(await page.$eval('.hw-fader .map-tag', (el) => el.textContent)).toBe('cc9')
    // a press arms its learn, and another cancels it
    await pad(ROW, 9)
    expect(await line()).toBe(`press a button for look 2 · ${LOOKS[1].name}`)
    expect((await pads(ROW))[1].learning).toBe(true)
    await pad(ROW, 9)
    expect(await line()).toBe(BANNER)
    expect((await pads(ROW))[1].learning).toBe(false)
    // pad n8 learns, and look 1 is not loaded again
    await pad(ROW, 8)
    expect(await line()).toBe(`press a button for look 1 · ${t1.name}`)
    expect((await pads(ROW))[0].learning).toBe(true)
    await pad(ROW, 17)
    expect(await line()).toBe('press a button for next strip page')
    await pad(ROW, 8)
    // an empty pad does nothing, the learn left as it is
    await pad(ROW, 22)
    expect(await line()).toBe(`press a button for look 1 · ${t1.name}`)
    expect(await showing()).toEqual(before)
    await note(21)
    expect(await line()).toBe(BANNER)
    expect(await showing()).toEqual(before)
    expect((await stored()).buttons).toEqual([
      ...RIG.buttons.slice(1),
      { channel: 1, note: 21, device: 'Fake knobs', slot: 0 },
    ])
    const after = await pads(ROW)
    expect([after[13].text, after[13].tag, after[13].learns]).toEqual([`1 ${t1.name}`, 'n21', '{"slot":0}'])
    expect([after[0].text, after[0].tag, after[0].learns, after[0].empty]).toEqual(['·', 'n8', null, true])
    // map mode off, the notes go, and nothing moves
    await page.keyboard.press('Escape')
    expect((await pads(ROW)).every((x) => x.tag === null)).toBe(true)
    expect(await boxes()).toEqual(off)
  }, 60_000)

  it("the pads are the Stage's alone: H hides them, they stay under the strip while the context panel is open, and Edit, Decks, Direct and Play show none", async () => {
    await seed(RIG)
    expect(await visible(`${ROW} .hwpad`)).toBe(16)
    expect(await visible('.hw-fader')).toBe(1)
    await page.keyboard.press('h')
    expect(await visible(`${ROW} .hwpad`)).toBe(0)
    expect(await visible('.hw-fader')).toBe(0)
    await page.keyboard.press('h')
    expect(await visible(`${ROW} .hwpad`)).toBe(16)
    // more and the whole chip: the chip's knobs in the context panel, and the strip and the pads stay under them
    await page.click('.perform-side button[title="every knob of the picked chip"]')
    await page.click('.context .all-toggle')
    await page.waitForSelector('.context .group')
    expect(await visible('.context .knob')).toBeGreaterThan(8)
    expect(await visible(`${ROW} .hwpad`)).toBe(16)
    expect(await visible('.hw-fader')).toBe(1)
    expect(await visible('.perform .slot')).toBe(8)
    await page.click('.context button[title="close (Esc)"]')
    for (const [key, view, back] of [
      ['e', 'edit', 'e'],
      ['d', 'decks', 'd'],
      ['t', 'direct', 't'],
      ['f', 'play', 'Escape'],
    ] as const) {
      await page.keyboard.press(key)
      await page.waitForSelector(`.app.${view}`)
      expect(await page.$$('.hwpad, .hw-fader')).toEqual([])
      await page.keyboard.press(back)
      await page.waitForSelector('.app.stage .pads-row')
    }
    // without Web MIDI there are none
    const bare = await browser.newPage()
    await bare.setViewport({ width: 1280, height: 800 })
    await bare.evaluateOnNewDocument(() => Object.defineProperty(window, 'devicePixelRatio', { get: () => 0.05 }))
    await bare.evaluateOnNewDocument(
      () => delete (Navigator.prototype as { requestMIDIAccess?: unknown }).requestMIDIAccess,
    )
    await bare.goto(server.resolvedUrls!.local[0])
    await bare.waitForSelector('.knob', { timeout: 55_000 })
    expect(await bare.$$('.hwpad, .hw-fader')).toEqual([])
    await bare.close()
  }, 60_000)

  it("the sheet's MIDI page draws the controller: the strip's encoders, the A/B fader's control and a grid of pads a controller, over the learned buttons' list", async () => {
    // the drawing, in the MIDI block after the look's mappings
    const drawing = () =>
      page.evaluate(() => {
        const c = document.querySelector('.setup-body .controller')!
        const enc = (el: Element) => [el.textContent, el.getAttribute('title'), el.classList.contains('none')]
        const rows = [...c.querySelectorAll('.sm-row')]
        const list = [...c.querySelectorAll('.midi-buttons > .target')]
        const pads = c.querySelector('.grids')!.getBoundingClientRect()
        return {
          after: c.previousElementSibling?.matches('.targets'),
          first: c.firstElementChild!.matches('.sm-row'),
          grids: [...c.querySelectorAll('.grid-name')].map((el) => el.textContent),
          labels: [...c.querySelectorAll('.sm-label')].map((el) => el.textContent),
          encoders: [...rows[0].querySelectorAll('.sm-enc')].map(enc),
          stripButtons: [...rows[0].querySelectorAll('button')].map((b) => [b.textContent, b.getAttribute('title')]),
          fader: [...rows[1].querySelectorAll('.sm-enc')].map((el) => [...enc(el), el.classList.contains('waiting')]),
          faderControls: [...rows[1].querySelectorAll('button, label')].map((el) => el.textContent),
          waitingLine: c.querySelector(':scope > .pickup')?.textContent ?? null,
          picker: list[0].textContent,
          rows: list.slice(1).map((el) => el.textContent),
          under: list.slice(1).every((el) => el.getBoundingClientRect().top >= pads.bottom),
          pickerOver: list[0].getBoundingClientRect().bottom <= pads.top,
          oldStrip: c.closest('.setup-body')!.textContent!.includes('1 ch1 cc1,'),
        }
      })
    await seed(RIG)
    await page.keyboard.press('g')
    expect(await drawing()).toEqual({
      after: true,
      first: true,
      // the controller plugged in, which has sent no note yet, and the rig's buttons, learned with no device
      grids: ['Fake knobs', 'any controller'],
      labels: ['encoders → the strip', 'fader → A/B', 'buttons: click a pad, then press its button'],
      encoders: Array.from({ length: 8 }, (_, i) => [`E${i + 1}cc${i + 1}`, `ch1 cc${i + 1}`, false]),
      stripButtons: [
        ['×', "forget the strip's encoders"],
        [
          'learn the strip',
          "map the next 8 encoders you turn to the strip's 8 slots, in turn, on every look (Esc stops)",
        ],
      ],
      fader: [['Fcc9 · pickup', 'ch1 cc9', false, true]],
      faderControls: ['fader', '×'],
      waitingLine: 'waiting: move the fader to 0%',
      picker: expect.stringMatching(/^button for/),
      rows: RIG.buttons.map((b, i) => `ch1 note ${b.note}${RIG_TITLES[i].replace(/^ch1 note \d+: /, '')}×`),
      under: true,
      pickerOver: true,
      oldStrip: false,
    })
    expect(await grid('Fake knobs')).toEqual({ pads: [], none: 'no button pressed yet' })
    const shown = await pads(ANY)
    expect(shown.map((x) => x.text)).toEqual(RIG_PADS.slice(0, 13))
    expect(shown.map((x) => x.title)).toEqual(RIG_TITLES.slice(0, 13))
    expect(shown.map((x) => x.tag)).toEqual(Array.from({ length: 13 }, (_, i) => `n${8 + i}`))
    expect(shown.map((x) => x.lit)).toEqual(RIG.buttons.map((b) => [8, 16, 17, 18].includes(b.note)))
    // the notes the controller sends draw its grid, each pad the button it presses
    await note(21)
    await note(9)
    expect(await pads(FAKE)).toMatchObject([
      { text: `2 ${LOOKS[1].name}`, title: RIG_TITLES[1], tag: 'n9', empty: false },
      { text: '·', title: 'ch1 note 21: not learned', tag: 'n21', empty: true },
    ])
    // with nothing learned, the controller's grid alone
    await page.keyboard.press('Escape')
    await seed({ buttons: [] })
    await page.keyboard.press('g')
    expect(await drawing()).toMatchObject({
      grids: ['Fake knobs'],
      encoders: Array.from({ length: 8 }, (_, i) => [`E${i + 1}—`, `slot ${i + 1}: no encoder`, true]),
      stripButtons: [['learn the strip', expect.any(String)]],
      fader: [['F—', 'the A/B fader: no control', true, false]],
      faderControls: ['MIDI learn'],
      waitingLine: null,
      rows: [],
    })
    expect(await grid('Fake knobs')).toEqual({ pads: [], none: 'no button pressed yet' })
  }, 60_000)

  it('on the drawing, learn the strip lights each encoder as it learns, and the fader learns the next control moved', async () => {
    await page.keyboard.press('g')
    // the drawing's rows: the encoders', then the fader's
    const chips = (row: number) =>
      page.$$eval(
        `${SHEET} .sm-row`,
        (rows, row) =>
          [...rows[row].querySelectorAll('.sm-enc')].map((el) => [el.textContent, el.classList.contains('learning')]),
        row,
      )
    const encoders = () => chips(0)
    const strip = `${SHEET} button[title^="map the next 8 encoders"]`
    await page.click(strip)
    expect(await page.$eval(strip, (el) => el.textContent)).toBe('turn an encoder…')
    for (let i = 0; i < 8; i++) {
      expect(await encoders()).toEqual(
        Array.from({ length: 8 }, (_, j) => [`E${j + 1}${j < i ? `cc${31 + j}` : '—'}`, j === i]),
      )
      expect(await line()).toBe(`turn the encoder for slot ${i + 1}`)
      await cc(31 + i)
      // the burst an encoder sends is not a new one
      await cc(31 + i, 70)
    }
    expect(await encoders()).toEqual(Array.from({ length: 8 }, (_, j) => [`E${j + 1}cc${31 + j}`, false]))
    expect(await page.$eval(strip, (el) => el.textContent)).toBe('learn the strip')
    expect(await line()).toBe(null)
    expect((await stored()).strip).toEqual(
      Array.from({ length: 8 }, (_, i) => ({ channel: 1, control: 31 + i, index: i, device: 'Fake knobs' })),
    )
    // the fader
    const fader = async () => (await chips(1))[0]
    expect(await fader()).toEqual(['F—', false])
    await page.click(`${SHEET} button[title="map the next MIDI control you move to the A/B fader"]`)
    expect(await fader()).toEqual(['F—', true])
    expect(await line()).toBe('move a control for the A/B fader')
    await cc(40)
    expect(await fader()).toEqual(['Fcc40 · pickup', false])
    expect((await stored()).fader).toEqual({ channel: 1, control: 40, pickup: true, device: 'Fake knobs' })
    expect(await line()).toBe(null)
    // and the strip's × forgets its encoders
    await page.click(`${SHEET} button[title="forget the strip's encoders"]`)
    expect((await encoders()).map(([text]) => text)).toEqual(Array.from({ length: 8 }, (_, j) => `E${j + 1}—`))
  }, 60_000)

  it('on the sheet a pad pressed learns from the next button pressed: a learned pad its own target, an empty pad what button for picks, and Esc cancels', async () => {
    await seed(RIG)
    await page.keyboard.press('g')
    const at = await showing()
    // a learned pad its own target, and a second press cancels it
    await padOf(ANY, 10)
    expect(await line()).toBe(`press a button for look 3 · ${LOOKS[2].name}`)
    expect((await pads(ANY))[2].learning).toBe(true)
    expect(await showing()).toEqual(at)
    await padOf(ANY, 10)
    expect(await line()).toBe(null)
    await padOf(ANY, 10)
    await note(22)
    expect(await line()).toBe(null)
    expect(await showing()).toEqual(at)
    // learned on the controller it came from, off the grid of the buttons with no device and onto its own
    expect((await stored()).buttons).toEqual([
      ...RIG.buttons.filter((b) => b.note !== 10),
      { channel: 1, note: 22, device: 'Fake knobs', slot: 2 },
    ])
    expect((await pads(ANY)).map((x) => x.tag)).not.toContain('n10')
    expect(await texts(FAKE)).toEqual([`3 ${LOOKS[2].name}`])
    // an empty pad what button for picks: the Stage, learned on note 18, which pulses
    await note(21)
    await page.select(`${SHEET} .midi-buttons select`, 'stage')
    await padOf(FAKE, 21)
    expect(await line()).toBe('press a button for Stage')
    expect((await pads(SHEET)).filter((x) => x.learning).map((x) => x.title)).toEqual(['ch1 note 18: Stage'])
    expect(await page.$eval(`${SHEET} .midi-buttons button.learning`, (el) => el.textContent)).toBe('press a button…')
    // Esc cancels, and the sheet stays open
    await page.keyboard.press('Escape')
    expect(await line()).toBe(null)
    expect(await page.$(SHEET)).not.toBe(null)
    expect((await pads(SHEET)).some((x) => x.learning)).toBe(false)
    await padOf(FAKE, 21)
    await note(23)
    expect((await stored()).buttons.at(-1)).toEqual({ channel: 1, note: 23, device: 'Fake knobs', mode: 'stage' })
    expect(await texts(FAKE)).toEqual(['·', `3 ${LOOKS[2].name}`, 'Stage'])
    expect((await pads(ANY)).map((x) => x.tag)).not.toContain('n18')
    // and in map mode too: an empty pad what button for picks
    await page.keyboard.press('m')
    await page.select(`${SHEET} .midi-buttons select`, 'edit')
    await padOf(FAKE, 21)
    expect(await line()).toBe('press a button for Edit')
    await page.keyboard.press('Escape')
    expect(await line()).toBe(BANNER)
    expect(await page.$(SHEET)).not.toBe(null)
    expect(await showing()).toEqual(at)
  }, 60_000)

  it('undocked, the pads are in the controls window, and a pad pressed there does what its button does', async () => {
    await seed(RIG)
    const before = new Set(browser.targets())
    await page.keyboard.press('u')
    const target = await browser.waitForTarget((t) => !before.has(t) && t.type() === 'page', { timeout: 10_000 })
    const popup = (await target.page())!
    await popup.setViewport({ width: 1280, height: 800 })
    await popup.waitForSelector(`${ROW} .hwpad`)
    expect(await texts(ROW, popup)).toEqual(RIG_PADS)
    expect(await page.$$('.hwpad')).toEqual([])
    await pad(ROW, 10, popup)
    await pause()
    expect((await showing(popup)).look).toBe(LOOKS[2].name)
    expect((await pads(ROW, popup)).map((x) => x.lit)).toEqual(RIG_PADS.map((_, i) => [10, 16, 17, 18].includes(8 + i)))
    await pad(ROW, 17, popup)
    expect((await showing(popup)).page).toBe(`page 2/${pagesOf(2)}`)
    await pad(ROW, 19, popup)
    await popup.waitForSelector('.app.edit')
    expect(await popup.$$('.hwpad')).toEqual([])
    await popup.close()
  }, 60_000)

  it("with two controllers plugged in at once, the sheet draws a grid each, side by side, of exactly the notes each sent, the X-Touch's layer B too", async () => {
    const two = await browser.newPage()
    await two.setViewport({ width: 1280, height: 800 })
    await two.evaluateOnNewDocument(() => Object.defineProperty(window, 'devicePixelRatio', { get: () => 0.05 }))
    await two.evaluateOnNewDocument(fakePair)
    await two.goto(server.resolvedUrls!.local[0])
    await two.waitForSelector('.knob', { timeout: 55_000 })
    await two.waitForFunction(() => (window as unknown as { pair: Pair }).pair.ready(), { polling: 100 })
    const send = async (name: string, ...bytes: number[]) => {
      await two.evaluate((n, b) => (window as unknown as { pair: Pair }).pair.send(n, ...b), name, bytes)
      await pause()
    }
    const sent = (name: string) => two.evaluate((n) => (window as unknown as { pair: Pair }).pair.sent(n), name)
    const DJ = `${SHEET} .grid[data-device="DJ2GO2"]`
    const XT = `${SHEET} .grid[data-device="X-TOUCH MINI"]`
    await two.keyboard.press('g')
    // each plugged in, with no note sent yet: its name over an empty grid
    expect(await two.$$eval(`${SHEET} .grid-name`, (els) => els.map((el) => el.textContent))).toEqual([
      'DJ2GO2',
      'X-TOUCH MINI',
    ])
    expect(await grid('DJ2GO2', two)).toEqual({ pads: [], none: 'no button pressed yet' })
    expect(await grid('X-TOUCH MINI', two)).toEqual({ pads: [], none: 'no button pressed yet' })
    // layer A's first and last buttons, then layer B's, out of order, and a release, which draws nothing
    for (const n of [8, 23, 47, 32]) await send('X-TOUCH MINI', 0x90, n, 127)
    await send('X-TOUCH MINI', 0x80, 40, 0)
    // a pad on each of the DJ2GO2's decks, on its own channel
    await send('DJ2GO2', 0x94, 1, 127)
    await send('DJ2GO2', 0x95, 1, 127)
    expect(await grid('X-TOUCH MINI', two)).toEqual({ pads: ['n8', 'n23', 'n32', 'n47'], none: null })
    expect(await grid('DJ2GO2', two)).toEqual({ pads: ['n1', 'n1'], none: null })
    expect((await pads(DJ, two)).map((x) => x.title)).toEqual(['ch5 note 1: not learned', 'ch6 note 1: not learned'])
    // side by side, the DJ2GO2's at the left
    const [dj, xt] = await two.$$eval(`${SHEET} .grid`, (els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect()
        return { top: r.top, left: r.left, right: r.right }
      }),
    )
    expect(xt.top).toBe(dj.top)
    expect(xt.left).toBeGreaterThan(dj.right)
    // a pad learned on one is its controller's alone, its LED sent to it alone
    await padOf(XT, 32, two)
    await send('X-TOUCH MINI', 0x90, 32, 127)
    expect(
      await two.evaluate(() => (JSON.parse(localStorage.getItem('bermuda.midi') ?? '{}') as Controls).buttons),
    ).toEqual([{ channel: 1, note: 32, device: 'X-TOUCH MINI', slot: 0 }])
    expect(await texts(XT, two)).toEqual(['·', '·', `1 ${t1.name}`, '·'])
    expect(await texts(DJ, two)).toEqual(['·', '·'])
    expect((await sent('X-TOUCH MINI')).filter((b) => b[0] === 0x90 && b[1] === 32).at(-1)).toEqual([0x90, 32, 1])
    expect((await sent('DJ2GO2')).filter((b) => b[1] === 32)).toEqual([])
    await two.close()
  }, 60_000)
})
