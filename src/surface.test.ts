// The Stage as the play surface, the app itself in headless Chrome at 1280x800, on Tapestry 1, with a fake controller:
// the bar with ♪, the slim fader at the top, and one bottom deck of the picker row over the strip and the pads; a pick
// (a chip, a knob, a modulator, the macros, the looks, the music, the edge) opens the context panel at the right on
// it, ✕ or Esc closing it, the fader and the deck clear of it; Tab walks the strip, then the panel's live knobs, each
// once. The panel keeps what it shows through the other views, and undocked the surface is in the controls window.
import { execFileSync } from 'node:child_process'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { LOOKS } from './looks'
import { allLevels, knobKind, strip, type Controls } from './scene'

let server: ViteDevServer
let browser: Browser
let page: Page

// a fake MIDI access with one controller, as pads.test.ts's
const fakeController = () => {
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
const FIRST = t1.levels[0].id
// the strip's first page, by knob address or macro id, and its first knob
const STRIP = strip(t1, FIRST)
  .slice(0, 8)
  .map((t) => ('knob' in t ? t.knob : t.macro))
const KNOB = strip(t1, FIRST).flatMap((t) => ('knob' in t ? [t.knob] : []))[0]
const TURN = `levels[${FIRST}].affine.turn`
// the picker row's entries, in order
const PICKER = [
  'Looks',
  'Macros',
  'Background',
  'Frame',
  ...allLevels(t1.levels).map(({ level }) => level.id),
  '+ level',
  'Contour',
  'Line',
  'Palette',
  'Composite · post',
  ...t1.modulators.map((m) => `⠿ ${m.id}`),
  '+',
]
// what the Looks entry keeps out: the sheet's saving, files and deleting, and the bank's management
const LOOKS_SETUP = ['save look', 'export', 'import', '+ preset']
const BANK_SETUP = ['+ add', '− remove', 'export', 'import', 'deep first']
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

const pause = (ms = 200) => new Promise((r) => setTimeout(r, ms))
async function seed(controls: Controls) {
  await page.evaluate((c) => localStorage.setItem('bermuda.midi', JSON.stringify(c)), controls)
  await page.reload()
  await page.waitForSelector('.knob', { timeout: 55_000 })
}
// a button or modulator chip, by where it is and how its shown text starts, pressed as a hand would
async function press(within: string, text: string, p: Page = page) {
  for (const b of await p.$$(`${within} button, ${within} .chip-mod`))
    if (
      await b.evaluate(
        (el, text) => (el as HTMLElement).innerText.trim().startsWith(text) && el.checkVisibility(),
        text,
      )
    )
      return b.click()
  throw new Error(`no ${within} button ${text}`)
}
// the context panel, if it shows: its head, its blocks' titles and the detail's address, or why it has none
const panel = (p: Page = page) =>
  p.evaluate(() => {
    const c = document.querySelector('.context')
    if (!c?.checkVisibility()) return null
    return {
      head: c.querySelector('.context-head b')!.textContent,
      blocks: [...c.querySelectorAll('.block-title > span:first-child, .group-title > :first-child')].map(
        (el) => el.textContent,
      ),
      detail: c.querySelector('.knob-slot')
        ? (c.querySelector('.knob-slot .detail code')?.textContent ?? c.querySelector('.knob-slot')!.textContent)
        : null,
    }
  })
// the shown text of each entry of the picker row, and of those with the class on
const entries = (p: Page = page) =>
  p.$$eval('.picker button, .picker .chip-mod', (els) =>
    els.filter((el) => el.checkVisibility()).map((el) => (el as HTMLElement).innerText.trim()),
  )
const on = () => page.$$eval('.picker .on, .bar > .on', (els) => els.map((el) => (el as HTMLElement).innerText.trim()))
const visible = (selector: string, p: Page = page) =>
  p.evaluate((s) => [...document.querySelectorAll(s)].filter((el) => el.checkVisibility()).length, selector)
// the knobs the app's focus is on, by address: a knob on the strip and in the panel is one
const focused = () =>
  page.$$eval('.knob.focused', (els) => [...new Set(els.map((el) => (el as HTMLElement).dataset.knob))])
// the knob or macro the browser's focus is on
const at = () =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement
    return el.dataset.knob ?? el.dataset.macro ?? el.tagName
  })
async function walk(n: number, back = false) {
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    if (back) await page.keyboard.down('Shift')
    await page.keyboard.press('Tab')
    if (back) await page.keyboard.up('Shift')
    out.push(await at())
  }
  return out
}
const box = (selector: string) =>
  page.$eval(selector, (el) => {
    const r = el.getBoundingClientRect()
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
  })

describe('the play surface', () => {
  it('the Stage at rest: the bar with ♪, the slim fader, and one bottom deck of the picker row, the strip and the pads; no left chain, no tabs and no context panel', async () => {
    await seed(RIG)
    // ♪ in the bar, after mutate
    expect(
      await page.$eval('.bar button[title^="the music"]', (el) => [
        el.textContent,
        el.getAttribute('title'),
        el.previousElementSibling!.textContent,
      ]),
    ).toEqual(['♪ song / mic', 'the music: a song, the microphone or a tab, and what it hears', 'mutate'])
    // the slim fader: one row of A, the fader, B, the %, ⇄ swap, copy to B and edge ▸, the pickup line under it
    const fader = await page.evaluate(() => {
      const top = document.querySelector('.app > section.panel.top')!
      const row = top.querySelectorAll('.fader-row')
      return {
        rows: row.length,
        parts: [...row[0].children].map((el) => (el.matches('svg') ? 'fader' : el.textContent)),
        edge: top.querySelector('button:last-child')!.getAttribute('title'),
        pickup: top.querySelector('.pickup')?.textContent,
        under: top.querySelector('.pickup')!.getBoundingClientRect().top >= row[0].getBoundingClientRect().bottom,
        stagger: top.querySelectorAll('.slide, .check').length,
      }
    })
    expect(fader).toEqual({
      rows: 1,
      parts: [`A${t1.name}`, 'fader', expect.stringMatching(/^B./), '0%', '⇄ swap', 'copy to B', 'edge ▸'],
      edge: 'the edge: stagger and deep first, in the context panel',
      pickup: 'MIDI fader waiting: move it to 0% to pick up',
      under: true,
      stagger: 0,
    })
    // one bottom deck: the picker row, the strip, the pads
    expect(
      await page.$$eval('.app > section.panel.bottom > *', (els) => els.map((el) => el.className.split(' ')[0])),
    ).toEqual(['picker', 'perform', 'pads-row'])
    expect(await entries()).toEqual(PICKER)
    expect(
      await page.$$eval('.picker > button, .picker > .chip-mod', (els) => els.map((el) => el.getAttribute('title'))),
    ).toEqual([
      'the looks, their presets and the bank',
      'the macros, their targets and what they listen to',
      ...t1.modulators.map(() => 'open it; drag onto a knob'),
      '+ modulator',
    ])
    // the chain's chips in a row, without their dim text and the sub-chains' labels
    expect(await visible('.picker .chip .dim, .picker .sub')).toBe(0)
    const chips = await page.$$eval('.picker .chip', (els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().top)),
    )
    expect(new Set(chips).size).toBeLessThanOrEqual(2)
    // nothing else
    expect(await page.$$('.stage .left, .stage .right, nav, .tabs, .stage-bottom, .strip-back, .context')).toEqual([])
    expect(await page.$$eval('.chain', (els) => els.map((el) => !!el.closest('.picker')))).toEqual([true])
    expect(await visible('.perform .slot')).toBe(8)
    expect(await visible('.pads-row .hwpad')).toBe(16)
  }, 60_000)

  it('a chip pressed in the picker row picks it and opens the context panel on its every knob, and more ▸ does too; ✕ and Esc close it', async () => {
    const second = t1.levels[1].id
    await press('.picker', second)
    expect(await page.$eval('.picker .chip.picked', (el) => (el as HTMLElement).innerText)).toBe(second)
    expect(await panel()).toEqual({ head: second, blocks: [`Level ${second}`], detail: 'no knob focused' })
    // every knob of the chip, as more showed it
    await press('.picker', FIRST)
    expect(await panel()).toMatchObject({ head: FIRST, blocks: [`Level ${FIRST}`] })
    expect(await visible('.context .group .knob')).toBeGreaterThan(8)
    expect(await page.$eval('.context-head button', (el) => [el.textContent, el.getAttribute('title')])).toEqual([
      '✕',
      'close (Esc)',
    ])
    await page.click('.context-head button')
    expect(await panel()).toBe(null)
    // more ▸ opens it on the picked chip, and Esc closes it
    await page.click('.perform-side button[title="every knob of the picked chip"]')
    expect(await panel()).toMatchObject({ head: FIRST, blocks: [`Level ${FIRST}`] })
    await page.keyboard.press('Escape')
    expect(await panel()).toBe(null)
    // a chip of the fixed parts too, and the arrow keys pick the next one there
    await press('.picker', 'Palette')
    expect((await panel())!.head).toBe('palette')
    await page.keyboard.press('ArrowRight')
    expect((await panel())!.head).toBe('post')
    await page.keyboard.press('Escape')
    // + level adds a level, picked as before, and opens nothing
    const levels = (await page.$$('.picker .chip.level')).length
    await press('.picker', '+ level')
    expect((await page.$$('.picker .chip.level')).length).toBe(levels + 1)
    expect(await panel()).toBe(null)
  }, 60_000)

  it("a knob focused, by a press or by Tab, opens the panel on its detail above its chip's knobs, and closing the panel drops the focus", async () => {
    await page.click(`.perform .knob[data-knob="${KNOB}"]`)
    expect(await panel()).toEqual({
      head: `${FIRST} › ${knobKind(KNOB).label}`,
      blocks: [`Level ${FIRST}`],
      detail: KNOB,
    })
    expect((await box('.context .knob-slot')).bottom).toBeLessThanOrEqual((await box('.context .group')).top)
    expect(await focused()).toEqual([KNOB])
    // another knob pressed in the panel takes the detail, and moves no knob
    const before = await box(`.context .knob[data-knob="${TURN}"]`)
    await page.click(`.context .knob[data-knob="${TURN}"]`)
    expect((await panel())!.detail).toBe(TURN)
    expect(await box(`.context .knob[data-knob="${TURN}"]`)).toEqual(before)
    // ✕ closes it and drops the focus
    await page.click('.context-head button')
    expect(await panel()).toBe(null)
    expect(await focused()).toEqual([])
    // a press there too on a panel opened by its chip, no knob moving
    await press('.picker', FIRST)
    const rest = await box(`.context .knob[data-knob="${TURN}"]`)
    await page.click(`.context .knob[data-knob="${TURN}"]`)
    expect((await panel())!.detail).toBe(TURN)
    expect(await box(`.context .knob[data-knob="${TURN}"]`)).toEqual(rest)
    // a look loaded drops the focus, and the detail goes with it
    await page.keyboard.press('1')
    await pause()
    expect(await panel()).toMatchObject({ head: FIRST, detail: 'no knob focused' })
    await page.keyboard.press('Escape')
    expect(await panel()).toBe(null)
    // by Tab: the strip's macros take no knob focus and open nothing, its first knob opens the panel
    const macros = STRIP.indexOf(KNOB)
    expect(await walk(macros)).toEqual(STRIP.slice(0, macros))
    expect(await panel()).toBe(null)
    expect(await walk(1)).toEqual([KNOB])
    expect(await panel()).toMatchObject({ head: `${FIRST} › ${knobKind(KNOB).label}`, detail: KNOB })
    // Enter types it in one field, on the strip where Tab is, and none in the panel; Esc leaves the field alone
    await page.keyboard.press('Enter')
    await page.waitForSelector('.knob-type')
    expect(await page.$$eval('.knob-type', (fields) => fields.map((f) => !!f.closest('.perform')))).toEqual([true])
    await page.keyboard.press('Escape')
    expect(await page.$('.knob-type')).toBe(null)
    expect(await panel()).toMatchObject({ detail: KNOB })
    // Esc closes it and drops the focus
    await page.keyboard.press('Escape')
    expect(await panel()).toBe(null)
    expect(await focused()).toEqual([])
  }, 60_000)

  it('a modulator chip pressed opens its editor alone in the panel and still drags onto a knob, and + adds a modulator and opens it', async () => {
    const [m] = t1.modulators
    await page.click('.picker .chip-mod')
    expect(await panel()).toMatchObject({ head: `modulator ${m.id}`, blocks: ['Modulators'] })
    const shown = () =>
      page.evaluate(() => ({
        mods: [...document.querySelectorAll('.context .mod .chip-mod')].map((el) => el.textContent),
        open: !!document.querySelector('.context .mod-row'),
        actions: [...document.querySelectorAll('.context .block-title .actions button')].map((el) => el.textContent),
      }))
    expect(await shown()).toEqual({ mods: [`⠿ ${m.id}`], open: true, actions: ['detune', '+ modulator'] })
    expect(await on()).toEqual([`⠿ ${m.id}`])
    // a press on its line closes and opens its editor
    await page.click('.context .mod-sum')
    expect((await shown()).open).toBe(false)
    await page.click('.context .mod-sum')
    expect((await shown()).open).toBe(true)
    // the row's chip dragged onto a strip knob it does not drive puts it on that knob
    const free = STRIP.find((a) => a.startsWith('levels') && !m.targets.some((t) => t.knob === a))!
    const targets = () => page.$$eval('.context .targets .target', (els) => els.length)
    const before = await targets()
    await page.evaluate((knob) => {
      const dt = new DataTransfer()
      const fire = (el: Element, type: string) =>
        el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }))
      fire(document.querySelector('.picker .chip-mod')!, 'dragstart')
      const target = document.querySelector(`.perform .knob[data-knob="${knob}"]`)!
      fire(target, 'dragover')
      fire(target, 'drop')
    }, free)
    await pause()
    expect(await targets()).toBe(before + 1)
    expect(await page.$eval(`.perform .knob[data-knob="${free}"]`, (el) => el.classList.contains('modulated'))).toBe(
      true,
    )
    // + adds one and opens it, and so does the block's + modulator
    const next = `mod${t1.modulators.length + 1}`
    await page.click('.picker > button[title="+ modulator"]')
    expect((await panel())!.head).toBe(`modulator ${next}`)
    expect(await shown()).toMatchObject({ mods: [`⠿ ${next}`], open: true })
    expect((await entries()).slice(-2)).toEqual([`⠿ ${next}`, '+'])
    expect(await on()).toEqual([`⠿ ${next}`])
    await press('.context .block-title', '+ modulator')
    const after = `mod${t1.modulators.length + 2}`
    expect(await shown()).toMatchObject({ mods: [`⠿ ${after}`], open: true })
    // its × drops it, and the panel closes with it
    await page.click('.context .mod-head > button')
    expect(await panel()).toBe(null)
    expect((await entries()).slice(-3)).toEqual([`⠿ ${t1.modulators.at(-1)!.id}`, `⠿ ${next}`, '+'])
  }, 60_000)

  it('Macros, Looks and ♪ open the macros, the looks and the bank to play from, and the music in the panel', async () => {
    await press('.picker', 'Macros')
    expect(await panel()).toMatchObject({ head: 'macros', blocks: ['Macros'] })
    expect(await visible('.context .macro-slider')).toBe(t1.macros.length)
    expect(await on()).toEqual(['Macros'])
    await press('.picker', 'Looks')
    expect(await panel()).toMatchObject({ head: 'looks and bank', blocks: ['Looks', 'Bank'] })
    expect(await on()).toEqual(['Looks'])
    // the looks' names and presets, the graph, autopilot and next ›
    expect(await visible('.context .look-name')).toBe(LOOKS.length)
    expect(await visible('.context .presets .link')).toBeGreaterThan(0)
    expect(await visible('.context .graph, .context .bank .hint')).toBe(2)
    const named = (text: string) =>
      page.evaluate(
        (text) =>
          [...document.querySelectorAll<HTMLElement>('.context button, .context label')].some(
            (el) => el.textContent?.trim() === text && el.checkVisibility(),
          ),
        text,
      )
    for (const text of ['autopilot', 'next ›']) expect(await named(text), text).toBe(true)
    // and none of the sheet's saving, files, deleting or the bank's management
    for (const text of [...LOOKS_SETUP, ...BANK_SETUP, '×']) expect(await named(text), text).toBe(false)
    expect(await visible('.context .preset-save, .context .bank .slide')).toBe(0)
    // a look loads from it
    await page.$$eval('.context .look-name', (els) => (els[2] as HTMLElement).click())
    await pause()
    expect(await page.$eval('.look-title', (el) => (el as HTMLInputElement).value)).toBe(LOOKS[2].name)
    await press('.bar', '♪')
    expect(await panel()).toMatchObject({ head: 'music', blocks: ['Music'] })
    expect(await on()).toEqual(['♪ song / mic'])
    expect(
      (
        await page.$$eval('.context .block-title .actions .mini', (els) => els.map((el) => el.textContent!.trim()))
      ).slice(0, 3),
    ).toEqual(['song', 'mic', 'tab'])
    // ♪ is the Stage's alone
    await page.keyboard.press('e')
    await page.waitForSelector('.app.edit')
    expect(await page.$$('.bar button[title^="the music"]')).toEqual([])
  }, 60_000)

  it("edge ▸ opens stagger and deep first in the panel, and they set the edge as the fader's own did", async () => {
    // the fader's depth bars, which the edge lays out
    const bars = () =>
      page.$$eval('.top svg.fader rect.span', (els) =>
        els.map((el) => `${el.getAttribute('x')} ${el.getAttribute('width')}`),
      )
    const at = await bars()
    await press('.top', 'edge ▸')
    expect(await panel()).toMatchObject({ head: 'the A/B edge', blocks: [] })
    expect(
      await page.$$eval('.context label', (els) => els.map((el) => [el.textContent, el.getAttribute('title')])),
    ).toEqual([
      ['stagger0.40', 'how far apart the depths morph: 0 all at once, 1 one after another'],
      ['deep first', 'morph the deepest levels first'],
    ])
    // the wheel turns the stagger, and the fader's bars move with it
    const slider = await box('.context .slide input')
    await page.mouse.move((slider.left + slider.right) / 2, (slider.top + slider.bottom) / 2)
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel({ deltaY: -100 })
      await pause(50)
    }
    await pause()
    expect(await page.$eval('.context .slide b', (el) => el.textContent)).toBe('0.50')
    const staggered = await bars()
    expect(staggered).not.toEqual(at)
    await page.click('.context .check input')
    expect(await page.$eval('.context .check input', (el) => (el as HTMLInputElement).checked)).toBe(true)
    expect(await bars()).not.toEqual(staggered)
    // the one edge, as Edit's fader shows it
    await page.evaluate(() => (document.activeElement as HTMLElement).blur())
    await page.keyboard.press('e')
    await page.waitForSelector('.rack .fader-panel')
    expect(
      await page.evaluate(() => [
        document.querySelector('.rack .fader-panel .slide b')!.textContent,
        document.querySelector<HTMLInputElement>('.rack .fader-panel .check input')!.checked,
      ]),
    ).toEqual(['0.50', true])
  }, 60_000)

  it("Tab walks the strip, then the panel's live knobs, each knob once, and Shift-Tab walks back", async () => {
    expect(await walk(STRIP.length)).toEqual(STRIP)
    // the panel opened on the strip's first knob, its live knobs on screen beside the strip's
    expect((await panel())!.head).toMatch(new RegExp(`^${FIRST} › `))
    const live = await page.$$eval('.context .knob[data-tab]', (els) => [
      ...new Set(els.filter((el) => el.checkVisibility()).map((el) => (el as HTMLElement).dataset.knob!)),
    ])
    const rest = live.filter((a) => !STRIP.includes(a))
    // the strip's later pages among them
    expect(rest.length).toBeGreaterThan(0)
    expect(live.filter((a) => STRIP.includes(a)).length).toBeGreaterThan(0)
    const round = await walk(rest.length + 1)
    expect(round).toEqual([...rest, STRIP[0]])
    expect(new Set([...STRIP, ...rest]).size).toBe(STRIP.length + rest.length)
    expect(await walk(2, true)).toEqual([rest.at(-1), rest.at(-2)])
    expect(await walk(rest.length - 2 + 1, true)).toEqual([...rest.slice(0, -2).reverse(), STRIP.at(-1)])
  }, 60_000)

  it('open, the panel keeps clear of the fader and the bottom deck, and every control of the bar, the fader and the deck shows whole at 1280x800', async () => {
    await seed(RIG)
    // each control shown in the bar, the fader and the deck: inside the window, not clipped by its panel, and not
    // under another panel (the one at its centre is its own)
    const whole = () =>
      page.evaluate(() => {
        const out: string[] = []
        for (const panel of document.querySelectorAll('.app > .bar, .app > section.top, .app > section.bottom')) {
          const own = panel.getBoundingClientRect()
          if (panel.scrollWidth > panel.clientWidth || panel.scrollHeight > panel.clientHeight)
            out.push(`${panel.className} overflows`)
          const controls = panel.querySelectorAll<HTMLElement>(
            'button, input, select, label, svg.fader, .knob, .hwpad, .hw-fader, .chip-mod',
          )
          for (const el of controls) {
            if (!el.checkVisibility()) continue
            const r = el.getBoundingClientRect()
            const name = `${el.tagName} ${el.textContent!.trim().slice(0, 20)}`
            if (r.left < own.left || r.right > own.right || r.top < own.top || r.bottom > own.bottom)
              out.push(`${name} leaves its panel`)
            if (r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight)
              out.push(`${name} off screen`)
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
            if (!hit || !panel.contains(hit)) out.push(`${name} under ${hit?.className}`)
          }
        }
        return out
      })
    const clear = async () => {
      const panel = await box('.context')
      for (const s of ['.app > section.top', '.app > section.bottom']) {
        const r = await box(s)
        expect(Math.round(panel.left - r.right), s).toBe(10)
      }
    }
    expect(await whole()).toEqual([])
    // the panel open on a chip with a knob focused, on the looks, the music and the edge, and in map mode
    await page.click(`.perform .knob[data-knob="${KNOB}"]`)
    await clear()
    expect(await whole()).toEqual([])
    for (const open of [() => press('.picker', 'Looks'), () => press('.bar', '♪'), () => press('.top', 'edge ▸')]) {
      await open()
      await clear()
      expect(await whole()).toEqual([])
    }
    await page.keyboard.press('m')
    await clear()
    expect(await whole()).toEqual([])
    // the panel itself inside the window, under the bar
    const panel = await box('.context')
    expect(panel).toMatchObject({ right: 1270, top: 58, bottom: 790 })
    expect(panel.left).toBe(910)
  }, 60_000)

  it('the panel keeps what it shows through Edit, Decks and Direct and back', async () => {
    const [m] = t1.modulators
    for (const [open, head, key, view] of [
      [() => page.click('.picker .chip-mod'), `modulator ${m.id}`, 'e', 'edit'],
      [() => press('.picker', 'Macros'), 'macros', 'd', 'decks'],
      [() => press('.picker', 'Looks'), 'looks and bank', 't', 'direct'],
      [() => press('.picker', t1.levels[1].id), t1.levels[1].id, 'e', 'edit'],
    ] as const) {
      await open()
      expect((await panel())!.head).toBe(head)
      await page.keyboard.press(key)
      await page.waitForSelector(`.app.${view}`)
      expect(await page.$$('.context')).toEqual([])
      await page.keyboard.press(key)
      await page.waitForSelector('.app.stage .perform')
      expect((await panel())!.head).toBe(head)
    }
    // the modulator's editor with it
    await page.click('.picker .chip-mod')
    await page.keyboard.press('d')
    await page.waitForSelector('.app.decks')
    await page.keyboard.press('d')
    await page.waitForSelector('.app.stage .context')
    expect(await page.$$eval('.context .mod-row', (els) => els.length)).toBeGreaterThan(0)
  }, 60_000)

  it('undocked, the play surface is in the controls window, and a chip pressed there opens the panel there', async () => {
    const before = new Set(browser.targets())
    await page.keyboard.press('u')
    const target = await browser.waitForTarget((t) => !before.has(t) && t.type() === 'page', { timeout: 10_000 })
    const popup = (await target.page())!
    await popup.setViewport({ width: 1280, height: 800 })
    await popup.waitForSelector('.picker .chip')
    expect(await entries(popup)).toEqual(PICKER)
    for (const s of [
      '.app > section.top .fader-row',
      '.app > section.bottom .perform',
      '.app > section.bottom .pads-row',
    ])
      expect(await visible(s, popup), s).toBe(1)
    expect(await page.$$('.picker, .perform, section.top')).toEqual([])
    const second = t1.levels[1].id
    await press('.picker', second, popup)
    expect(await panel(popup)).toMatchObject({ head: second, blocks: [`Level ${second}`] })
    expect(await page.$$('.context')).toEqual([])
    // the panel keeps clear of the deck there too
    const [deck, open] = await popup.evaluate(() =>
      ['.app > section.bottom', '.context'].map((s) => document.querySelector(s)!.getBoundingClientRect().toJSON()),
    )
    expect(Math.round(open.left - deck.right)).toBe(10)
    // a strip knob pressed there shows its detail there, and Esc there closes it
    await popup.click(`.perform .knob[data-knob="${KNOB}"]`)
    expect((await panel(popup))!.detail).toBe(KNOB)
    await popup.keyboard.press('Escape')
    expect(await panel(popup)).toBe(null)
    await popup.close()
  }, 60_000)
})
