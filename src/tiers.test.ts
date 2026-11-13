// The tiers of the Stage's context panel, the app itself in headless Chrome at 1280x800, on Tapestry 1, with a fake
// controller: the panel on a chip shows its live knobs first, in the chip's order, those on the strip's page tagged
// with their encoder, and the whole chip one press away, its idle knobs dimmed in place and its off ones behind off N,
// greyed with why and not turned, focused, typed or modulated by a hand. An idle knob turned is live until a look is
// loaded. Edit's Rack and Decks' section keep their +N and their knobs as they were.
import { execFileSync } from 'node:child_process'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { LOOKS } from './looks'
import {
  allLevels,
  CHIPS,
  chipKnobs,
  folded,
  knobKind,
  knobsOf,
  liveKnob,
  strip,
  type Controls,
  type KnobAt,
  type Scene,
} from './scene'

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
// the strip's first page, by knob address or macro id
const PAGE = strip(t1, FIRST)
  .slice(0, 8)
  .map((t) => ('knob' in t ? t.knob : t.macro))
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
// a knob dead under the scene's settings, by its kind's rule
const isOff = (s: Scene, at: KnobAt) => knobKind(at.address).shows?.(s, at) === false
// a chip's knobs by tier, on a look as loaded: live, idle and off, each in the chip's order
const tiers = (s: Scene, chip: string) => {
  const knobs = chipKnobs(s, chip)
  const live = knobs.filter((at) => liveKnob(s, at, strip(s, chip), new Set()))
  const off = knobs.filter((at) => isOff(s, at))
  const idle = knobs.filter((at) => !live.includes(at) && !off.includes(at))
  return { live: live.map((k) => k.address), idle: idle.map((k) => k.address), off: off.map((k) => k.address) }
}
// the look with the most off knobs, and its chip with the most of them
const MOST = LOOKS.reduce((a, b) =>
  knobsOf(b).filter((at) => isOff(b, at)).length > knobsOf(a).filter((at) => isOff(a, at)).length ? b : a,
)
const MOST_CHIP = [...CHIPS, ...allLevels(MOST.levels).map(({ level }) => level.id)].reduce((a, b) =>
  tiers(MOST, b).off.length > tiers(MOST, a).off.length ? b : a,
)

// the fixed parts' chips as the picker row names them
const CHIP_NAMES: Record<string, string> = {
  background: 'Background',
  frame: 'Frame',
  contour: 'Contour',
  line: 'Line',
  palette: 'Palette',
  post: 'Composite',
}

const pause = (ms = 200) => new Promise((r) => setTimeout(r, ms))
async function seed(controls: Controls) {
  await page.evaluate((c) => localStorage.setItem('bermuda.midi', JSON.stringify(c)), controls)
  await page.reload()
  await page.waitForSelector('.knob', { timeout: 55_000 })
}
// a button or modulator chip, by where it is and how its shown text starts, pressed as a hand would
async function press(within: string, text: string) {
  for (const b of await page.$$(`${within} button, ${within} .chip-mod`))
    if (
      await b.evaluate(
        (el, text) => (el as HTMLElement).innerText.trim().startsWith(text) && el.checkVisibility(),
        text,
      )
    )
      return b.click()
  throw new Error(`no ${within} button ${text}`)
}
const knob = (address: string, within = '.context') => `${within} .knob[data-knob="${address}"]`
// the shown knobs a selector finds, by address
const addresses = (selector: string) =>
  page.$$eval(selector, (els) =>
    els.filter((el) => el.checkVisibility()).map((el) => (el as HTMLElement).dataset.knob!),
  )
// the live block: its head, its knobs with their labels and encoder tags, the way to the whole chip, and the
// chip's groups shown
const live = () =>
  page.evaluate(() => {
    const c = document.querySelector('.context')!
    return {
      head: c.querySelector('.live-head')!.textContent,
      knobs: [...c.querySelectorAll<HTMLElement>('.live-row .knob')].map((el) => ({
        at: el.dataset.knob,
        label: el.querySelector('.knob-label')!.textContent,
        tag: el.querySelector('.enc-tag')?.textContent,
        title: el.querySelector('.enc-tag')?.getAttribute('title'),
      })),
      toggle: c.querySelector('.all-toggle')!.textContent,
      groups: [...c.querySelectorAll('.group-title > :first-child')].map((el) => el.textContent),
    }
  })
const way = (s: Scene, chip: string, open = false) => {
  const { idle, off } = tiers(s, chip)
  return `${open ? '▾' : '▸'} the whole chip: ${idle.length} idle, ${off.length} off, its menus and buttons`
}
// the value a knob shows, and whether it is focused, modulated or typed
const state = (selector: string) =>
  page.$eval(selector, (el) => ({
    value: el.querySelector('.knob-value')?.textContent,
    focused: el.classList.contains('focused'),
    modulated: el.classList.contains('modulated'),
    typed: !!document.querySelector('.knob-type'),
  }))
// the value a knob shows once it is no longer from, as the live scene shows it a frame or more late, or as it is
// after a few seconds
async function moved(selector: string, from: string | null | undefined) {
  let value = from
  for (const end = Date.now() + 5000; Date.now() < end && value === from; await pause(50))
    value = (await state(selector)).value
  return value
}
const centre = (selector: string) =>
  page.$eval(selector, (el) => {
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
// the knob or macro the browser's focus is on
const on = () =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement
    return el.dataset.knob ?? el.dataset.macro ?? el.tagName
  })
// the whole chip opened, and every off N in it
async function whole() {
  await page.click('.context .all-toggle')
  for (const fold of await page.$$('.context .fold.off')) await fold.click()
}

describe('the tiers', () => {
  it("the panel on a chip shows its live knobs first, in the chip's order, those on the strip tagged with their encoder, and the whole chip one press away", async () => {
    await seed(RIG)
    await press('.picker', FIRST)
    const { live: lives } = tiers(t1, FIRST)
    expect(lives.length).toBeGreaterThan(PAGE.filter((a) => a.startsWith('levels')).length)
    const shown = await live()
    expect(shown.head).toBe(`live ${lives.length} · in the chip's order`)
    // labelled as the strip labels them, those on its page tagged with their encoder
    expect(shown.knobs).toEqual(
      lives.map((at) => {
        const n = PAGE.indexOf(at) + 1
        return {
          at,
          label: knobKind(at).label,
          tag: n ? `E${n}` : undefined,
          title: n ? `on the strip: encoder ${n}, Tab reaches it there` : undefined,
        }
      }),
    )
    for (const at of PAGE.filter((a) => a.startsWith('levels')))
      expect(await page.$eval(knob(at, '.perform'), (el) => el.querySelector('.knob-label')!.textContent)).toBe(
        knobKind(at).label,
      )
    expect(shown.knobs.some((k) => k.tag)).toBe(true)
    expect(shown.knobs.some((k) => !k.tag)).toBe(true)
    // the detail's slot above them, the whole chip closed under them
    expect(await page.$eval('.context .knob-slot', (el) => el.textContent)).toBe('no knob focused')
    expect(shown.toggle).toBe(way(t1, FIRST))
    expect(shown.groups).toEqual([])
    // one press opens it, its menus and buttons with it, and another closes it
    await page.click('.context .all-toggle')
    expect(await live()).toMatchObject({ toggle: way(t1, FIRST, true), groups: [`Level ${FIRST}`] })
    expect(await page.$$eval('.context .group select', (els) => els.length)).toBeGreaterThan(0)
    await page.click('.context .all-toggle')
    expect((await live()).groups).toEqual([])
    // open, it stays so while the chip and the focus change
    await page.click('.context .all-toggle')
    const second = t1.levels[1].id
    await press('.picker', second)
    expect(await live()).toMatchObject({ toggle: way(t1, second, true), groups: [`Level ${second}`] })
    await page.click(knob((await live()).knobs[0].at!))
    expect(await page.$eval('.context .knob-slot .detail code', (el) => el.textContent)).toBe(
      (await live()).knobs[0].at,
    )
    expect((await live()).groups).toEqual([`Level ${second}`])
    // and closed when the panel turns to the chip from another view, and from closed
    await press('.picker', 'Macros')
    await press('.picker', second)
    expect((await live()).groups).toEqual([])
    await page.click('.context .all-toggle')
    await page.keyboard.press('Escape')
    expect(await page.$('.context')).toBe(null)
    // more ▸ opens this view too
    await page.click('.perform-side button[title="every knob of the picked chip"]')
    expect(await live()).toMatchObject({ toggle: way(t1, second), groups: [] })
  }, 60_000)

  it('the whole chip shows its idle knobs dimmed in place and its off ones behind off N, as many as the head says', async () => {
    await press('.picker', FIRST)
    const { live: lives, idle, off } = tiers(t1, FIRST)
    expect(idle.length).toBeGreaterThan(0)
    expect(off.length).toBeGreaterThan(0)
    await page.click('.context .all-toggle')
    const group = '.context .group'
    // the idle ones in their place, dimmed, and the live ones as they are
    expect(await addresses(`${group} .knob.idle`)).toEqual(expect.arrayContaining(idle))
    expect((await addresses(`${group} .knob.idle`)).length).toBe(idle.length)
    expect(await page.$eval(`${group} .knob.idle`, (el) => getComputedStyle(el).opacity)).toBe('0.45')
    for (const at of await addresses(`${group} .knob:not(.idle)`)) expect(lives).toContain(at)
    // the off ones folded behind off N at their rows' ends, dashed, titled with each one's label and why; no +N
    const folds = await page.$$eval(`${group} .fold`, (els) =>
      els.map((el) => ({
        text: el.textContent!,
        title: el.getAttribute('title')!,
        off: el.classList.contains('off'),
        last: el.nextElementSibling === null || el.nextElementSibling.matches('.dice'),
        dashed: getComputedStyle(el).borderStyle,
      })),
    )
    expect(folds.length).toBeGreaterThan(0)
    for (const f of folds) expect(f).toMatchObject({ text: expect.stringMatching(/^off \d+$/), off: true, last: true })
    expect(folds[0].dashed).toBe('dashed')
    expect(folds.reduce((n, f) => n + Number(f.text.slice(4)), 0)).toBe(off.length)
    expect(folds.flatMap((f) => f.title.split(' · ')).sort()).toEqual(
      off.map((at) => `${knobKind(at).label}: ${knobKind(at).off}`).sort(),
    )
    expect(await page.$$(`${group} .knob.off`)).toEqual([])
    // opened, each off one greyed in its place with its why under its label
    for (const fold of await page.$$(`${group} .fold.off`)) await fold.click()
    expect((await addresses(`${group} .knob.off`)).sort()).toEqual([...off].sort())
    expect(await page.$$eval(`${group} .knob.off .knob-why`, (els) => els.map((el) => el.textContent))).toEqual(
      (await addresses(`${group} .knob.off`)).map((at) => knobKind(at).off),
    )
    expect(await page.$$eval(`${group} .fold.off`, (els) => els.map((el) => el.textContent))).toEqual(
      folds.map(() => '−'),
    )
    // the rows in their order, as Edit's Rack has them with its folds open: no sort by tier
    const order = await addresses(`${group} .knob`)
    await page.keyboard.press('e')
    await page.waitForSelector('.rack .knob')
    for (const fold of await page.$$('.rack-section.picked .fold')) await fold.click()
    expect(await addresses('.rack-section.picked .knob')).toEqual(order)
  }, 60_000)

  it('an off knob shows greyed with why it is off, and the wheel, a press, Enter, a double-click and a modulator dropped on it change nothing', async () => {
    const { off } = tiers(MOST, MOST_CHIP)
    expect(off.length).toBeGreaterThan(1)
    // the look with the most off knobs, from the looks in the panel, with a modulator to drop
    await press('.picker', 'Looks')
    await page.$$eval(
      '.context .look-name',
      (els, name) => (els.find((el) => el.textContent!.includes(name)) as HTMLElement).click(),
      MOST.name,
    )
    await pause()
    expect(await page.$eval('.look-title', (el) => (el as HTMLInputElement).value)).toBe(MOST.name)
    if (!MOST.modulators.length) await page.click('.picker > button[title="+ modulator"]')
    await press('.picker', CHIP_NAMES[MOST_CHIP] ?? MOST_CHIP)
    await page.waitForSelector('.context .all-toggle')
    expect((await live()).toggle).toBe(way(MOST, MOST_CHIP))
    await whole()
    expect((await addresses('.context .knob.off')).sort()).toEqual([...off].sort())
    const at = off[0]
    const sel = knob(at)
    const kind = knobKind(at)
    // greyed, with its why, titled with it and its address, and never a stop of Tab's walk
    expect(
      await page.$eval(sel, (el) => ({
        why: el.querySelector('.knob-why')!.textContent,
        title: el.getAttribute('title')!.split('\n'),
        tab: el.hasAttribute('data-tab'),
        opacity: getComputedStyle(el).opacity,
        filter: getComputedStyle(el).filter,
      })),
    ).toEqual({
      why: kind.off,
      title: [`${kind.label}: off, ${kind.off}`, at],
      tab: false,
      opacity: '0.3',
      filter: 'grayscale(1)',
    })
    const before = await state(sel)
    expect(before).toMatchObject({ focused: false, modulated: false, typed: false })
    // the wheel, down and up, so one way would move it from either end, and the live scene's late frames past
    const { x, y } = await centre(sel)
    await page.mouse.move(x, y)
    for (const deltaY of [100, -100]) {
      for (let i = 0; i < 3; i++) {
        await page.mouse.wheel({ deltaY })
        await pause(100)
      }
      await pause(1000)
      expect(await state(sel)).toEqual(before)
    }
    // a press, which focuses nothing, then Enter, and a double-click
    await page.mouse.click(x, y)
    await pause()
    expect(await state(sel)).toEqual(before)
    expect(await page.$eval('.context .knob-slot', (el) => el.textContent)).toBe('no knob focused')
    await page.keyboard.press('Enter')
    await pause()
    expect(await state(sel)).toEqual(before)
    await page.mouse.click(x, y, { clickCount: 2 })
    await pause()
    expect(await state(sel)).toEqual(before)
    // a modulator dropped on it
    await page.evaluate((sel) => {
      const dt = new DataTransfer()
      const fire = (el: Element, type: string) =>
        el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }))
      fire(document.querySelector('.picker .chip-mod')!, 'dragstart')
      const target = document.querySelector(sel)!
      fire(target, 'dragover')
      fire(target, 'drop')
    }, sel)
    await pause()
    expect(await state(sel)).toEqual(before)
    // Tab's walk round every stop never lands on it
    const stops = await page.$$eval('[data-tab]', (els) => els.length)
    for (let i = 0; i <= stops; i++) {
      await page.keyboard.press('Tab')
      expect(await on()).not.toBe(at)
    }
    // map mode still learns it
    await page.keyboard.press('Escape')
    await page.click('.perform-side button[title="every knob of the picked chip"]')
    await whole()
    await page.keyboard.press('m')
    await page.click(sel)
    expect(await page.$eval(sel, (el) => el.classList.contains('learning'))).toBe(true)
  }, 60_000)

  it('an idle knob turns by the wheel and joins the live knobs and the walk until a look is loaded', async () => {
    await press('.picker', FIRST)
    await page.click('.context .all-toggle')
    const { live: lives, idle } = tiers(t1, FIRST)
    const at = idle[0]
    const sel = knob(at, '.context .group')
    const before = await state(sel)
    expect(await addresses('.context .live-row .knob')).not.toContain(at)
    expect(await page.$eval(sel, (el) => el.hasAttribute('data-tab'))).toBe(false)
    // a wheel notch turns it down, and it is live: in the live row, a stop of the walk, no longer dimmed
    const { x, y } = await centre(sel)
    await page.mouse.move(x, y)
    await page.mouse.wheel({ deltaY: 100 })
    await pause()
    expect(await moved(sel, before.value)).not.toBe(before.value)
    expect(await page.$eval(sel, (el) => [el.classList.contains('idle'), el.hasAttribute('data-tab')])).toEqual([
      false,
      true,
    ])
    expect((await live()).head).toBe(`live ${lives.length + 1} · in the chip's order`)
    expect(await addresses('.context .live-row .knob')).toEqual(
      chipKnobs(t1, FIRST)
        .map((k) => k.address)
        .filter((a) => lives.includes(a) || a === at),
    )
    await page.evaluate(() => (document.activeElement as HTMLElement).blur())
    const walked: string[] = []
    const stops = await page.$$eval('[data-tab]', (els) => els.length)
    for (let i = 0; i < stops; i++) {
      await page.keyboard.press('Tab')
      walked.push(await on())
    }
    expect(walked).toContain(at)
    // a press focuses another idle one, and typing sets it, as before
    const other = knob(idle[1], '.context .group')
    const o = await centre(other)
    await page.mouse.click(o.x, o.y)
    expect((await state(other)).focused).toBe(true)
    await page.mouse.click(o.x, o.y, { clickCount: 2 })
    expect((await state(other)).typed).toBe(true)
    await page.keyboard.press('Escape')
    // until a look is loaded
    await page.evaluate(() => (document.activeElement as HTMLElement).blur())
    await page.keyboard.press('1')
    await pause()
    expect(await addresses('.context .live-row .knob')).toEqual(lives)
    expect(await page.$eval(sel, (el) => [el.classList.contains('idle'), el.hasAttribute('data-tab')])).toEqual([
      true,
      false,
    ])
  }, 60_000)

  it("Edit's Rack and Decks' section keep their +N, and their knobs as they were", async () => {
    // the knobs a section shows folded away: dead, or at rest and untouched
    const folds = (chip: string) => chipKnobs(t1, chip).filter((at) => folded(t1, at))
    await page.keyboard.press('e')
    await page.waitForSelector('.rack .knob')
    const rack = '.rack-section.picked'
    const shown = await addresses(`${rack} .knob`)
    expect(shown.length).toBeGreaterThan(0)
    for (const at of folds(FIRST)) expect(shown).not.toContain(at.address)
    // +N folds, no tier, no live block
    const texts = await page.$$eval('.rack .fold', (els) => els.map((el) => [el.textContent, el.className]))
    expect(texts.length).toBeGreaterThan(0)
    for (const [text, cls] of texts) expect([text!.match(/^\+\d+$/) !== null, cls]).toEqual([true, 'mini fold'])
    expect(await page.$$('.rack .knob.idle, .rack .knob.off, .rack .knob-why, .rack .live-block')).toEqual([])
    // opened, a dead knob there still turns by the wheel, down
    for (const fold of await page.$$(`${rack} .fold`)) await fold.click()
    const dead = tiers(t1, FIRST).off[0]
    const sel = knob(dead, rack)
    const before = (await state(sel)).value
    const { x, y } = await centre(sel)
    await page.mouse.move(x, y)
    await page.mouse.wheel({ deltaY: 100 })
    await pause()
    expect(await moved(sel, before)).not.toBe(before)
    expect(await page.$eval(sel, (el) => el.getAttribute('title')!.split('\n')[0])).toBe(
      `${knobKind(dead).label}: ${knobKind(dead).help}`,
    )
    // and Decks' section the same
    await page.keyboard.press('d')
    await page.waitForSelector('.mixer .knob')
    const mixer = '.mixer > .panel:nth-child(2)'
    expect(await page.$$eval(`${mixer} .fold`, (els) => els.map((el) => el.className))).toContain('mini fold')
    for (const text of await page.$$eval(`${mixer} .fold`, (els) => els.map((el) => el.textContent)))
      expect(text).toMatch(/^\+\d+$/)
    expect(await page.$$(`${mixer} .knob.idle, ${mixer} .knob.off, ${mixer} .live-block`)).toEqual([])
  }, 60_000)
})
