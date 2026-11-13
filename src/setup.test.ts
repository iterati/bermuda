// The setup sheet, the app itself in headless Chrome at 1280x800, on Tapestry 1: G or ⚙ setup opens it on its MIDI
// page over Stage, Edit or Decks, and G, ⚙, ✕ close or Esc closes it, Esc cancelling a learning first. Its pages hold
// the MIDI block, the Looks block, the bank's management and the pair's files; the Stage keeps the looks and the bank
// to play from, Edit and Decks lose the MIDI block alone, and the fader its pair files. Direct and Play open no sheet.
// The keys hint shows behind ?. Undocked, the sheet opens in the controls window.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { BANK, LOOKS } from './looks'
import type { Bank } from './scene'

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
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.waitForSelector('.knob', { timeout: 55_000 })
}, 60_000)

const pause = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const SETUP = '.bar button[title^="setup"]'
const HELP = '.bar .help'
// the sheet's open page, or null with the sheet closed; and whether ⚙ setup is on
const sheet = (p: Page = page) =>
  p.evaluate(() => ({
    page: document.querySelector('.setup-sheet') && document.querySelector('.setup-nav button.on')?.textContent,
    on: document.querySelector('.bar button[title^="setup"]')?.classList.contains('on'),
  }))
// a button or label of a panel by its text, if it shows
const named = (within: string, text: string) =>
  page.evaluate(
    (within, text) =>
      [...document.querySelectorAll<HTMLElement>(`${within} button, ${within} label`)].some(
        (el) => el.textContent?.trim() === text && el.checkVisibility(),
      ),
    within,
    text,
  )
// each named button or label of a panel, whether it shows
const has = async (within: string, texts: string[]) =>
  Object.fromEntries(await Promise.all(texts.map(async (t) => [t, await named(within, t)])))
const every = (texts: string[], shown: boolean) => Object.fromEntries(texts.map((t) => [t, shown]))
// a page of the sheet, by its button
const open = (name: string) =>
  page.evaluate((name) => {
    ;[...document.querySelectorAll<HTMLButtonElement>('.setup-nav button')].find((b) => b.textContent === name)!.click()
  }, name)
const tab = (name: string) =>
  page.evaluate((name) => {
    ;[...document.querySelectorAll<HTMLButtonElement>('.tabs button')].find((b) => b.textContent === name)!.click()
  }, name)
// the blocks' titles in a panel, in order
const titles = (within: string) =>
  page.$$eval(`${within} .block-title > span:first-child`, (els) => els.map((el) => el.textContent))
const LOOKS_SETUP = ['save look', 'export', 'import', '+ preset']
const BANK_SETUP = ['+ add', '− remove', 'export', 'import', 'deep first']
const SLIDES = ['pace', 'busy', 'change', 'wander', 'length', 'stagger']
// the Bank block's slides, by label
const slides = (within: string) =>
  page.$$eval(`${within} .bank .slide > span`, (els) =>
    els.filter((el) => el.checkVisibility()).map((el) => el.textContent),
  )

describe('the setup sheet', () => {
  it('G opens the setup sheet on its MIDI page, and ⚙ setup too; G, ⚙, ✕ close and Esc close it', async () => {
    const closed = { page: null, on: false }
    expect(await sheet()).toEqual(closed)
    await page.keyboard.press('g')
    expect(await sheet()).toEqual({ page: 'MIDI', on: true })
    await page.keyboard.press('G')
    expect(await sheet()).toEqual(closed)
    await page.click(SETUP)
    expect(await sheet()).toEqual({ page: 'MIDI', on: true })
    await page.click(SETUP)
    expect(await sheet()).toEqual(closed)
    // opened on another page, it opens on MIDI again
    await page.keyboard.press('g')
    await open('Bank')
    expect(await sheet()).toEqual({ page: 'Bank', on: true })
    await page.click('.setup-nav button[title="Esc"]')
    expect(await sheet()).toEqual(closed)
    await page.click(SETUP)
    expect(await sheet()).toEqual({ page: 'MIDI', on: true })
    await page.keyboard.press('Escape')
    expect(await sheet()).toEqual(closed)
    // not with Ctrl or Cmd held
    for (const held of ['Control', 'Meta'] as const) {
      await page.keyboard.down(held)
      await page.keyboard.press('g')
      await page.keyboard.up(held)
      expect(await sheet()).toEqual(closed)
    }
  }, 60_000)

  it("the sheet's pages: MIDI the MIDI block, Looks the Looks block, Bank the bank's management, Files the pair's files", async () => {
    await page.keyboard.press('g')
    expect(await page.$$eval('.setup-nav > *', (els) => els.map((el) => el.textContent))).toEqual([
      'Setup',
      'MIDI',
      'Looks',
      'Bank',
      'Files',
      '✕ close',
    ])
    expect(await titles('.setup-body')).toEqual(['MIDI'])
    expect(await has('.setup-body', ['learn the strip', 'MIDI learn'])).toEqual(
      every(['learn the strip', 'MIDI learn'], true),
    )
    expect(await page.$('.setup-body .midi-buttons select')).not.toBe(null)
    await open('Looks')
    expect(await titles('.setup-body')).toEqual(['Looks'])
    expect(await has('.setup-body', LOOKS_SETUP)).toEqual(every(LOOKS_SETUP, true))
    expect(await page.$$eval('.setup-body .look-name', (els) => els.length)).toBe(LOOKS.length)
    await open('Bank')
    expect(await titles('.setup-body')).toEqual(['Bank'])
    expect(await has('.setup-body', BANK_SETUP)).toEqual(every(BANK_SETUP, true))
    expect(await slides('.setup-body')).toEqual(SLIDES)
    // what is played stays where the bank is played
    expect(await has('.setup-body', ['autopilot', 'next ›'])).toEqual(every(['autopilot', 'next ›'], false))
    expect(await page.$$('.setup-body .graph, .setup-body .hint')).toEqual([])
    await open('Files')
    expect(await titles('.setup-body')).toEqual(['Files'])
    expect(await has('.setup-body', ['export pair', 'import pair'])).toEqual(
      every(['export pair', 'import pair'], true),
    )
    expect(await page.$eval('.setup-body .panel-block > .dim', (el) => el.textContent)).toBe(
      "this look's files are in Looks, the bank's in Bank; Direct keeps the timeline's and the video's.",
    )
  }, 60_000)

  it("the Stage has no MIDI tab, and its Bank tab keeps the looks and the bank to play from, without saving, files, deleting or the bank's management", async () => {
    expect(await page.$$eval('.tabs button', (els) => els.map((el) => el.textContent))).toEqual([
      'Music',
      'Motion',
      'Macros',
      'Bank',
    ])
    // a look saved, and a preset on it, so the whole block would show their ×s
    await page.keyboard.press('p')
    await page.keyboard.press('s')
    await tab('Bank')
    const right = '.stage .right'
    expect(await titles(right)).toEqual(['Looks', 'Bank'])
    expect(await page.$$eval(`${right} .look-name`, (els) => els.length)).toBe(LOOKS.length)
    expect(await page.$$(`${right} .presets .link`)).not.toEqual([])
    expect(await has(right, [...LOOKS_SETUP, ...BANK_SETUP, '×'])).toEqual(
      every([...LOOKS_SETUP, ...BANK_SETUP, '×'], false),
    )
    expect(await page.$$(`${right} .preset-save, ${right} .actions`)).toEqual([])
    expect(await slides(right)).toEqual([])
    expect(await has(right, ['autopilot', 'next ›'])).toEqual(every(['autopilot', 'next ›'], true))
    expect(await page.$$eval(`${right} .graph, ${right} .bank .hint`, (els) => els.length)).toBe(2)
    // a look and a preset load from it
    await page.evaluate(() => document.querySelectorAll<HTMLButtonElement>('.stage .right .look-name')[2].click())
    await pause()
    expect(await page.$eval('.look-title', (el) => (el as HTMLInputElement).value)).toBe(LOOKS[2].name)
    const other = LOOKS.findIndex((l, i) => i > 0 && i !== 2 && l.presets.length)
    await page.evaluate(
      (i) =>
        document.querySelectorAll('.stage .right ol.looks > li')[i].querySelector<HTMLButtonElement>('.link')!.click(),
      other,
    )
    await pause()
    expect(await page.$eval('.look-title', (el) => (el as HTMLInputElement).value)).toBe(LOOKS[other].name)
    // and the ×s are in the sheet's Looks
    await page.keyboard.press('1')
    await page.keyboard.press('g')
    await open('Looks')
    // the saved look's, and each of its presets', the one added too
    expect(await page.$$eval('.setup-body button', (els) => els.filter((el) => el.textContent === '×').length)).toBe(
      LOOKS[0].presets.length + 2,
    )
  }, 60_000)

  it('Edit and Decks have no MIDI block, keep their Looks and Bank blocks, and open the sheet with G', async () => {
    for (const [key, view, panel] of [
      ['e', 'edit', '.rack'],
      ['d', 'decks', '.deck-column.b > aside'],
    ] as const) {
      await page.keyboard.press(key)
      await page.waitForSelector(`.app.${view} .knob`)
      const blocks = await titles(panel)
      expect(blocks).not.toContain('MIDI')
      expect(blocks).toEqual(expect.arrayContaining(['Looks', 'Bank']))
      expect(await has(panel, [...LOOKS_SETUP, ...BANK_SETUP, 'autopilot', 'next ›'])).toEqual(
        every([...LOOKS_SETUP, ...BANK_SETUP, 'autopilot', 'next ›'], true),
      )
      expect(await slides(panel)).toEqual(SLIDES)
      expect(await page.$$(`${panel} .graph`)).toHaveLength(1)
      await page.keyboard.press('g')
      expect(await sheet()).toEqual({ page: 'MIDI', on: true })
      expect(await page.$(`.app.${view} > .setup-sheet`)).not.toBe(null)
      expect(await titles('.setup-body')).toEqual(['MIDI'])
      await page.keyboard.press('g')
      expect(await sheet()).toEqual({ page: null, on: false })
      await page.keyboard.press(key)
      await page.waitForSelector('.app.stage .knob')
    }
  }, 60_000)

  it('the fader has no pair files, and a pair imported from the sheet loads', async () => {
    expect(await has('.fader-panel', ['export pair', 'import pair'])).toEqual(
      every(['export pair', 'import pair'], false),
    )
    expect(await has('.fader-panel', ['⇄ swap', 'copy to B'])).toEqual(every(['⇄ swap', 'copy to B'], true))
    const [a, b] = [LOOKS[2], LOOKS[3]]
    const file = join(tmpdir(), 'setup-pair.json')
    writeFileSync(file, JSON.stringify({ a, b, at: 0.25, edge: { seconds: 2, stagger: 0.7, deepFirst: true } }))
    await page.keyboard.press('g')
    await open('Files')
    const input = (await page.$('.setup-body input[type=file]'))!
    await input.uploadFile(file)
    await page.waitForFunction(
      (name) => document.querySelector('.fader-panel .side span')?.textContent === name,
      {},
      a.name,
    )
    expect(
      await page.evaluate(() => ({
        sides: [...document.querySelectorAll('.fader-panel .side span')].map((el) => el.textContent),
        at: document.querySelector('.fader-at')?.textContent,
        stagger: document.querySelector('.fader-panel .slide b')?.textContent,
        error: document.querySelector('.error'),
      })),
    ).toEqual({ sides: [a.name, b.name], at: '25%', stagger: '0.70', error: null })
  }, 60_000)

  it('Esc while a control learns cancels the learning and leaves the sheet open', async () => {
    await page.keyboard.press('g')
    const strip = '.setup-body button[title^="map the next 8 encoders"]'
    await page.click(strip)
    expect(await page.$eval(strip, (el) => el.textContent)).toBe('turn an encoder…')
    // the learning line is under the bar, not in the sheet
    expect(await page.$eval('.app > .midi-learning span', (el) => el.textContent)).toBe('turn the encoder for slot 1')
    expect(await page.$('.setup-body .midi-learning')).toBe(null)
    await page.keyboard.press('Escape')
    expect(await page.$('.midi-learning')).toBe(null)
    expect(await page.$eval(strip, (el) => el.textContent)).toBe('learn the strip')
    expect(await sheet()).toEqual({ page: 'MIDI', on: true })
    await page.keyboard.press('Escape')
    expect(await sheet()).toEqual({ page: null, on: false })
  }, 60_000)

  it("the sheet's Bank page turns the autopilot's handles and leaves the bank's entries and links as they are", async () => {
    await page.keyboard.press('g')
    await open('Bank')
    const busy = () =>
      page.evaluate(() => {
        const input = [...document.querySelectorAll<HTMLInputElement>('.setup-body input[type=range]')].find((el) =>
          el.closest('label')?.textContent?.startsWith('busy'),
        )!
        input.scrollIntoView({ block: 'center' })
        const r = input.getBoundingClientRect()
        return { value: input.valueAsNumber, x: r.x + r.width / 2, y: r.y + r.height / 2 }
      })
    const { value, x, y } = await busy()
    expect(value).toBe(BANK.autopilot.busy)
    await page.mouse.move(x, y)
    await page.mouse.wheel({ deltaY: -100 })
    await pause()
    expect((await busy()).value).toBeCloseTo(value + 0.01, 6)
    await page.evaluate(() =>
      [...document.querySelectorAll<HTMLLabelElement>('.setup-body label.check')]
        .find((el) => el.textContent?.trim() === 'deep first')!
        .click(),
    )
    await pause()
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('bermuda.bank')!) as Bank)
    expect(kept.autopilot.busy).toBeCloseTo(BANK.autopilot.busy + 0.01, 6)
    expect(kept.autopilot.edge.deepFirst).toBe(!BANK.autopilot.edge.deepFirst)
    expect({ scenes: kept.scenes, links: kept.links }).toEqual({ scenes: BANK.scenes, links: BANK.links })
    expect({ ...kept, autopilot: BANK.autopilot }).toEqual(BANK)
  }, 60_000)

  it('? shows the keys and hides them again, in Stage and in Direct, and the Stage keys name G setup', async () => {
    // the keys whole on screen, if they show
    const keys = () =>
      page.evaluate(() => {
        const el = document.querySelector<HTMLElement>('.keys')
        if (!el?.checkVisibility()) return null
        const r = el.getBoundingClientRect()
        const whole =
          el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight && r.left >= 0 && r.right <= innerWidth
        return { text: el.textContent, whole, panel: el.matches('.panel'), under: r.top >= 50 }
      })
    expect(await keys()).toBe(null)
    expect(await page.$$('.bar .keys')).toEqual([])
    expect(await page.$eval(HELP, (el) => [el.textContent, el.getAttribute('title')])).toEqual(['?', 'the keys'])
    await page.click(HELP)
    const stage = await keys()
    expect(stage).toMatchObject({ whole: true, panel: true, under: true })
    expect(stage!.text).toMatch(/^H hides · Tab live knobs · Enter types · /)
    expect(stage!.text).toContain('M map (on a focused knob: learn it) · G setup · S save')
    expect(stage!.text).toContain('F play · U undock · O autopilot')
    await page.click(HELP)
    expect(await keys()).toBe(null)
    await page.keyboard.press('t')
    await page.waitForSelector('.app.direct')
    expect(await page.$eval(HELP, (el) => el.checkVisibility())).toBe(true)
    expect(await page.$eval(SETUP, (el) => el.checkVisibility())).toBe(false)
    await page.click(HELP)
    const direct = await keys()
    expect(direct).toMatchObject({ whole: true, panel: true, under: true })
    expect(direct!.text).toMatch(/^H hides · Space play · Home rewinds · /)
    expect(direct!.text).toContain('U undock · T or Esc to Stage')
    await page.click(HELP)
    expect(await keys()).toBe(null)
  }, 60_000)

  it('G opens no sheet in Direct or Play, and going to Direct or Play closes it', async () => {
    const none = { page: null, on: false }
    for (const [key, view] of [
      ['t', 'direct'],
      ['f', 'play'],
    ] as const) {
      await page.keyboard.press(key)
      await page.waitForSelector(`.app.${view}`)
      await page.keyboard.press('g')
      await pause()
      expect(await page.$('.setup-sheet')).toBe(null)
      await page.keyboard.press('Escape')
      await page.waitForSelector('.app.stage .knob')
      expect(await sheet()).toEqual(none)
      // open, it closes on the way there
      await page.keyboard.press('g')
      expect(await sheet()).toEqual({ page: 'MIDI', on: true })
      await page.keyboard.press(key)
      await page.waitForSelector(`.app.${view}`)
      expect(await page.$('.setup-sheet')).toBe(null)
      await page.keyboard.press('Escape')
      await page.waitForSelector('.app.stage .knob')
      expect(await sheet()).toEqual(none)
    }
  }, 60_000)

  it('undocked, G and ⚙ setup open the sheet in the controls window, and the main window keeps the picture alone', async () => {
    const before = new Set(browser.targets())
    await page.keyboard.press('u')
    const target = await browser.waitForTarget((t) => !before.has(t) && t.type() === 'page', { timeout: 10_000 })
    const popup = (await target.page())!
    await popup.setViewport({ width: 1280, height: 800 })
    await popup.waitForSelector('.knob')
    const showing = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.app > *')]
          .filter((el) => el.checkVisibility())
          .map((el) => el.className),
      )
    await popup.keyboard.press('g')
    expect(await sheet(popup)).toEqual({ page: 'MIDI', on: true })
    expect(await popup.$eval('body > .app > .setup-sheet', (el) => getComputedStyle(el).position)).toBe('absolute')
    expect(await page.$('.setup-sheet')).toBe(null)
    expect(await showing()).toEqual(['picture'])
    await popup.keyboard.press('g')
    expect(await sheet(popup)).toEqual({ page: null, on: false })
    await popup.click(SETUP)
    expect(await sheet(popup)).toEqual({ page: 'MIDI', on: true })
    expect(await page.$('.setup-sheet')).toBe(null)
    expect(await showing()).toEqual(['picture'])
    // G pressed in the main window toggles the sheet where the UI is
    await page.bringToFront()
    await page.keyboard.press('g')
    expect(await sheet(popup)).toEqual({ page: null, on: false })
    await popup.close()
  }, 60_000)
})
