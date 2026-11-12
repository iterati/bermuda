// Music: what the app hears in a song file, the microphone or a browser tab, read from the samples alone. Each hop of
// samples is one frame: its spectrum gives the loudness in eight bands, the tone (where the sound sits, dark to light)
// and the onset strength (how much louder it got, bin by bin, each band counting alike); the last few seconds of onsets
// give the tempo (their autocorrelation) and where the beats fall (a comb of beats laid over them), and the beat runs
// on between reads, pulled toward them. The drive comes of the tempo and how clear its pulse is: fast and sharp is a
// beat to speed to, slow and soft a sensual groove; it sets the feel (snap or glide) and the clock's rate. A worklet
// taps the Web Audio graph and hands the samples over.
import {
  BANDS,
  clamp,
  FEATURES,
  hardRange,
  type Address,
  type Feature,
  type Listen,
  type Macro,
  type Modulator,
  type Scene,
} from './scene'
import TAP from './tap.js?url&no-inline'

export const SIZE = 2048 // the spectrum's window, in samples
export const HOP = 512 // samples from one frame to the next
// each band runs from one edge to the next, in Hz, a ratio of about 2.2 apart
const EDGES = BANDS.map((_, i) => 30 * (16000 / 30) ** (i / BANDS.length)).concat(16000)
const WINDOW = 6 // seconds of onsets each tempo read looks back over
const READ = 8 // frames from one tempo read to the next
const SETTLE = 3 // seconds of sound before the first read
const TEMPI: [number, number] = [60, 180] // the tempi it reads, in bpm; the likeliest about 120
// frames from a beat's sound to the frame its onset peaks in: the window fills from its newest end
const LATE = 2
const RANGE = 30 // dB from a band's recent peak down to 0
const FLOOR = -80 // dB: quieter than this is silence

export type Ear = {
  rate: number // samples a second
  samples: Float32Array // the last SIZE samples, oldest first
  fill: number // samples taken into the hop to come
  frame: number
  time: number // seconds of sound heard, at the last frame
  band: Int8Array // each spectrum bin's band, -1 outside them
  bins: number[] // how many bins each band holds
  window: Float32Array
  re: Float64Array
  im: Float64Array
  mags: Float32Array // the last frame's log magnitudes, for the onsets
  onsets: Float32Array // a ring of the last WINDOW seconds' onset strengths
  peaks: [number, number] // the loudest band's recent peak in dB, and the whole sound's
  centre: number // the band the sound has sat about over the last 20 s, for the tone
  bpm: number
  locked: boolean // a tempo read once
  beat: number // the beat at the last frame: beats since the start, 0 on a beat
  err: number // the beat's distance from the last read still to take up
  doubt: number // reads in a row that heard another tempo
  features: Record<Feature, number>
}

export function newEar(rate: number): Ear {
  const bins = SIZE / 2 + 1
  // the band of the bin at f Hz
  const of = (f: number) => EDGES.findIndex((e, i) => i < BANDS.length && f >= e && f < EDGES[i + 1])
  const band = new Int8Array(bins).map((_, k) => of((k * rate) / SIZE))
  return {
    rate,
    samples: new Float32Array(SIZE),
    fill: 0,
    frame: 0,
    time: 0,
    band,
    bins: BANDS.map((_, i) => band.filter((b) => b === i).length),
    window: new Float32Array(SIZE).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / SIZE)),
    re: new Float64Array(SIZE),
    im: new Float64Array(SIZE),
    mags: new Float32Array(bins),
    onsets: new Float32Array(Math.round((WINDOW * rate) / HOP)),
    peaks: [FLOOR, FLOOR],
    centre: BANDS.length / 2,
    bpm: 120,
    locked: false,
    beat: 0,
    err: 0,
    doubt: 0,
    features: Object.fromEntries(FEATURES.map((f) => [f, f === 'tone' || f === 'drive' ? 0.5 : 0])) as Record<
      Feature,
      number
    >,
  }
}

// Take samples in, a frame at each whole hop.
export function hear(ear: Ear, block: Float32Array) {
  for (let i = 0; i < block.length;) {
    const take = Math.min(HOP - ear.fill, block.length - i)
    ear.samples.set(block.subarray(i, i + take), SIZE - HOP + ear.fill)
    ear.fill += take
    i += take
    if (ear.fill < HOP) break
    frame(ear)
    ear.samples.copyWithin(0, HOP)
    ear.fill = 0
  }
}

// iterative radix-2 FFT, in place
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const [r, m] = [re[i], im[i]]
      ;[re[i], im[i], re[j], im[j]] = [re[j], im[j], r, m]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const [wr, wi] = [Math.cos((-2 * Math.PI) / len), Math.sin((-2 * Math.PI) / len)]
    for (let i = 0; i < n; i += len) {
      let [cr, ci] = [1, 0]
      for (let k = 0; k < len / 2; k++) {
        const [a, b] = [i + k, i + k + len / 2]
        const xr = re[b] * cr - im[b] * ci
        const xi = re[b] * ci + im[b] * cr
        re[b] = re[a] - xr
        im[b] = im[a] - xi
        re[a] += xr
        im[a] += xi
        const t = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = t
      }
    }
  }
}

const follow = (from: number, to: number, seconds: number, dt: number) => to + (from - to) * Math.exp(-dt / seconds)

function frame(ear: Ear) {
  const { re, im, window, band, mags, features, peaks } = ear
  const dt = HOP / ear.rate
  for (let i = 0; i < SIZE; i++) [re[i], im[i]] = [ear.samples[i] * window[i], 0]
  fft(re, im)
  // a sine of amplitude a gives a peak magnitude of a / 2
  const power = new Float64Array(BANDS.length)
  const rises = new Float64Array(BANDS.length)
  for (let k = 0; k < mags.length; k++) {
    if (band[k] < 0) continue
    const m = Math.hypot(re[k], im[k]) / (SIZE / 2)
    power[band[k]] += m * m
    const log = Math.log1p(1000 * m)
    rises[band[k]] += Math.max(0, log - mags[k])
    mags[k] = log
  }
  // each band's rise by the bin, so a kick in the few bins at the bottom counts as much as a hat in the many above
  ear.onsets[ear.frame % ear.onsets.length] = rises.reduce((s, r, i) => s + r / ear.bins[i], 0)
  ear.frame++
  ear.time += dt
  // every band against the loudest band's recent peak, so the bands keep the spectrum's shape (with bands an octave
  // and more wide, music sits about as loud in each), and the loudness against its own; each peak falls 4 dB a second
  const db = [...power].map((p) => 10 * Math.log10(p + 1e-12))
  const total = 10 * Math.log10(power.reduce((s, p) => s + p, 0) + 1e-12)
  ear.peaks = [Math.max(...db, peaks[0] - 4 * dt), Math.max(total, peaks[1] - 4 * dt)]
  const gauge = (d: number, peak: number) => clamp(1 + (d - Math.max(peak, FLOOR)) / RANGE, [0, 1])
  // each rises at once and falls over about a tenth of a second, to nothing under a thousandth
  const rise = (f: Feature, v: number) => {
    const fall = follow(features[f], v, 0.12, dt)
    features[f] = Math.max(v, fall < 1e-3 ? 0 : fall)
  }
  BANDS.forEach((b, i) => rise(b, gauge(db[i], ear.peaks[0])))
  rise('level', total < FLOOR ? 0 : gauge(total, ear.peaks[1]))
  if (total > FLOOR) {
    // the tone: the bands' centre, their amplitudes weighing it, against halfway between the middle band (where
    // pink noise, as loud in each band, sits) and where the sound has sat over the last 20 s or so, so a dark song
    // reads dark and its brighter passages lighter
    const amp = [...power].map(Math.sqrt)
    const centre = amp.reduce((s, a, i) => s + a * (i + 0.5), 0) / amp.reduce((s, a) => s + a, 0)
    ear.centre = follow(ear.centre, centre, 20, dt)
    const middle = (BANDS.length / 2 + ear.centre) / 2
    features.tone = follow(features.tone, clamp(0.5 + (centre - middle) / 2.5, [0, 1]), 1.5, dt)
  }
  // the beat runs on at the tempo, taking up its distance from the last read at up to half its speed again
  const step = (ear.bpm / 60) * dt
  const take = clamp(ear.err, [-step / 2, step / 2])
  ear.beat += step + take
  ear.err -= take
  if (ear.frame % READ === 0 && ear.time >= SETTLE) read(ear)
}

// Read the tempo and the beat from the onsets heard.
function read(ear: Ear) {
  const fps = ear.rate / HOP
  const n = Math.min(ear.frame, ear.onsets.length)
  const raw = Array.from({ length: n }, (_, i) => ear.onsets[(ear.frame - n + i) % ear.onsets.length])
  // each onset above the mean of the tenth of a second either side of it
  const sums = [0]
  for (const o of raw) sums.push(sums[sums.length - 1] + o)
  const w = Math.round(0.1 * fps)
  const o = raw.map((v, i) => {
    const [a, b] = [Math.max(0, i - w), Math.min(n, i + w + 1)]
    return Math.max(0, v - (sums[b] - sums[a]) / (b - a))
  })
  const corr = (lag: number) => {
    let s = 0
    for (let i = lag; i < n; i++) s += o[i] * o[i - lag]
    return s / (n - lag)
  }
  const zero = corr(0)
  if (zero < 1e-9) return
  // the lag of the strongest pulse, the likelier tempi weighed up (an octave from 120 counts about half)
  const [lo, hi] = [Math.floor((60 * fps) / TEMPI[1]), Math.ceil((60 * fps) / TEMPI[0])]
  const r = new Map<number, number>()
  for (let lag = lo - 1; lag <= hi + 1; lag++) r.set(lag, corr(lag))
  let best = lo
  const likely = (lag: number) => r.get(lag)! * Math.exp(-0.5 * (Math.log2((60 * fps) / lag / 120) / 0.9) ** 2)
  for (let lag = lo; lag <= hi; lag++) if (likely(lag) > likely(best)) best = lag
  const period = best + peak(r.get(best - 1)!, r.get(best)!, r.get(best + 1)!)
  if (r.get(best)! / zero < 0.05) return
  const bpm = (60 * fps) / period
  // the comb of beats, the recent ones weighing most, that lands on the most onsets: frames since its last beat
  const comb = (since: number) => {
    let s = 0
    for (let k = 0, at = n - 1 - since; at >= 0; k++, at = Math.round(n - 1 - since - k * period))
      s += o[at] * 0.85 ** k
    return s
  }
  const span = Math.floor(period)
  const scores = Array.from({ length: span }, (_, i) => comb(i))
  const at = scores.indexOf(Math.max(...scores))
  const since = at + peak(scores[(at + span - 1) % span], scores[at], scores[(at + 1) % span]) + LATE
  // how sharp the pulse is: the share of the onsets that fall within a frame of its beats
  let sharp = 0
  for (let k = 0, i = n - 1 - at; i >= 0; k++, i = Math.round(n - 1 - at - k * period))
    sharp += o[i] + (o[i - 1] ?? 0) + (o[i + 1] ?? 0)
  sharp /= o.reduce((s, v) => s + v, 0)
  const phase = (since / period) % 1
  const off = phase - (ear.beat - Math.floor(ear.beat))
  const wrapped = off - Math.round(off)
  if (!ear.locked) {
    ear.locked = true
    ear.bpm = bpm
    // a first read sets the beat forward to where it falls
    ear.beat += wrapped < 0 ? wrapped + 1 : wrapped
  } else if (Math.abs(bpm / ear.bpm - 1) < 0.05 || ++ear.doubt > 20) {
    ear.bpm = ear.doubt > 20 ? bpm : ear.bpm + 0.15 * (bpm - ear.bpm)
    ear.doubt = 0
    ear.err = wrapped
  }
  // fast and sharp drives, slow and soft grooves: 80 bpm counts nothing toward a drive, 150 all it can
  const drive = 0.6 * clamp((ear.bpm - 80) / 70, [0, 1]) + 0.4 * clamp(sharp, [0, 1])
  ear.features.drive = follow(ear.features.drive, drive, 2, (READ * HOP) / ear.rate)
}

// where between three samples the peak sits, -0.5 to 0.5 from the middle one (a parabola through them)
function peak(a: number, b: number, c: number) {
  const d = a - 2 * b + c
  return d < 0 ? clamp((0.5 * (a - c)) / d, [-0.5, 0.5]) : 0
}

// The beat as the motion feels it: at snap 0 the beat itself, toward snap 1 each beat's move made all at its start.
export function felt(beat: number, snap: number) {
  const f = beat - Math.floor(beat)
  return Math.floor(beat) + 1 - (1 - f) ** (1 + 7 * snap)
}

// What the music gives the picture at a moment: the tempo, the beat (beats since the start, 0 on a beat) and as
// felt, the snap the drive sets (choppy above a drive of 0.3, all snap at 0.8) and the clock's rate (half the tempo
// in a groove, the tempo itself at full drive), and the features.
export type Heard = {
  bpm: number
  locked: boolean
  beat: number
  felt: number
  snap: number
  rate: number
  features: Record<Feature, number>
}

// What the ear heard, at a time in seconds of sound heard: the beat runs on from its last frame at the tempo.
export function heardAt(ear: Ear, time: number): Heard {
  const beat = ear.beat + ((time - ear.time) * ear.bpm) / 60
  const { drive } = ear.features
  const snap = clamp((drive - 0.3) / 0.5, [0, 1])
  return {
    bpm: ear.bpm,
    locked: ear.locked,
    beat,
    felt: felt(beat, snap),
    snap,
    rate: 0.5 + 0.5 * drive,
    features: { ...ear.features },
  }
}

// ---- the sound in the browser ----

// the tap's URL: its own file beside the build's assets, never a blob: or data: URL, which a page's policy may refuse
export { TAP }

// Where the music comes from: a song file, the microphone, or what a browser tab plays
export type From = File | 'mic' | 'tab'

// what a tab shared without its sound tells
export const NO_TAB_AUDIO = 'No tab audio: pick a tab and tick Share tab audio'

// A song, the microphone or a tab being heard: the audio clock's time at the ear's first sample, and the song's
// player.
export type Listening = {
  name: string
  ctx: AudioContext
  ear: Ear
  start: number
  song?: HTMLAudioElement
  file?: File // the song's
  stop: () => void
}

// Hear a song file, playing it round, the microphone, or a tab's sound, shared through the browser's picker (which
// offers a tab's sound only with its video asked for too: the video stops at once). The tab plays its sound
// itself, so it is heard and never played out again; a share that ends (the tab closed, or its sharing stopped)
// stops the listening and calls ended.
export async function listen(from: From, ended?: () => void): Promise<Listening> {
  const ctx = new AudioContext()
  const urls: string[] = []
  const url = (o: Blob) => (urls.push(URL.createObjectURL(o)), urls[urls.length - 1])
  const song = typeof from === 'string' ? undefined : new Audio(url(from))
  let stream: MediaStream | undefined
  const stop = () => {
    song?.pause()
    stream?.getTracks().forEach((t) => t.stop())
    void ctx.close()
    urls.forEach(URL.revokeObjectURL)
  }
  const out: Listening = {
    name: from === 'mic' ? 'microphone' : from === 'tab' ? 'tab audio' : from.name,
    ctx,
    ear: newEar(ctx.sampleRate),
    start: ctx.currentTime,
    song,
    file: typeof from === 'string' ? undefined : from,
    stop,
  }
  try {
    if (!ctx.audioWorklet) throw new Error('the browser hears music only on a secure page: localhost, https or a file')
    if (from === 'mic')
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
    if (from === 'tab') {
      stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
      for (const video of stream.getVideoTracks()) {
        video.stop()
        stream.removeTrack(video)
      }
      if (!stream.getAudioTracks().length) throw new Error(NO_TAB_AUDIO)
    }
    await ctx.audioWorklet.addModule(TAP)
    const tap = new AudioWorkletNode(ctx, 'bermuda-tap', { numberOfOutputs: 0 })
    let first = true
    tap.port.onmessage = ({ data }: MessageEvent<{ at: number; samples: Float32Array }>) => {
      if (first) [out.start, first] = [data.at, false]
      hear(out.ear, data.samples)
    }
    const source = song ? ctx.createMediaElementSource(song) : ctx.createMediaStreamSource(stream!)
    source.connect(tap)
    if (song) {
      song.loop = true
      source.connect(ctx.destination)
      // a browser that wants a press first leaves it paused, for the play button
      await song.play().catch(() => undefined)
    }
    // a track stopped here fires no ended, so only the browser's ending of the share stops it; one it ended while
    // the tap loaded is ended already
    if (from === 'tab') {
      const [sound] = stream!.getAudioTracks()
      sound.addEventListener('ended', () => (stop(), ended?.()), { once: true })
      if (sound.readyState === 'ended') throw new Error("the tab's share ended")
    }
  } catch (err) {
    stop()
    throw err
  }
  return out
}

// ---- music in a look ----

// Wire a look to the music (on a draft), replacing what an earlier wiring put in: a tone macro shifting the
// palette (its hue either way, and the gamma: a dark sound sinks the mid-tones, a light one lifts them), a kick on
// each beat (the zoom jumps and falls back), the bass widening the lines, the mids speeding the rings' drift where
// there are rings, and the presence wobbling the first star's m, if the first level draws one.
export function wire(draft: Scene) {
  draft.modulators = draft.modulators.filter((m) => !m.id.startsWith('music-'))
  draft.macros = draft.macros.filter((m) => m.id !== 'music-tone')
  const [hue, gamma] = [draft.palette.hue.value, draft.post.gamma.value]
  draft.macros.push({
    id: 'music-tone',
    name: 'tone',
    value: 0.5,
    listen: 'tone',
    targets: [
      {
        knob: 'palette.hue',
        from: clamp(hue - 20, hardRange('palette.hue')),
        to: clamp(hue + 20, hardRange('palette.hue')),
      },
      {
        knob: 'post.gamma',
        from: clamp(gamma * 0.75, hardRange('post.gamma')),
        to: clamp(gamma * 1.25, hardRange('post.gamma')),
      },
    ],
  })
  // a feature's modulator plays the feature, so its wave and period stand unused
  const by = (id: string, listen: Listen, knob: Address, depth: number, wave: Modulator['wave'] = 'cos') =>
    draft.modulators.push({
      id,
      wave,
      period: 1,
      phase: 0,
      glide: listen === 'beats' ? 0 : 0.05,
      listen,
      targets: [{ knob, depth }],
    })
  // the ramp starts each beat at its foot, so a negative depth puts the zoom up on the beat and lets it fall
  by('music-kick', 'beats', 'frame.zoom', -0.03 * draft.frame.zoom.value, 'ramp')
  by('music-bass', 'bass', 'line.width', 0.6 * draft.line.width.value)
  if (draft.contour.rings.value > 0) by('music-mids', 'mid', 'contour.drift', 0.6)
  const first = draft.levels[0]
  if ((first.variants[0].shape.kind ?? 'star') === 'star')
    by('music-air', 'presence', `levels[${first.id}].variants[0].shape.m`, 0.3)
}

// A macro from one of the look's presets to another over the knobs where they differ, listening to the tone, so a
// dark sound plays the first and a light one the second (on a draft).
export function blend(d: Scene, from: number, to: number) {
  const [a, b] = [d.presets[from], d.presets[to]]
  let n = d.macros.length + 1
  while (d.macros.some((m) => m.id === `macro${n}`)) n++
  const targets: Macro['targets'] = Object.entries(a.values)
    .filter(([knob, v]) => b.values[knob] !== undefined && b.values[knob] !== v)
    .map(([knob, v]) => ({ knob, from: v, to: b.values[knob] }))
  d.macros.push({ id: `macro${n}`, name: `${a.name} → ${b.name}`, value: 0.5, listen: 'tone', targets })
}
