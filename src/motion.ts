// Motion: the clock, modulators on it, glide, links with their spread, macros and presets.
// advance() turns a scene into the scene to draw this frame, every knob at its live value.
import { asLinked } from './edit'
import { gcd } from './loop'
import type { Heard } from './music'
import {
  allLevels,
  clamp,
  hardRange,
  kindOf,
  knobsOf,
  PERIOD,
  playRange,
  resolve,
  type Address,
  type Modulator,
  type Preset,
  type Scene,
} from './scene'

// The app's one clock, its time: beats since it started, which never go back, and while music plays the felt beat
// it last ran to. Every look plays at its time, so a look coming in comes in where the clock is.
export type Time = { beats: number; felt?: number }

export const newTime = (): Time => ({ beats: 0 })

// The clock run on dt seconds at the given tempo; while music is heard it runs on its felt beat instead once its
// tempo is found, at its rate, so each beat's move comes as the snap has it.
export function keepTime(time: Time, dt: number, bpm: number, heard?: Heard) {
  const beat = heard?.locked ? heard : undefined
  time.beats += beat ? beat.rate * Math.max(0, beat.felt - (time.felt ?? beat.felt)) : (dt * bpm) / 60
  time.felt = beat?.felt
}

// What a side keeps from frame to frame of the look it plays, afresh when a new look comes in.
export type Live = {
  smooth: Map<string, number> // glided knob bases by address, glided modulator outputs by target
  runs: Map<string, { rate: number; by: number }> // running phases by modulator id or knob address (see running)
  drift: number // the contour's ring phase this frame, in radians
  colour: number // the palette's index this frame
  crawl: number // the dots' crawl this frame, in dots
}

export const newLive = (): Live => ({ smooth: new Map(), runs: new Map(), drift: 0, colour: 0, crawl: 0 })

export const copyLive = (live: Live): Live => ({ ...live, smooth: new Map(live.smooth), runs: new Map(live.runs) })

// A wave's value at phase p (cycles), 0 to 1; cos and tri start at 1 as the Tapestries' sinT and sawT did.
export function wave(m: Modulator, p: number): number {
  const f = p - Math.floor(p)
  switch (m.wave) {
    case 'cos':
      return 0.5 + 0.5 * Math.cos(2 * Math.PI * f)
    case 'tri':
      return Math.abs(f - 0.5) * 2
    case 'beat': {
      const [a, b] = m.harmonics!
      return Math.abs(Math.cos(2 * Math.PI * f * a) * Math.cos(2 * Math.PI * f * b) * 0.5 - 0.5)
    }
    case 'ramp':
      return f
    case 'steps': {
      const steps = m.steps!
      return steps[Math.min(steps.length - 1, Math.floor(f * steps.length))]
    }
  }
}

// A running phase at the clock's time, round turn: its rate times the time, plus by, which a move of the rate (a turn
// of its knob, a new period or tempo) carries on from where it was so it never jumps; a new look's by is 0.
function running(live: Live, key: string, rate: number, at: number, turn: number) {
  const was = live.runs.get(key)
  const by = was ? (was.by + (was.rate - rate) * at) % turn : 0
  live.runs.set(key, { rate, by })
  return (rate * at + by) % turn
}

const follow = (from: number | undefined, to: number, glide: number, dt: number) =>
  from === undefined || glide <= 0 ? to : to + (from - to) * Math.exp(-dt / glide)

// The scene to draw at the clock's time at (beats), dt seconds after the frame before: each knob is its glided base,
// plus its link group's spread, plus its modulators, each running once round each period, plus its phase, kept to
// its play range (widened to the base when a hand put it outside); a knob that comes round (PERIOD) with no play
// range wraps round its hard range instead. While music is heard the macros that listen take their features' values,
// and the modulators that listen play the felt beats or their features.
export function advance(scene: Scene, live: Live, at: number, dt: number, heard?: Heard): Scene {
  if (heard && scene.macros.some((m) => m.listen))
    scene = update(scene, (d) => {
      for (const m of d.macros) if (m.listen) setMacro(d, m.id, heard.features[m.listen])
    })
  const out = structuredClone(scene)
  for (const { level, list } of allLevels(out.levels))
    if (level.link)
      list[list.indexOf(level)] = asLinked(
        level,
        list.find((l) => l.id === level.link)!,
      )
  // the beat, once the music's tempo is found
  const beat = heard?.locked ? heard : undefined
  const mods = new Map<Address, { m: Modulator; t: Modulator['targets'][number]; key: string }[]>()
  const phases = new Map<string, number>()
  for (const m of scene.modulators) {
    phases.set(m.id, running(live, m.id, 1 / m.period, at, 1))
    m.targets.forEach((t, i) => mods.set(t.knob, [...(mods.get(t.knob) ?? []), { m, t, key: `${m.id}|${i}` }]))
  }
  const bases = new Map<Address, number>()
  for (const { address, knob, level } of knobsOf(out)) {
    let src = address
    let member = 0
    let size = 1
    if (level) {
      const leader = level.level.link ?? level.level.id
      const group = level.list.filter((l) => l.id === leader || l.link === leader)
      member = group.indexOf(level.level)
      size = group.length
      const shared = level.prefix.replace(/\[[^\]]+\]$/, `[${leader}]`) + address.slice(level.prefix.length)
      if (level.level.link) src = shared
    }
    const own = resolve(scene, src)!
    let base = bases.get(src)
    if (base === undefined) {
      base = follow(live.smooth.get(src), own.value, own.glide ?? 0, dt)
      live.smooth.set(src, base)
      bases.set(src, base)
    }
    const moves = mods.get(src) ?? []
    let v = base + (size > 1 && level ? ((own.spread ?? 0) * member) / size : 0)
    for (const { m, t, key } of moves) {
      const k = `${key}|${member}`
      const spread = ((t.phaseSpread ?? 0) * member) / size
      // a feature pushes its knobs up from where they rest; a wave swings them either side
      const feature = m.listen && m.listen !== 'beats' ? m.listen : undefined
      const raw = feature
        ? (heard?.features[feature] ?? 0)
        : m.listen !== 'beats'
          ? wave(m, phases.get(m.id)! + m.phase + spread)
          : beat
            ? wave(m, beat.felt / m.period + m.phase + spread)
            : 0.5
      const w = follow(live.smooth.get(k), raw, m.glide, dt)
      live.smooth.set(k, w)
      v += feature ? t.depth * w : t.depth * (2 * w - 1)
    }
    const [lo, hi] = playRange(src, own)
    const wraps = !own.play && PERIOD[kindOf(src)]
    knob.value =
      v === base
        ? base
        : wraps
          ? lo + ((((v - lo) % (hi - lo)) + (hi - lo)) % (hi - lo))
          : clamp(v, [Math.min(lo, base), Math.max(hi, base)])
  }
  live.drift = running(live, 'contour.drift', out.contour.drift.value, at, 2 * Math.PI)
  live.colour = running(live, 'palette.time', out.palette.time.value, at, 1)
  live.crawl = running(live, 'line.dots.crawl', out.line.dots?.crawl.value ?? 0, at, 1)
  return out
}

// A copy of the scene changed by fn: every edit of the controls goes through here.
export function update(scene: Scene, fn: (draft: Scene) => void): Scene {
  const draft = structuredClone(scene)
  fn(draft)
  return draft
}

// A macro at value v sets each of its knobs between from and to, inside the knob's play range (on a draft).
export function setMacro(draft: Scene, id: string, v: number) {
  const macro = draft.macros.find((m) => m.id === id)!
  macro.value = v
  for (const t of macro.targets) {
    const knob = resolve(draft, t.knob)!
    knob.value = clamp(t.from + (t.to - t.from) * v, playRange(t.knob, knob))
  }
}

// A macro learns by example (on a draft): every knob moved since before (the scene as the macro was armed) becomes
// its target, from where it was to where it is, and an earlier target left still keeps its from and takes where it
// is as its to. At 1 the macro is the scene as the player left it, so nothing jumps.
export function learnMacro(draft: Scene, id: string, before: Scene) {
  const macro = draft.macros.find((m) => m.id === id)!
  for (const t of macro.targets) t.to = resolve(draft, t.knob)!.value
  for (const { address, knob } of knobsOf(draft)) {
    const was = resolve(before, address)?.value
    if (was === undefined || Math.abs(knob.value - was) <= 1e-9) continue
    const target = { knob: address, from: was, to: knob.value }
    const i = macro.targets.findIndex((t) => t.knob === address)
    if (i < 0) macro.targets.push(target)
    else macro.targets[i] = target
  }
  macro.value = 1
}

// Roll the knobs at these addresses that have a play range, each anywhere inside it (on a draft).
export function dice(draft: Scene, addresses: Address[], random: () => number) {
  for (const address of addresses) {
    const knob = resolve(draft, address)!
    if (knob.play) knob.value = knob.play[0] + (knob.play[1] - knob.play[0]) * random()
  }
}

// Detune the modulators' periods of a clock unit or more to whole clock units, each the nearest to its own
// that is coprime with every shorter one's, so the piece rarely repeats, as the Tapestries' periods were
// picked (on a draft). Shorter periods keep theirs, and so do the modulators that listen to the music.
export function detunePeriods(draft: Scene) {
  const taken: number[] = []
  for (const m of [...draft.modulators].filter((m) => m.period >= 1 && !m.listen).sort((a, b) => a.period - b.period)) {
    const base = Math.round(m.period)
    // base, then one toward the period, one away, two toward, two away and so on: nearest first
    const toward = m.period < base ? -1 : 1
    let p = base
    for (let i = 1; p < 1 || taken.some((t) => gcd(t, p) > 1); i++) p = base + toward * (i % 2 ? (i + 1) / 2 : -i / 2)
    taken.push(p)
    m.period = p
  }
}

// A preset is a keyframe of every knob's value, inside the look's clamps.
export const capturePreset = (scene: Scene, name: string): Preset => ({
  name,
  values: Object.fromEntries(knobsOf(scene).map(({ address, knob }) => [address, knob.value])),
})

export const applyPreset = (scene: Scene, preset: Preset) =>
  update(scene, (d) => {
    for (const [address, value] of Object.entries(preset.values)) {
      const knob = resolve(d, address)!
      knob.value = clamp(value, playRange(address, knob))
    }
  })

// A hand move: anywhere inside the kind's hard range.
export const setKnob = (scene: Scene, address: Address, value: number) =>
  update(scene, (d) => {
    resolve(d, address)!.value = clamp(value, hardRange(address))
  })
