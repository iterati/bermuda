// The Music block in the app as built, in headless Chrome, its tab picker stubbed: the tab choice sits beside the
// mic, and a tab shared with its sound is heard (its video stopped at once), one shared without it shows why in
// the error panel, and one the browser ends stops being heard and the block says so.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { build, type Rollup } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { NO_TAB_AUDIO } from '../music'

// localhost, nothing listening there: the build is served from memory, and the page is a secure context, as the
// music's worklet needs
const ORIGIN = 'http://localhost:4918'

let browser: Browser
let page: Page

// The picker stubbed in the page: a share of a 220 Hz tone and a canvas's video, or of the video alone as when Share
// tab audio is left unticked; its tracks kept, so a test can see the video stopped and end the share as the
// browser does.
declare global {
  interface Window {
    withSound: boolean
    shared: MediaStreamTrack[]
  }
}
function stubPicker() {
  window.withSound = true
  window.shared = []
  navigator.mediaDevices.getDisplayMedia = async () => {
    const canvas = document.createElement('canvas')
    canvas.getContext('2d')!.fillRect(0, 0, 1, 1)
    const tracks: MediaStreamTrack[] = canvas.captureStream().getVideoTracks()
    if (window.withSound) {
      const ctx = new AudioContext()
      const tone = ctx.createOscillator()
      const to = ctx.createMediaStreamDestination()
      tone.type = 'square'
      tone.frequency.value = 220
      tone.connect(to)
      tone.start()
      tracks.push(...to.stream.getAudioTracks())
    }
    window.shared = tracks
    return new MediaStream(tracks)
  }
}

beforeAll(async () => {
  const out = (await build({
    root: fileURLToPath(new URL('../..', import.meta.url)),
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
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 0.25 })
  await page.evaluateOnNewDocument(stubPicker)
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (req.url().startsWith('blob:')) return req.continue()
    const name = new URL(req.url()).pathname.slice(1)
    const body = files.get(name)
    if (body === undefined) return req.respond({ status: 404 })
    const type = name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript'
    req.respond({ status: 200, contentType: type, body: typeof body === 'string' ? body : Buffer.from(body) })
  })
  await page.goto(`${ORIGIN}/index.html`)
  await page.waitForSelector('canvas.picture')
  // the Music block is a tab of Stage's right column
  await page.$$eval('.tabs button', (tabs) => tabs.find((t) => t.textContent === 'Music')!.click())
}, 60_000)

afterAll(() => browser?.close())

const listenToTab = () => page.click('button[title^="listen to a tab"]')

describe('the Music block', { timeout: 30_000 }, () => {
  it('offers a tab beside the mic', async () => {
    const choices = await page.$$eval('.block-title .actions .mini', (c) => c.map((b) => b.textContent!.trim()))
    expect(choices.slice(0, 3)).toEqual(['song', 'mic', 'tab'])
  })

  it("hears a tab's sound, its video stopped at once", async () => {
    await listenToTab()
    await page.waitForFunction(() => document.querySelector('.music-name')?.textContent === 'tab audio')
    // the tone lifts the level, as the analyser hears it
    await page.waitForFunction(
      () => parseFloat(document.querySelector<HTMLElement>('.bands .level span')?.style.height ?? '0') > 50,
    )
    expect(await page.evaluate(() => window.shared.map((t) => [t.kind, t.readyState]))).toEqual([
      ['video', 'ended'],
      ['audio', 'live'],
    ])
    await page.click('button[title="stop listening"]')
    await page.waitForFunction(() => !document.querySelector('.music-heard'))
    expect(await page.evaluate(() => window.shared[1].readyState)).toBe('ended')
  })

  it('a tab shared without its sound shows why in the error panel', async () => {
    await page.evaluate(() => (window.withSound = false))
    await listenToTab()
    await page.waitForSelector('.error.panel')
    expect(await page.$eval('.error.panel', (e) => e.textContent)).toContain(`music: ${NO_TAB_AUDIO}`)
    expect(await page.$('.music-name')).toBeNull()
    await page.click('.error.panel')
    await page.evaluate(() => (window.withSound = true))
  })

  it('a share the browser ends is heard no more, and the block says so', async () => {
    await listenToTab()
    await page.waitForSelector('.music-heard')
    await page.evaluate(() => window.shared[1].dispatchEvent(new Event('ended')))
    await page.waitForFunction(() => !document.querySelector('.music-heard'))
    expect(await page.$('.music-name')).toBeNull()
    expect(await page.$eval('.music-ended', (e) => e.textContent)).toBe("the tab's share ended, so it is heard no more")
  })
})
