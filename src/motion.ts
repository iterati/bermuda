// Motion: the clock, modulators with running phases, glide, links with their spread, macros and presets.
// advance() turns a scene into the scene to draw this frame, every knob at its live value.
import { asLinked } from './edit'
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

export type Live = {
  phases: Map<string, number> // each modulator's running phase, in cycles
  smooth: Map<string, number> // glided knob bases by address, glided modulator outputs by target
  drift: number // the contour's ring phase, in radians
  colour: number // the palette's running index
}

export const newLive = (): Live => ({ phases: new Map(), smooth: new Map(), drift: 0, colour: 0 })

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

const follow = (from: number | undefined, to: number, glide: number, dt: number) =>
  from === undefined || glide <= 0 ? to : to + (from - to) * Math.exp(-dt / glide)

// The scene to draw after dt seconds at the given tempo: each knob is its glided base, plus its link
// group's spread, plus its modulators, kept to its play range (widened to the base when a hand put it outside);
// a knob that comes round (PERIOD) with no play range wraps round its hard range instead.
export function advance(scene: Scene, live: Live, dt: number, bpm: number): Scene {
  const out = structuredClone(scene)
  for (const { level, list } of allLevels(out.levels))
    if (level.link)
      list[list.indexOf(level)] = asLinked(
        level,
        list.find((l) => l.id === level.link)!,
      )
  const beats = (dt * bpm) / 60
  const mods = new Map<Address, { m: Modulator; t: Modulator['targets'][number]; key: string }[]>()
  for (const m of scene.modulators) {
    live.phases.set(m.id, ((live.phases.get(m.id) ?? 0) + beats / m.period) % 1)
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
      const raw = wave(m, live.phases.get(m.id)! + m.phase + ((t.phaseSpread ?? 0) * member) / size)
      const w = follow(live.smooth.get(k), raw, m.glide, dt)
      live.smooth.set(k, w)
      v += t.depth * (2 * w - 1)
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
  live.drift = (live.drift + out.contour.drift.value * beats) % (2 * Math.PI)
  live.colour = (live.colour + out.palette.time.value * beats) % 1
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

// Detune the modulators' periods of a clock unit or more to whole clock units, each the nearest to its own
// that is coprime with every shorter one's, so the piece rarely repeats, as the Tapestries' periods were
// picked (on a draft). Shorter periods keep theirs.
export function detunePeriods(draft: Scene) {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
  const taken: number[] = []
  for (const m of [...draft.modulators].filter((m) => m.period >= 1).sort((a, b) => a.period - b.period)) {
    const base = Math.round(m.period)
    let p = base
    // base, then one up, one down, two up, two down and so on
    for (let i = 1; p < 1 || taken.some((t) => gcd(t, p) > 1); i++) p = base + (i % 2 ? (i + 1) / 2 : -i / 2)
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
