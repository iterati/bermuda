// The app as built, in headless Chrome: Stage, Edit and Decks each show a picture that is not blank, Decks its
// two decks and the mix between them, and a look cued onto B changes B's deck and nothing A shows. Key I shows the
// frame-time readout, the program's parts a click opens into their list, and hides it again. A look loaded or
// changed into in Play comes in where the clock is, so one played on, left and come back to shows as it did. A
// song of clicks at 120 bpm, chosen as a file, plays and sets the clock's tempo to its own, until it is stopped.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer, { type Browser, type KeyInput, type Page } from 'puppeteer-core'
import { build, type Rollup } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LOOKS } from './looks'
import { needs } from './shader'

// localhost, nothing listening there: the build is served from memory, and the page is a secure context, as the
// music's worklet needs
const ORIGIN = 'http://localhost:4917'

let browser: Browser
let page: Page

beforeAll(async () => {
  const out = (await build({
    root: fileURLToPath(new URL('..', import.meta.url)),
    logLevel: 'silent',
    build: { write: false },
  })) as Rollup.RollupOutput
  const files = new Map(out.output.map((f) => [f.fileName, f.type === 'chunk' ? f.code : f.source]))
  const chrome = execFileSync('sh', ['-c', 'command -v chromium'], { encoding: 'utf8' }).trim()
  browser = await puppeteer.launch({
    executablePath: chrome,
    args: [
      '--no-sandbox',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--autoplay-policy=no-user-gesture-required',
    ],
  })
  page = await browser.newPage()
  // the layout at its usual size, its pictures drawn at a quarter of it, as software GL is slow
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 0.25 })
  // the build served from memory
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    // the page's own blobs (the song, the music's worklet) load as they are
    if (req.url().startsWith('blob:')) return req.continue()
    const name = new URL(req.url()).pathname.slice(1)
    const body = files.get(name)
    if (body === undefined) return req.respond({ status: 404 })
    const type = name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript'
    req.respond({ status: 200, contentType: type, body: typeof body === 'string' ? body : Buffer.from(body) })
  })
  await page.goto(`${ORIGIN}/index.html`)
  await page.waitForSelector('canvas.picture')
  // the clock stopped, so each picture holds still
  await page.click('.bar button[title="space"]')
  await page.waitForFunction(() => document.querySelector('.bar button[title="space"]')!.textContent === '▶')
}, 60_000)

afterAll(() => browser?.close())

// a few frames drawn, so a canvas resized by the view has been drawn again
const frames = () =>
  page.evaluate(async () => {
    for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame)
  })

// each canvas the selector names: its pixels, lightness 0 to 1, their mean and spread
const canvases = (selector: string) =>
  page.evaluate((selector) => {
    return [...document.querySelectorAll('canvas')]
      .filter((c) => c.matches(selector))
      .map((c) => {
        const copy = document.createElement('canvas')
        ;[copy.width, copy.height] = [c.width, c.height]
        const ctx = copy.getContext('2d')!
        ctx.drawImage(c, 0, 0)
        const data = ctx.getImageData(0, 0, c.width, c.height).data
        const px: number[] = []
        for (let i = 0; i < data.length; i += 4) px.push((data[i] + data[i + 1] + data[i + 2]) / 765)
        const mean = px.reduce((s, v) => s + v, 0) / px.length
        const spread = Math.sqrt(px.reduce((s, v) => s + (v - mean) ** 2, 0) / px.length)
        return { px, mean, spread }
      })
  }, selector)

// Decks' three pictures: A's deck, the mix and B's deck
const decks = async () => {
  const [[a], [mix], [b]] = await Promise.all(
    ['.deck-column.a canvas', 'canvas.picture', '.deck-column.b canvas'].map(canvases),
  )
  return { a, mix, b }
}

const view = async (name: string) => {
  await page.$$eval('.seg button', (buttons, name) => buttons.find((b) => b.textContent === name)!.click(), name)
  await frames()
}

const furthest = (x: number[], y: number[]) => x.reduce((most, v, i) => Math.max(most, Math.abs(v - y[i])), 0)

describe('the views', { timeout: 30_000 }, () => {
  it.each(['Stage', 'Edit', 'Decks'])('%s shows a picture that is not blank', async (name) => {
    await view(name)
    const pictures = name === 'Decks' ? Object.values(await decks()) : await canvases('*')
    expect(pictures).toHaveLength(name === 'Decks' ? 3 : 1)
    for (const { mean, spread } of pictures) {
      expect(mean).toBeGreaterThan(0.01)
      expect(spread).toBeGreaterThan(0.01)
    }
  })

  it('cues a look onto B in Decks without changing what A shows', async () => {
    await view('Decks')
    const before = await decks()
    const cue = await page.$eval('.deck-column.b select', (select) => {
      const look = [...select.options].find((o) => o.text.startsWith('Tapestry 3'))!
      return { value: look.value, name: look.text }
    })
    await page.select('.deck-column.b select', cue.value)
    await frames()
    expect(await page.$eval('.deck-column.b .deck-title b', (b) => b.textContent)).toBe(cue.name)
    expect(await page.$eval('.deck-column.b .deck-state', (s) => s.textContent)).toBe('cued')
    const after = await decks()
    expect(furthest(after.a.px, before.a.px)).toBe(0)
    expect(furthest(after.mix.px, before.mix.px)).toBe(0)
    expect(furthest(after.b.px, before.b.px)).toBeGreaterThan(0.1)
  })

  it("the readout key shows frames a second, the program's parts and its compile time, and hides it again", async () => {
    await view('Stage')
    const picture = async () => (await canvases('canvas.picture'))[0].px
    const before = await picture()
    const press = async () => {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      await page.keyboard.press('i')
    }
    await press()
    await page.waitForSelector('.frame-time')
    const lines = () => page.$eval('.frame-time', (el) => [...el.children].map((c) => c.textContent))
    // A on its own program, compiled on its first draw
    const parts = [...needs(LOOKS[0])].sort()
    const [fps, count, compiled] = await lines()
    expect(fps).toMatch(/^\d+ fps$/)
    expect(count).toBe(`${parts.length} parts`)
    expect(compiled).toMatch(/^compiled in \d+ ms$/)
    await page.click('.frame-parts')
    expect(await page.$eval('.frame-parts .dim', (el) => el.textContent)).toBe(parts.join(' '))
    await page.click('.frame-parts')
    expect(await page.$$('.frame-parts .dim')).toHaveLength(0)
    await press()
    await frames()
    expect(await page.$$('.frame-time')).toHaveLength(0)
    expect(furthest(await picture(), before)).toBe(0)
  })
})

describe('the clock', { timeout: 60_000 }, () => {
  const picture = async () => (await canvases('canvas.picture'))[0].px
  // the clock run for a while, then stopped again; from Stage's button, or in Play by its key
  const run = async (ms: number, toggle: () => Promise<unknown>) => {
    await toggle()
    await new Promise((r) => setTimeout(r, ms))
    await toggle()
    await frames()
  }
  const key = async (k: KeyInput) => {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press(k)
    await frames()
  }

  it('a look loaded comes in where the clock is, not at its opening', async () => {
    await view('Stage')
    // Tapestry 4, its spin a long period, on A
    await key('a')
    await key('3')
    const opening = await picture()
    await run(1500, () => page.click('.bar button[title="space"]'))
    const along = await picture()
    expect(furthest(along, opening)).toBeGreaterThan(0.1)
    // another look loaded, then Tapestry 4 again
    await key('2')
    await key('3')
    expect(furthest(await picture(), along)).toBeLessThan(1e-3)
  })

  it('a look Play changes into comes in where the clock is, and back again', async () => {
    await key('f')
    // the autopilot off, and each change landing at once, so it lands with the clock stopped
    const autopilot = await page.$eval('label[title^="the autopilot walks"] input', (i) => i.checked)
    if (autopilot) await key('o')
    const length = 'label[title="seconds each change of Play takes"] input'
    const seconds = await page.$eval(length, (i) => i.valueAsNumber)
    await page.focus(length)
    await page.keyboard.press('Home')
    await key('3')
    const before = await picture()
    await run(1500, () => key(' '))
    const along = await picture()
    expect(furthest(along, before)).toBeGreaterThan(0.1)
    await key('2')
    expect(furthest(await picture(), along)).toBeGreaterThan(0.1)
    await key('3')
    expect(furthest(await picture(), along)).toBeLessThan(1e-3)
    // the bank as it was
    await page.focus(length)
    for (let i = 0; i < Math.round(seconds * 10); i++) await page.keyboard.press('ArrowRight')
    if (autopilot) await key('o')
    await key('Escape')
  })
})

// a 16-bit mono WAV of seconds of clicks at bpm, in this run's temporary folder
function clickTrack(bpm: number, seconds: number): string {
  const rate = 44100
  const pcm = Buffer.alloc(seconds * rate * 2)
  for (let i = 0; i < seconds * rate; i++) {
    const since = (i / rate) % (60 / bpm)
    pcm.writeInt16LE(Math.round(26000 * Math.exp(-since / 0.01) * Math.sin(2 * Math.PI * 2000 * since)), i * 2)
  }
  const head = Buffer.alloc(44)
  head.write('RIFF', 0)
  head.writeUInt32LE(36 + pcm.length, 4)
  head.write('WAVEfmt ', 8)
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20)
  head.writeUInt16LE(1, 22)
  head.writeUInt32LE(rate, 24)
  head.writeUInt32LE(rate * 2, 28)
  head.writeUInt16LE(2, 32)
  head.writeUInt16LE(16, 34)
  head.write('data', 36)
  head.writeUInt32LE(pcm.length, 40)
  const file = join(tmpdir(), `clicks-${bpm}.wav`)
  writeFileSync(file, Buffer.concat([head, pcm]))
  return file
}

// the header's tempo field: its value and whether a hand may change it
const tempo = () =>
  page.$eval('.bar .num input', (i) => [(i as HTMLInputElement).valueAsNumber, (i as HTMLInputElement).disabled])

describe('music', { timeout: 60_000 }, () => {
  it("a song sets the clock's tempo to its own while it is heard", async () => {
    await view('Stage')
    // the Music block is a tab of Stage's right column
    await page.$$eval('.tabs button', (tabs) => tabs.find((t) => t.textContent === 'Music')!.click())
    const input = (await page.$('label[title^="hear a song"] input'))!
    await input.uploadFile(clickTrack(120, 30))
    await page.waitForFunction(
      () => /^1(19|20|21) bpm$/.test(document.querySelector('.music-beat b')?.textContent ?? ''),
      { timeout: 40_000 },
    )
    const [bpm, fixed] = await tempo()
    expect(Math.abs((bpm as number) - 120)).toBeLessThanOrEqual(1)
    expect(fixed).toBe(true)
    expect(await page.$eval('.music-name', (s) => s.textContent)).toBe('clicks-120.wav')
    await page.click('button[title="stop listening"]')
    await page.waitForFunction(() => !document.querySelector('.music-heard'))
    expect(await tempo()).toEqual([60, false])
  })

  it("the song Direct picks is the one the music hears, the app's one song", async () => {
    await view('Direct')
    const input = (await page.$('label[title^="the song the timeline"] input'))!
    await input.uploadFile(clickTrack(120, 30))
    // its waveform drawn from the file, and the same song heard, played by no player of Direct's own
    await page.waitForFunction(() => document.querySelector('.direct-panel .wave')?.getAttribute('d'))
    expect(await page.$eval('.direct-panel .song-name', (s) => s.textContent)).toBe('clicks-120.wav')
    expect(await page.$$eval('audio', (a) => a.length)).toBe(0)
    await view('Stage')
    expect(await page.$eval('.music-name', (s) => s.textContent)).toBe('clicks-120.wav')
    // stopped in the Music block, it is gone from Direct too
    await page.click('button[title="stop listening"]')
    await page.waitForFunction(() => !document.querySelector('.music-heard'))
    await view('Direct')
    expect(await page.$eval('.direct-panel .song-name', (s) => s.textContent)).not.toBe('clicks-120.wav')
    await view('Stage')
  })
})
