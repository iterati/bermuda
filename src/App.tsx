// Bermuda: the picture, and over it (Stage) or beside it (Edit) the fader from scene A to scene B, the chain,
// the picked chip's knobs, the modulators, the macros, MIDI, the looks and the bank. Decks puts A and B in their
// own previews either side of the mix, like a DJ mixer, so B can be cued while A plays. The controls edit one side,
// A or B; every change is instant, and so is MIDI, which plays the side being edited and the fader. Play is the
// picture alone with the bank over it: every change there rides a timed transition, the fader run from the side
// showing to the other with the change loaded on it, and the autopilot walks the bank.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { missingKeys, pruneTimeline, type Shot } from './direct'
import { BANK, LOOKS } from './looks'
import { attach, drive, echoes, HAS_MIDI, keyOf, learn, learnTrigger, takes, waiting, type Learning } from './midi'
import { morphSize } from './morph'
import { applyPreset, capturePreset, newLive, setKnob, update } from './motion'
import {
  bendOf,
  entryName,
  entryScene,
  mutate,
  playable,
  pruneBank,
  step,
  tangent,
  valuesOf,
  type Bend,
  type Keyframe,
} from './play'
import {
  allLevels,
  CHIPS,
  depthOf,
  hardRange,
  knobsOf,
  MAX_DEPTH,
  MAX_LEVELS,
  parseBank,
  parseControls,
  parseScene,
  parseTimeline,
  resolve,
  type Address,
  type Bank as BankShape,
  type Controls,
  type Edge,
  type Scene,
  type Timeline,
  type View,
} from './scene'
import { Bank } from './ui/Bank'
import { Chain } from './ui/Chain'
import { Direct, type Video } from './ui/Direct'
import { CtlContext, Section, type Ctl } from './ui/controls'
import { Deck } from './ui/Deck'
import { Fader } from './ui/Fader'
import { wheelSteps } from './ui/Knob'
import { KnobDetail } from './ui/KnobDetail'
import { Looks } from './ui/Looks'
import { Midi } from './ui/Midi'
import { Macros, Modulators } from './ui/Motion'
import { Picture, type Side, type Transition } from './ui/Picture'

const STORE = 'bermuda.looks'
const CONTROLS = 'bermuda.midi'
const BANK_STORE = 'bermuda.bank'
const TIMELINE = 'bermuda.timeline'

// What this browser keeps under a key, parsed: a store that fails its parse is set aside whole, so the next save
// does not write over what did parse.
function loadStored<T>(what: string, key: string, parse: (text: string) => T, empty: T): { value: T; error?: string } {
  const text = localStorage.getItem(key)
  if (!text) return { value: empty }
  try {
    return { value: parse(text) }
  } catch (err) {
    localStorage.setItem(`${key}.broken`, text)
    localStorage.removeItem(key)
    return { value: empty, error: `${what} moved to ${key}.broken: ${(err as Error).message}` }
  }
}

// The looks to pick from: a look saved under a built-in's name takes its place.
const library = (saved: Scene[]) => [
  ...LOOKS.map((l) => saved.find((s) => s.name === l.name) ?? l),
  ...saved.filter((s) => !LOOKS.some((l) => l.name === s.name)),
]

// The bank saved in this browser, else the built-in one, without the entries that name no look.
function loadBank(looks: Scene[]): { bank: BankShape; error?: string } {
  const stored = loadStored('saved bank', BANK_STORE, parseBank, BANK)
  const bank = pruneBank(stored.value, looks)
  const gone = stored.value === BANK ? [] : stored.value.scenes.filter((s) => !bank.scenes.includes(s))
  return {
    bank,
    error: stored.error ?? (gone.length ? `the bank lost ${gone.join(', ')}: no look of that name` : undefined),
  }
}

// The timeline without the keys that name no look, and why, if it lost any: one left with no key is set aside.
function keptTimeline(timeline: Timeline, looks: Scene[]): { timeline: Timeline | null; error?: string } {
  const { timeline: kept, gone } = pruneTimeline(timeline, looks)
  if (!gone.length) return { timeline: kept }
  if (!kept) localStorage.setItem(`${TIMELINE}.broken`, JSON.stringify(timeline))
  const lost = `the timeline lost its keys of ${gone.join(', ')}: no look of that name`
  return { timeline: kept, error: kept ? lost : `${lost}, and with no key left it moved to ${TIMELINE}.broken` }
}

// The timeline saved in this browser, if any, without the keys that name no look.
function loadTimeline(looks: Scene[]): { timeline: Timeline | null; error?: string } {
  const stored = loadStored<Timeline | null>('saved timeline', TIMELINE, parseTimeline, null)
  return stored.value ? keptTimeline(stored.value, looks) : { timeline: null, error: stored.error }
}

// Why a pair of scenes cannot play, alone or morphed into each other, past the shader's limits; or undefined.
function refusal(pair: Record<Side, Scene>): string | undefined {
  for (const s of [pair.a, pair.b])
    if (allLevels(s.levels).length > MAX_LEVELS || depthOf(s.levels) > MAX_DEPTH)
      return `a scene holds at most ${MAX_LEVELS} levels, ${MAX_DEPTH} deep`
  const { levels, depth } = morphSize(pair.a, pair.b)
  if (levels > MAX_LEVELS || depth > MAX_DEPTH)
    return `A into B morphs through ${levels} levels, ${depth} deep; the shader holds ${MAX_LEVELS}, ${MAX_DEPTH} deep`
}

// Why a timeline cannot play: a key naming no look, or keys side by side that morph past the shader's limits (only
// the pairs before does not hold are checked); or undefined.
function timelineRefusal(next: Timeline, before: Timeline | null, looks: Scene[]): string | undefined {
  const gone = missingKeys(next, looks)
  if (gone.length) return `${gone.join(', ')} is not one of the looks: save it first (S)`
  const pairs = (t: Timeline | null) => t?.keys.slice(1).map((k, j) => `${t.keys[j].scene}\n${k.scene}`) ?? []
  const held = new Set(pairs(before))
  for (const [j, pair] of pairs(next).entries()) {
    if (held.has(pair)) continue
    const [a, b] = pair.split('\n').map((entry) => entryScene(looks, entry)!)
    const why = refusal({ a, b })
    if (why) return `keys ${j + 1} and ${j + 2}: ${why}`
  }
}

const other = (side: Side): Side => (side === 'a' ? 'b' : 'a')

export function App() {
  const [initial] = useState(() =>
    loadStored('saved looks', STORE, (text) => (JSON.parse(text) as unknown[]).map(parseScene), [] as Scene[]),
  )
  const [initialControls] = useState(() =>
    loadStored('saved MIDI controls', CONTROLS, parseControls, { buttons: [] } as Controls),
  )
  const [initialBank] = useState(() => loadBank(library(initial.value)))
  const [initialTimeline] = useState(() => loadTimeline(library(initial.value)))
  const [saved, setSaved] = useState(initial.value)
  const [error, setError] = useState(
    [initial.error, initialControls.error, initialBank.error, initialTimeline.error].filter(Boolean).join('; ') ||
      undefined,
  )
  const [pair, setPair] = useState<Record<Side, Scene>>(() => ({
    a: structuredClone(LOOKS[0]),
    b: structuredClone(LOOKS.find((l) => l.name.startsWith('Tapestry 7 '))!),
  }))
  // the bank entry each side holds, if it came from one
  const [entries, setEntries] = useState<Record<Side, string | undefined>>({ a: pair.a.name, b: pair.b.name })
  const [side, setSide] = useState<Side>('a')
  const [fader, setFader] = useState(0)
  const [edge, setEdge] = useState<Edge>({ seconds: 2, stagger: 0.4, deepFirst: false })
  const scene = pair[side]
  const setScene = useCallback((fn: (s: Scene) => Scene) => setPair((p) => ({ ...p, [side]: fn(p[side]) })), [side])
  const [shown, setShown] = useState(scene)
  const [mode, setMode] = useState<View | 'play' | 'direct'>('stage')
  const [hidden, setHidden] = useState(false)
  const [picked, setPicked] = useState<string>(LOOKS[0].levels[0].id)
  const [focus, setFocus] = useState<Address | null>(null)
  const [bpm, setBpm] = useState(60)
  const [running, setRunning] = useState(true)
  const [lives] = useState(() => ({ a: newLive(), b: newLive() }))
  // each side's preset in play, for [ and ]
  const [presets, setPresets] = useState<Record<Side, number>>({ a: -1, b: -1 })
  const [midi, setMidi] = useState<MIDIAccess | null>(null)
  const [inputs, setInputs] = useState<string[]>([])
  const [learning, setLearning] = useState<Learning | null>(null)
  const [controls, setControls] = useState(initialControls.value)
  const [positions, setPositions] = useState<ReadonlyMap<string, number>>(new Map())
  // the decks' preview canvases, while Decks shows them
  const decks = useRef<Record<Side, HTMLCanvasElement | null>>({ a: null, b: null })

  const connect = useCallback(
    () => navigator.requestMIDIAccess().then(setMidi, (err: Error) => setError(`MIDI: ${err.message}`)),
    [],
  )
  // once this browser has let the page use MIDI, connect on load without asking again
  useEffect(() => {
    if (HAS_MIDI)
      navigator.permissions.query({ name: 'midi' as PermissionName }).then((p) => {
        if (p.state === 'granted') connect()
      })
  }, [connect])
  const learnMidi = useCallback(
    (target: Learning | null) => {
      if (target && !midi) connect()
      setLearning(target)
    },
    [midi, connect],
  )
  const saveControls = useCallback((next: Controls) => {
    localStorage.setItem(CONTROLS, JSON.stringify(next))
    setControls(next)
  }, [])
  const [bank, setBank] = useState(initialBank.bank)
  // Play: the transition running, the changes waiting for it to land, the autopilot's next keyframe, how many of
  // its moves the shader's limits refused (each one moves it on), and the tangent the last transition landed with
  // and the keyframe it aimed at (the next one, starting as it lands toward that keyframe, sets off with it)
  const [run, setRun] = useState<Transition | null>(null)
  const [queue, setQueue] = useState<Keyframe[]>([])
  const [planned, setPlanned] = useState<Keyframe>()
  const [refused, setRefused] = useState(0)
  const landing = useRef<{ toward?: Keyframe; tangent: Map<Address, number> }>({ tangent: new Map() })

  const looks = useMemo(() => library(saved), [saved])
  const changeBank = useCallback((next: BankShape) => {
    localStorage.setItem(BANK_STORE, JSON.stringify(next))
    setBank(next)
  }, [])
  // Direct: the timeline, what its export renders, and the frame the picture draws from it
  const [timeline, setTimeline] = useState(initialTimeline.timeline)
  const keepTimeline = (next: Timeline | null) => {
    if (next) localStorage.setItem(TIMELINE, JSON.stringify(next))
    else localStorage.removeItem(TIMELINE)
    setTimeline(next)
  }
  // an edit past what the timeline can play is refused
  const changeTimeline = (next: Timeline) => {
    const why = timelineRefusal(next, timeline, looks)
    if (why) return setError(why)
    keepTimeline(next)
  }
  const [video, setVideo] = useState<Video>({ width: 1920, height: 1080, fps: 30, format: 'mp4' })
  const directShot = useRef<(() => Shot) | null>(null)
  // a look gone from the library takes its entries out of the bank and its keys out of the timeline
  const prune = (next: Scene[]) => {
    const kept = pruneBank(bank, library(next))
    if (kept.scenes.length < bank.scenes.length) changeBank(kept)
    if (!timeline) return
    const { timeline: rest, error } = keptTimeline(timeline, library(next))
    if (!error) return
    keepTimeline(rest)
    setError(error)
  }
  const auto = bank.autopilot
  // seconds from one autopilot change to the next, and each Play change's length: at or under it the autopilot
  // never rests, and its keyframes pass on a curve
  const cycle = (auto.every * 60) / bpm
  const seconds = auto.on ? Math.min(auto.edge.seconds, cycle) : auto.edge.seconds
  const flowing = auto.on && cycle <= auto.edge.seconds
  // a look, or one of its presets, and the bank entry it is if it is one
  const keyframe = useCallback(
    (look: Scene, presetIndex?: number): Keyframe => {
      const entry = entryName(look.name, presetIndex === undefined ? undefined : look.presets[presetIndex].name)
      const scene = presetIndex === undefined ? structuredClone(look) : applyPreset(look, look.presets[presetIndex])
      return { entry: bank.scenes.includes(entry) ? entry : undefined, scene, preset: presetIndex }
    },
    [bank.scenes],
  )
  // an edit past the shader's limits is refused
  const edit = useCallback(
    (fn: (d: Scene) => void) => {
      const next = update(scene, fn)
      const why = refusal({ ...pair, [side]: next })
      if (why) return setError(why)
      setScene(() => next)
    },
    [scene, pair, side, setScene],
  )
  // a knob stepped by 1% of its range a step, from its value as it is when the step lands, so no step is lost
  const nudge = useCallback(
    (address: Address, steps: number) => {
      const [lo, hi] = hardRange(address)
      setScene((s) => setKnob(s, address, resolve(s, address)!.value + steps * (hi - lo) * 0.01))
    },
    [setScene],
  )
  // a keyframe on the edited side, or on the deck cued, which the controls then edit, at once
  const put = useCallback(
    ({ entry, scene: next }: Keyframe, presetIndex?: number, to: Side = side) => {
      const why = refusal({ ...pair, [to]: next })
      if (why) return setError(why)
      // a new look starts its modulators and glides afresh
      Object.assign(lives[to], newLive())
      setPair((p) => ({ ...p, [to]: next }))
      setEntries((e) => ({ ...e, [to]: entry }))
      setPresets((p) => ({ ...p, [to]: presetIndex ?? -1 }))
      setSide(to)
      setPicked(next.levels[0].id)
      setFocus(null)
      setLearning(null)
    },
    [lives, pair, side],
  )
  const load = useCallback(
    (look: Scene, presetIndex?: number) => put(keyframe(look, presetIndex), presetIndex),
    [put, keyframe],
  )

  // Play's transition into next from the side showing, its fader at x: next goes on the other side and the fader
  // runs over to it. A next of the same look carries on its clock. chained: it starts as the last one lands, setting
  // off with its tangent if that aimed at next; after: the keyframe after next, if it is known now.
  const start = (next: Keyframe, from: Side, x: number, chained: boolean, after?: Keyframe) => {
    const to = other(from)
    const { scene } = next
    const why = refusal({ ...pair, [to]: scene })
    if (why) {
      setPlanned(undefined)
      setRefused((n) => n + 1)
      return setError(`${next.entry ?? scene.name}: ${why}`)
    }
    const live = lives[from]
    Object.assign(
      lives[to],
      scene.name === pair[from].name
        ? { ...live, phases: new Map(live.phases), smooth: new Map(live.smooth) }
        : newLive(),
    )
    setPair((p) => ({ ...p, [to]: scene }))
    setEntries((e) => ({ ...e, [to]: next.entry }))
    setPresets((p) => ({ ...p, [to]: next.preset ?? -1 }))
    const upcoming = after ?? (auto.on ? step(bank, looks, { entry: next.entry, scene }) : undefined)
    setPlanned(after ? undefined : upcoming)
    const toward = upcoming && (after || flowing) ? upcoming : undefined
    const tangentOut = toward ? tangent(valuesOf(pair[from]), valuesOf(toward.scene)) : new Map<Address, number>()
    const tangentIn = chained && landing.current.toward === next ? landing.current.tangent : new Map<Address, number>()
    landing.current = { toward, tangent: tangentOut }
    setRun({ to, from: x, seconds, bend: bendOf(pair[from], scene, tangentIn, tangentOut) })
    // B into A runs as A into B the other way round
    setEdge({ ...auto.edge, deepFirst: to === 'a' ? !auto.edge.deepFirst : auto.edge.deepFirst })
  }
  // a change in Play: now, or once the transition running lands
  const go = (next: Keyframe) => (run ? setQueue((q) => [...q, next]) : start(next, side, fader, false))
  const land = () => {
    if (!run) return
    const x = run.to === 'b' ? 1 : 0
    setFader(x)
    setSide(run.to)
    setRun(null)
    const [next, ...rest] = queue
    if (next) {
      setQueue(rest)
      start(next, run.to, x, true, rest[0])
    } else if (mode === 'play' && flowing && running && planned) start(planned, run.to, x, true)
    else landing.current = { tangent: new Map() }
  }
  // the autopilot's next move: in Play a transition, else at once on the edited side
  const autopilot = () => {
    const next = planned ?? step(bank, looks, { entry: entries[side], scene: pair[side] })
    if (!next) return setError('the autopilot has nowhere to go from here: link this entry, or raise wander')
    if (mode === 'play') go(next)
    else {
      setPlanned(undefined)
      put(next)
    }
  }
  const latest = useRef(autopilot)
  useEffect(() => {
    latest.current = autopilot
  })
  // the autopilot rests for what is left of its pace once a change lands, then moves
  useEffect(() => {
    if (mode !== 'play' || !auto.on || !running || run || queue.length) return
    const id = setTimeout(() => latest.current(), Math.max(0, cycle - seconds) * 1000)
    return () => clearTimeout(id)
  }, [mode, auto.on, running, run, queue.length, cycle, seconds, refused])

  const toMode = (next: View | 'play' | 'direct') => {
    if (next === 'play') {
      // Play goes on from the side showing, the fader run home to it if it sat between, and fills the screen
      const showing = fader < 0.5 ? 'a' : 'b'
      setSide(showing)
      setFocus(null)
      const still: Bend = { from: new Map(), to: new Map(), range: new Map() }
      if (fader > 0 && fader < 1 && !run) setRun({ to: showing, from: fader, seconds: auto.edge.seconds, bend: still })
      if (document.fullscreenEnabled && !document.fullscreenElement) void document.documentElement.requestFullscreen()
    } else {
      // what waits for Play stays there
      setQueue([])
      if (document.fullscreenElement) void document.exitFullscreen()
    }
    setMode(next)
  }
  // the entry to add to the bank: the look playing, or its preset in play; it must be one of the looks
  const add = () => {
    const s = pair[side]
    const entry = entryName(s.name, presets[side] < 0 ? undefined : s.presets[presets[side]]?.name)
    if (bank.scenes.includes(entry)) return setError(`${entry} is in the bank already`)
    if (!entryScene(looks, entry)) return setError(`${entry} is not one of the looks: save it first (S)`)
    changeBank({ ...bank, scenes: [...bank.scenes, entry] })
    setEntries((e) => ({ ...e, [side]: entry }))
  }
  // A and B change places, and the fader and the edge's direction flip, so the picture stays as it is
  const swap = useCallback(() => {
    ;[lives.a, lives.b] = [lives.b, lives.a]
    setPair((p) => ({ a: p.b, b: p.a }))
    setFader((x) => 1 - x)
    setEdge((e) => ({ ...e, deepFirst: !e.deepFirst }))
    setSide(other)
  }, [lives])
  const copy = useCallback(() => {
    const to = other(side)
    const why = refusal({ ...pair, [to]: scene })
    if (why) return setError(why)
    const from = lives[side]
    Object.assign(lives[to], { ...from, phases: new Map(from.phases), smooth: new Map(from.smooth) })
    setPair((p) => ({ ...p, [to]: structuredClone(p[side]) }))
  }, [lives, pair, scene, side])
  // Mutate the look showing: at once, or in Play as a transition from the look coming in
  const mutateShown = () => {
    const at = run ? run.to : side
    const { knobs, macros } = playable(pair[at])
    if (!knobs.length && !macros.length)
      return setError('nothing to mutate: give a knob a play range (pick it, then + play range) or add a macro')
    if (mode === 'play') go({ entry: entries[at], scene: mutate(pair[at]) })
    else setScene(mutate)
  }
  const toggleLoop = useCallback(() => edit((d) => (d.loop ? delete d.loop : (d.loop = { seconds: 30 }))), [edit])
  const save = () => {
    try {
      parseScene(structuredClone(scene))
    } catch (err) {
      return setError(`not saved: ${(err as Error).message}`)
    }
    const next = [...saved.filter((s) => s.name !== scene.name), structuredClone(scene)]
    localStorage.setItem(STORE, JSON.stringify(next))
    setSaved(next)
    prune(next)
  }

  // a focused knob that an edit took away is dropped
  const focused = focus && knobsOf(scene).some((k) => k.address === focus) ? focus : null
  // and so is a knob or macro learning a control
  const learningNow =
    learning &&
    ('knob' in learning
      ? !resolve(scene, learning.knob)
      : 'macro' in learning && !scene.macros.some((m) => m.id === learning.macro))
      ? null
      : learning

  // the MIDI handlers read the app as it is now
  const now = useRef({
    scene,
    setScene,
    fader,
    looks,
    mode,
    controls,
    load,
    go,
    keyframe,
    toMode,
    learning: learningNow,
  })
  useEffect(() => {
    now.current = { scene, setScene, fader, looks, mode, controls, load, go, keyframe, toMode, learning: learningNow }
  })
  useEffect(() => {
    if (!midi) return
    const at = new Map<string, number>() // each control's last position, for pickup
    return attach(
      midi,
      () => {
        const { scene, fader, looks, mode, controls } = now.current
        return echoes(scene, controls, fader, (t) =>
          'slot' in t ? looks[t.slot]?.name === scene.name : t.mode === mode,
        )
      },
      {
        inputs: setInputs,
        message: (m) => {
          const { scene, setScene, fader, looks, mode, controls, load, go, keyframe, toMode, learning } = now.current
          // a target learning takes the first control of its kind: knobs, macros and the fader a CC, triggers a note
          if (m.kind === 'note') {
            if (learning && ('slot' in learning || 'mode' in learning)) {
              now.current.learning = null
              setLearning(null)
              return saveControls({ ...controls, buttons: learnTrigger(controls.buttons, learning, m) })
            }
            const t = controls.buttons.find((x) => x.channel === m.channel && x.note === m.number)
            // in Play a slot rides a transition, as the number keys do
            if (t && 'mode' in t) toMode(t.mode)
            else if (t && looks[t.slot] && mode === 'play') go(keyframe(looks[t.slot]))
            else if (t && looks[t.slot]) load(looks[t.slot])
            return
          }
          const key = keyOf('cc', m.channel, m.number)
          const last = at.get(key)
          at.set(key, m.value)
          const ab = controls.fader && keyOf('cc', controls.fader.channel, controls.fader.control) === key
          // only a fader's position is shown, while it waits to pick up
          if (
            (ab && controls.fader!.pickup) ||
            scene.midi?.some((x) => x.pickup && keyOf('cc', x.channel, x.control) === key)
          )
            setPositions(new Map(at))
          if (learning && 'fader' in learning) {
            now.current.learning = null
            setLearning(null)
            // a fader learns with pickup, as it cannot move to where the A/B fader is
            return saveControls({ ...controls, fader: { channel: m.channel, control: m.number, pickup: true } })
          }
          if (learning && ('knob' in learning || 'macro' in learning)) {
            now.current.learning = null
            setLearning(null)
            // the A/B fader lets the control go, and a control learning a target drives it from its first move
            if (ab) saveControls({ buttons: controls.buttons })
            setScene((s) =>
              drive(
                update(s, (d) => learn(d, learning, m)),
                m,
              ),
            )
          } else if (ab) {
            // in Play the fader is the transitions', as with the , and . keys
            if (mode === 'play') return
            if (!controls.fader!.pickup || takes(fader, last, m.value)) setFader(m.value)
          } else setScene((s) => drive(s, m, last))
        },
      },
    )
  }, [midi, saveControls])

  const ctl: Ctl = {
    scene,
    live: shown,
    focus: focused,
    setFocus,
    edit,
    setKnob: (address, value) => setScene((s) => setKnob(s, address, value)),
    nudge,
    pick: setPicked,
    learning: learningNow,
    learn: learnMidi,
    positions,
  }

  // the chips in chain order, for the arrow keys
  const chips = useMemo(
    () => ['background', 'frame', ...allLevels(scene.levels).map(({ level }) => level.id), ...CHIPS.slice(2)],
    [scene.levels],
  )
  const pickedChip = chips.includes(picked) ? picked : 'frame'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      if (e.key === 'Tab') {
        e.preventDefault()
        setHidden((h) => !h)
      } else if (mode === 'direct') {
        // Direct takes the song's keys itself
        if (e.key === 't' || e.key === 'Escape') toMode('stage')
      } else if (e.key === 't') toMode('direct')
      else if (e.key === 'e' || e.key === 'E') toMode(mode === 'edit' ? 'stage' : 'edit')
      else if (e.key === 'd' || e.key === 'D') toMode(mode === 'decks' ? 'stage' : 'decks')
      else if (e.key === 'f') toMode(mode === 'play' ? 'stage' : 'play')
      else if (e.key === 'o') changeBank({ ...bank, autopilot: { ...auto, on: !auto.on } })
      else if (e.key === 'n') autopilot()
      else if (e.key === ' ') {
        e.preventDefault()
        setRunning((r) => !r)
      } else if (/^[0-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey) {
        const look = looks[(Number(e.key) + 9) % 10]
        if (look && mode === 'play') go(keyframe(look))
        else if (look) load(look)
      } else if (e.key === '[' || e.key === ']') {
        // in Play, from the scene coming in while a transition runs
        const at = run ? run.to : side
        const n = pair[at].presets.length
        if (!n) return
        const next = (((presets[at] + (e.key === ']' ? 1 : -1)) % n) + n) % n
        if (mode === 'play') return go(keyframe(pair[at], next))
        setScene((s) => applyPreset(s, s.presets[next]))
        setPresets((p) => ({ ...p, [side]: next }))
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const i = chips.indexOf(pickedChip) + (e.key === 'ArrowRight' ? 1 : -1)
        setPicked(chips[(i + chips.length) % chips.length])
      } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && focused) {
        e.preventDefault()
        nudge(focused, (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1))
      } else if (e.key === 's' && !e.metaKey && !e.ctrlKey) save()
      else if (e.key === 'p')
        setScene((s) => update(s, (d) => d.presets.push(capturePreset(d, `Preset ${d.presets.length + 1}`))))
      else if ((e.key === 'm' || e.key === 'M') && focused && HAS_MIDI) learnMidi({ knob: focused })
      else if (e.key === 'Escape' && mode === 'play') toMode('stage')
      else if (e.key === 'Escape') {
        setFocus(null)
        setLearning(null)
      } else if (e.key === 'l') toggleLoop()
      else if (e.key === 'r') mutateShown()
      // the hand fader's keys are Stage's and Edit's: in Play every change rides a transition
      else if (mode === 'play') return
      else if (e.key === 'a' || e.key === 'b') setSide(e.key)
      else if (e.key === ',' || e.key === '.')
        setFader((x) => Math.min(1, Math.max(0, x + (e.key === '.' ? 0.05 : -0.05))))
      else if (e.key === 'x') swap()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // the wheel over the picture turns the focused knob (over a knob, each knob takes its own)
  const app = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = app.current!
    const onWheel = (e: WheelEvent) => {
      if (!focused || mode === 'play' || !(e.target instanceof Element && e.target.matches('.picture'))) return
      e.preventDefault()
      nudge(focused, wheelSteps(e))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  const looksPanel = (
    <Looks
      looks={looks}
      saved={new Set(saved.map((s) => s.name))}
      onLoad={load}
      onSave={save}
      onDelete={(name) => {
        const next = saved.filter((s) => s.name !== name)
        localStorage.setItem(STORE, JSON.stringify(next))
        setSaved(next)
        prune(next)
      }}
      onError={setError}
    />
  )
  // where Play is, and where it goes next
  const current = run ? entries[run.to] : entries[side]
  const next = queue[0] ?? (auto.on ? planned : undefined)
  const bankPanel = (
    <Bank
      bank={bank}
      looks={looks}
      current={current}
      next={next?.entry}
      onBank={changeBank}
      onGo={(entry) => {
        const k = { entry, scene: entryScene(looks, entry)! }
        if (mode === 'play') go(k)
        else put(k)
      }}
      onAdd={add}
      onStep={autopilot}
      onError={setError}
    />
  )

  const faderPanel = (
    <Fader
      pair={pair}
      side={side}
      fader={fader}
      edge={edge}
      onSide={setSide}
      onFader={setFader}
      onEdge={setEdge}
      onSwap={swap}
      onCopy={copy}
      onPair={(f) => {
        const why = refusal(f)
        if (why) return setError(why)
        Object.assign(lives.a, newLive())
        Object.assign(lives.b, newLive())
        setPair({ a: f.a, b: f.b })
        setFader(f.at)
        setEdge(f.edge)
      }}
      onError={setError}
      pickup={
        controls.fader && waiting(controls.fader, fader, positions)
          ? `MIDI fader waiting: move it to ${Math.round(fader * 100)}% to pick up`
          : undefined
      }
    />
  )

  const midiBlock = (
    <Midi
      connected={!!midi}
      inputs={inputs}
      onConnect={connect}
      looks={looks}
      controls={controls}
      fader={fader}
      onControls={saveControls}
    />
  )

  return (
    <CtlContext.Provider value={ctl}>
      <div ref={app} className={`app ${mode}${hidden ? ' hidden' : ''}`}>
        <Picture
          pair={pair}
          side={side}
          fader={fader}
          edge={edge}
          bpm={bpm}
          running={running}
          lives={lives}
          transition={run}
          decks={mode === 'decks' ? decks.current : undefined}
          onLive={setShown}
          onLand={land}
          shot={mode === 'direct' ? () => directShot.current?.() : undefined}
          aspect={mode === 'direct' ? video.width / video.height : undefined}
        />
        {mode !== 'play' && (
          <header className="bar panel">
            <span className="brand">bermuda</span>
            <input
              className="look-title"
              value={scene.name}
              onChange={(e) => e.target.value && edit((d) => (d.name = e.target.value))}
            />
            <span className="seg">
              <button className={mode === 'stage' ? 'on' : ''} onClick={() => toMode('stage')}>
                Stage
              </button>
              <button className={mode === 'edit' ? 'on' : ''} onClick={() => toMode('edit')}>
                Edit
              </button>
              <button
                className={mode === 'decks' ? 'on' : ''}
                onClick={() => toMode('decks')}
                title="A and B in their own previews either side of the mix, to cue one while the other plays (D)"
              >
                Decks
              </button>
              <button onClick={() => toMode('play')} title="the picture alone, every change a transition (F)">
                Play
              </button>
              <button
                className={mode === 'direct' ? 'on' : ''}
                onClick={() => toMode(mode === 'direct' ? 'stage' : 'direct')}
                title="a timeline of keys and curves over a song, and its export to video (T)"
              >
                Direct
              </button>
            </span>
            <button className="mini" onClick={() => setRunning((r) => !r)} title="space">
              {running ? '❚❚' : '▶'}
            </button>
            <label className="num">
              <span>bpm</span>
              <input
                type="number"
                min={10}
                max={300}
                value={bpm}
                onChange={(e) => e.target.valueAsNumber >= 10 && setBpm(Math.min(300, e.target.valueAsNumber))}
              />
            </label>
            <label
              className="check"
              title="loop: every period snapped to the loop's length, so it plays round seamlessly (L)"
            >
              <input type="checkbox" checked={!!scene.loop} onChange={toggleLoop} />
              loop
            </label>
            {scene.loop && (
              <label className="num">
                <span>loop s</span>
                <input
                  type="number"
                  min={0.1}
                  max={3600}
                  value={scene.loop.seconds}
                  onKeyDown={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    const v = e.target.valueAsNumber
                    if (v >= 0.1 && v <= 3600) edit((d) => (d.loop = { seconds: v }))
                  }}
                />
              </label>
            )}
            <button
              className="mini"
              onClick={mutateShown}
              title="nudge every knob with a play range, and every macro, at random inside its range (R)"
            >
              mutate
            </button>
            {mode === 'direct' ? (
              <span className="dim keys">
                Tab hides · Space play · Home to the start · wheel zooms · shift-drag the waveform loops · double-click
                the keys adds one · T or Esc back to Stage
              </span>
            ) : (
              <span className="dim keys">
                Tab hides · E edit · D decks · T direct · Space pause · 1-0 looks · [ ] presets · ← → chips · ↑ ↓ knob ·
                M MIDI learn · S save · P preset · A B side · , . fader · X swap · L loop · R mutate · F play · O
                autopilot · N next
              </span>
            )}
          </header>
        )}
        {error && (
          <div className="error panel" onClick={() => setError(undefined)}>
            {error} <span className="dim">(click to close)</span>
          </div>
        )}
        <Direct
          timeline={timeline}
          looks={looks}
          entries={looks.flatMap((l) => [l.name, ...l.presets.map((p) => entryName(l.name, p.name))])}
          current={entryName(scene.name, presets[side] < 0 ? undefined : scene.presets[presets[side]]?.name)}
          bpm={bpm}
          active={mode === 'direct'}
          video={video}
          shot={directShot}
          onVideo={setVideo}
          onTimeline={changeTimeline}
          onError={setError}
        />
        {mode === 'direct' ? null : mode === 'play' ? (
          <aside className="panel playbar">
            <div className="now">
              <b>{run ? pair[run.to].name : scene.name}</b>
              {next && (
                <span className="dim">
                  {' '}
                  → {next.entry === current ? 'inside the look' : (next.entry ?? next.scene.name)}
                </span>
              )}
              <button className="mini" title="back to Stage (F or Esc)" onClick={() => toMode('stage')}>
                stage
              </button>
            </div>
            {bankPanel}
          </aside>
        ) : mode === 'stage' ? (
          <>
            <section className="panel top">{faderPanel}</section>
            <nav className="panel left">
              <Chain picked={pickedChip} />
            </nav>
            <aside className="panel right">
              <Modulators />
              <Macros />
              {midiBlock}
              {looksPanel}
              {bankPanel}
            </aside>
            {/* the knob detail floats over the knobs' panel, so opening it moves no knob */}
            <div className="stage-bottom">
              {focused && (
                <div className="panel knob-slot">
                  <KnobDetail />
                </div>
              )}
              <section className="panel bottom">
                <Section chip={pickedChip} />
              </section>
            </div>
          </>
        ) : mode === 'decks' ? (
          <>
            {(['a', 'b'] as const).map((s) => (
              <div key={s} className={`deck-column ${s}`}>
                <Deck
                  side={s}
                  scene={pair[s]}
                  preset={pair[s].presets[presets[s]]?.name}
                  share={run ? undefined : s === 'a' ? 1 - fader : fader}
                  editing={side === s}
                  looks={looks}
                  canvas={(el) => {
                    decks.current[s] = el
                  }}
                  onEdit={() => setSide(s)}
                  onLoad={(look, presetIndex) => put(keyframe(look, presetIndex), presetIndex, s)}
                />
                {s === 'a' ? (
                  <nav className="panel">
                    <div className="block-title" title="the chain, the knobs and the panels under B edit this side">
                      Editing {side.toUpperCase()}
                    </div>
                    <Chain picked={pickedChip} />
                  </nav>
                ) : (
                  <aside className="panel">
                    <Modulators />
                    <Macros />
                    {midiBlock}
                    {looksPanel}
                    {bankPanel}
                  </aside>
                )}
              </div>
            ))}
            <section className="mixer">
              <div className="panel">{faderPanel}</div>
              <div className="panel">
                <Section chip={pickedChip} />
              </div>
              {/* the knob detail floats over the mix's foot, so opening it moves no knob */}
              {focused && (
                <div className="panel knob-slot">
                  <KnobDetail />
                </div>
              )}
            </section>
          </>
        ) : (
          <aside className="rack">
            <div className="panel">{faderPanel}</div>
            <div className="panel rack-chain">
              <Chain picked={pickedChip} />
            </div>
            {/* the knob detail's slot is always there and of one height, so focusing a knob moves no knob */}
            <div className="panel knob-slot">
              {focused ? <KnobDetail /> : <span className="dim">no knob focused</span>}
            </div>
            {chips.map((chip) => (
              <div
                key={chip}
                className={`panel rack-section${chip === pickedChip ? ' picked' : ''}`}
                onClick={() => setPicked(chip)}
              >
                <Section chip={chip} />
              </div>
            ))}
            <div className="panel">
              <Modulators />
              <Macros />
              {midiBlock}
            </div>
            <div className="panel">{looksPanel}</div>
            <div className="panel">{bankPanel}</div>
          </aside>
        )}
      </div>
    </CtlContext.Provider>
  )
}
