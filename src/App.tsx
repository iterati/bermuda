// Bermuda: the picture, and over it (Stage) or beside it (Edit) the fader from scene A to scene B, the chain,
// the picked chip's knobs, the modulators, the macros, MIDI, the looks and the bank. Decks puts A and B in their
// own previews either side of the mix, like a DJ mixer, so B can be cued while A plays. The controls edit one side,
// A or B; every change is instant, and so is MIDI, which plays the side being edited and the fader. Play is the
// picture alone with the bank over it: every change there rides a timed transition, the fader run from the side
// showing to the other with the change loaded on it, and the autopilot walks the bank. A song, the microphone or
// a tab, once heard, sets the clock's tempo and lands Play's transitions on its beats. Key I shows the frame-time
// readout over the picture in every view.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { director, missingKeys, pruneTimeline, type Shot } from './direct'
import { BANK, LOOKS } from './looks'
import {
  attach,
  drive,
  driveStrip,
  echoes,
  HAS_MIDI,
  keyOf,
  learn,
  learnStrip,
  learnTrigger,
  release,
  takes,
  unmapControl,
  waiting,
  type Learning,
} from './midi'
import { morphSize } from './morph'
import { applyPreset, capturePreset, copyLive, dice, newLive, setKnob, setMacro, update } from './motion'
import { listen, type From, type Heard, type Listening } from './music'
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
  chipKnobs,
  CHIPS,
  clamp,
  depthOf,
  knobsOf,
  liveKnob,
  MAX_DEPTH,
  MAX_LEVELS,
  notch,
  parseBank,
  parseControls,
  parseScene,
  parseTimeline,
  resolve,
  strip,
  STRIP,
  type Address,
  type Bank as BankShape,
  type Controls,
  type Edge,
  type MidiTarget,
  type Scene,
  type Timeline,
  type View,
} from './scene'
import { needs } from './shader'
import { Bank } from './ui/Bank'
import { Chain } from './ui/Chain'
import { Direct, type Video } from './ui/Direct'
import { CtlContext, Dice, Section, type Armed, type Ctl } from './ui/controls'
import { Deck } from './ui/Deck'
import { Fader } from './ui/Fader'
import { FrameTime, type Frames } from './ui/FrameTime'
import { wheelTurn } from './ui/Knob'
import { KnobDetail } from './ui/KnobDetail'
import { Looks } from './ui/Looks'
import { Midi } from './ui/Midi'
import { Macros, Modulators } from './ui/Motion'
import { Music } from './ui/Music'
import { Perform } from './ui/Perform'
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

// the Stage's right column, one block at a time
const TABS = ['Music', 'Motion', 'Macros', 'MIDI', 'Bank'] as const

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
  // the controls window the UI is undocked into, this one keeping the picture alone, and its copy of the picture;
  // and the document the UI is in
  const [undocked, setUndocked] = useState<Window | null>(null)
  const [monitor, setMonitor] = useState<HTMLCanvasElement | null>(null)
  const doc = undocked?.document ?? document
  // Direct's one container for the life of the app, moved into the window the UI is in, so it never remounts
  const [directSlot] = useState(() => document.createElement('div'))
  const dockDirect = useCallback((el: HTMLDivElement | null) => el?.append(directSlot), [directSlot])
  // the frame-time readout, off at load, and its numbers while it is on
  const [readout, setReadout] = useState(false)
  const [frames, setFrames] = useState<Frames>()
  const [picked, setPicked] = useState<string>(LOOKS[0].levels[0].id)
  const [focus, setFocus] = useState<Address | null>(null)
  // the browser's focus on a knob came from Tab's walk, not a click, so the wheel over the picture turns it
  const tabbing = useRef(false)
  // the knob or macro whose value is being typed
  const [typing, setTyping] = useState<MidiTarget | null>(null)
  // each side's knobs turned by the wheel, typing or ↑ ↓ since a look was put there, which are live
  const [turned, setTurned] = useState<Record<Side, ReadonlySet<Address>>>({ a: new Set(), b: new Set() })
  // the Stage's bottom panel: the Perform strip, or every knob of the picked chip; and its right column's tab
  const [more, setMore] = useState(false)
  const [tab, setTab] = useState<(typeof TABS)[number]>('Motion')
  const [bpm, setBpm] = useState(60)
  // the song, microphone or tab being heard, and what it heard as the picture last drew; and why a tab's sound,
  // once heard, is heard no more
  const [music, setMusic] = useState<Listening | null>(null)
  const [heard, setHeard] = useState<Heard>()
  const [ended, setEnded] = useState<string>()
  // the clock's tempo: the music's once it has found the beat, in whole bpm moved only when the music's moves a
  // whole bpm off it, so a tempo between two holds the autopilot's timer still
  const [heardBpm, setHeardBpm] = useState<number>()
  const tempo = heardBpm ?? bpm
  // each ask for a song, the microphone or a tab: one answered after a later ask stops at once
  const asked = useRef(0)
  const [running, setRunning] = useState(true)
  const [lives] = useState(() => ({ a: newLive(), b: newLive() }))
  // each side's preset in play, for [ and ]
  const [presets, setPresets] = useState<Record<Side, number>>({ a: -1, b: -1 })
  const [midi, setMidi] = useState<MIDIAccess | null>(null)
  const [inputs, setInputs] = useState<string[]>([])
  const [learning, setLearning] = useState<Learning | null>(null)
  // the macro learning by example, the scene as it was armed and its side
  const [armed, setArmed] = useState<(Armed & { side: Side }) | null>(null)
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
  // a song, the microphone or a tab in place of what was heard before; a tab's share ended stops it as stop does
  const forget = useCallback(() => {
    asked.current++
    setMusic(null)
    setHeard(undefined)
    setHeardBpm(undefined)
  }, [])
  const unhear = useCallback(() => {
    music?.stop()
    forget()
  }, [music, forget])
  const hear = useCallback(
    (from: From) => {
      unhear()
      setEnded(undefined)
      const ask = asked.current
      const gone = () => {
        if (ask !== asked.current) return
        forget()
        setEnded("the tab's share ended, so it is heard no more")
      }
      listen(from, gone).then(
        (l) => (ask === asked.current ? setMusic(l) : l.stop()),
        (err: Error) => setError(`music: ${err.message}`),
      )
    },
    [unhear, forget],
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
  // what the picture may draw next, for its warm-up: the bank's entries and links, then the loaded timeline's keys
  // and edges
  const timelineSets = useMemo(() => (timeline ? director(timeline, looks).sets : []), [timeline, looks])
  const { scenes: entered, links } = bank
  const ahead = useMemo(() => {
    const at = (entry: string) => entryScene(looks, entry)!
    return [...entered.map((e) => needs(at(e))), ...links.map(([a, b]) => needs(at(a), at(b))), ...timelineSets]
  }, [entered, links, looks, timelineSets])
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
  const cycle = (auto.every * 60) / tempo
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
  // a knob turned by the wheel, typing or ↑ ↓, which makes it live until a look is put on its side
  const turn = useCallback(
    (address: Address) =>
      setTurned((t) => (t[side].has(address) ? t : { ...t, [side]: new Set([...t[side], address]) })),
    [side],
  )
  // a knob or macro stepped by notches, from its value as it is when the step lands, so no step is lost
  const nudge = useCallback(
    (t: MidiTarget, steps: number) => {
      // a step the wheel's cap dropped turns nothing
      if (!steps) return
      if ('macro' in t)
        return setScene((s) =>
          update(s, (d) =>
            setMacro(d, t.macro, clamp(d.macros.find((m) => m.id === t.macro)!.value + steps * notch(d, t), [0, 1])),
          ),
        )
      turn(t.knob)
      setScene((s) => setKnob(s, t.knob, resolve(s, t.knob)!.value + steps * notch(s, t)))
    },
    [setScene, turn],
  )
  // a value typed
  const set = useCallback(
    (t: MidiTarget, value: number) => {
      if ('macro' in t) return setScene((s) => update(s, (d) => setMacro(d, t.macro, clamp(value, [0, 1]))))
      turn(t.knob)
      setScene((s) => setKnob(s, t.knob, value))
    },
    [setScene, turn],
  )
  // a keyframe on the edited side, or on the deck cued, which the controls then edit, at once
  const put = useCallback(
    ({ entry, scene: next }: Keyframe, presetIndex?: number, to: Side = side) => {
      const why = refusal({ ...pair, [to]: next })
      if (why) return setError(why)
      // a new look comes in where the clock is, its glides afresh
      Object.assign(lives[to], newLive())
      setPair((p) => ({ ...p, [to]: next }))
      setEntries((e) => ({ ...e, [to]: entry }))
      setPresets((p) => ({ ...p, [to]: presetIndex ?? -1 }))
      setSide(to)
      setPicked(next.levels[0].id)
      setFocus(null)
      setLearning(null)
      setTurned((t) => ({ ...t, [to]: new Set() }))
      setTyping(null)
      tabbing.current = false
      const on = doc.activeElement as HTMLElement | null
      if (on?.matches('.knob')) on.blur()
    },
    [lives, pair, side, doc],
  )
  const load = useCallback(
    (look: Scene, presetIndex?: number) => put(keyframe(look, presetIndex), presetIndex),
    [put, keyframe],
  )

  // Play's transition into next from the side showing, its fader at x: next goes on the other side, where the clock
  // is, and the fader runs over to it. A next of the same look carries on its glides. chained: it starts as the last
  // one lands, setting off with its tangent if that aimed at next; after: the keyframe after next, if it is known now.
  const start = (next: Keyframe, from: Side, x: number, chained: boolean, after?: Keyframe) => {
    const to = other(from)
    const { scene } = next
    const why = refusal({ ...pair, [to]: scene })
    if (why) {
      setPlanned(undefined)
      setRefused((n) => n + 1)
      return setError(`${next.entry ?? scene.name}: ${why}`)
    }
    Object.assign(lives[to], scene.name === pair[from].name ? copyLive(lives[from]) : newLive())
    setPair((p) => ({ ...p, [to]: scene }))
    setTurned((t) => ({ ...t, [to]: new Set() }))
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
    // Play alone does not undock: going there closes the controls window, and it opens here
    if (next === 'play' && undocked) {
      undocked.close()
      setUndocked(null)
    }
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
  // the controls into their own window, from a click or key, styled as this one; once open, it comes to the front.
  // Closed, they dock back.
  const undock = () => {
    if (undocked) return undocked.focus()
    const w = window.open('', 'bermuda-controls', 'popup,width=1280,height=800')
    if (!w) return setError('the controls window was blocked: allow pop-ups for this page')
    // in place of what it held, as one reopened by its name holds them already
    w.document.head.replaceChildren(
      ...[...document.querySelectorAll('style, link[rel=stylesheet]')].map((el) => el.cloneNode(true)),
    )
    w.document.title = 'bermuda · controls'
    w.document.body.style.margin = '0'
    w.addEventListener('pagehide', () => setUndocked((u) => (u === w ? null : u)))
    setUndocked(w)
  }
  // this window closing closes the controls window
  useEffect(() => {
    if (!undocked) return
    const close = () => undocked.close()
    window.addEventListener('pagehide', close)
    return () => window.removeEventListener('pagehide', close)
  }, [undocked])
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
    setTurned((t) => ({ a: t.b, b: t.a }))
    setFader((x) => 1 - x)
    setEdge((e) => ({ ...e, deepFirst: !e.deepFirst }))
    setSide(other)
  }, [lives])
  const copy = useCallback(() => {
    const to = other(side)
    const why = refusal({ ...pair, [to]: scene })
    if (why) return setError(why)
    Object.assign(lives[to], copyLive(lives[side]))
    setPair((p) => ({ ...p, [to]: structuredClone(p[side]) }))
    setTurned((t) => ({ ...t, [to]: t[side] }))
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

  // the walk of Tab (by 1) and Shift-Tab (by -1) over the live knobs on screen, round from the last to the first: the
  // Perform strip's first, then the rest in the page's order; from anywhere else, the next one after it on the page.
  // A scene knob takes the app's focus too, as a click gives it.
  const walk = useCallback(
    (by: 1 | -1) => {
      const shown = [...doc.querySelectorAll<HTMLElement>('[data-tab]')].filter((el) => el.checkVisibility())
      const stops = [...shown.filter((el) => el.closest('.perform')), ...shown.filter((el) => !el.closest('.perform'))]
      if (!stops.length) return
      const at = doc.activeElement!
      const i = stops.indexOf(at as HTMLElement)
      const after = (el: HTMLElement) => !!(at.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
      const next =
        i >= 0
          ? stops[(i + by + stops.length) % stops.length]
          : by > 0
            ? (stops.find(after) ?? stops[0])
            : (stops.findLast((el) => !after(el)) ?? stops[stops.length - 1])
      tabbing.current = true
      next.focus()
      if (next.dataset.knob) setFocus(next.dataset.knob)
    },
    [doc],
  )
  // a click in either window ends the Tab focus
  useEffect(() => {
    const click = () => (tabbing.current = false)
    const wins = undocked ? [window, undocked] : [window]
    for (const v of wins) v.addEventListener('pointerdown', click, true)
    return () => wins.forEach((v) => v.removeEventListener('pointerdown', click, true))
  }, [undocked])

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
  // a macro armed on the other side or another look, or one an edit took away, is disarmed
  const armedNow =
    armed && armed.side === side && armed.before.name === scene.name && scene.macros.some((m) => m.id === armed.id)
      ? armed
      : null
  // a look saved in this browser is locked against the dice
  const locked = saved.some((s) => s.name === scene.name)

  // the chips in chain order, for the arrow keys
  const chips = useMemo(
    () => ['background', 'frame', ...allLevels(scene.levels).map(({ level }) => level.id), ...CHIPS.slice(2)],
    [scene.levels],
  )
  const pickedChip = chips.includes(picked) ? picked : 'frame'

  // the Perform strip and its page showing, back to the first when the side, its look or the picked chip changes
  const performing = useMemo(() => strip(scene, pickedChip), [scene, pickedChip])
  const pages = Math.max(1, Math.ceil(performing.length / STRIP))
  const pageKey = `${side}\n${scene.name}\n${pickedChip}`
  const [paged, setPaged] = useState({ key: pageKey, page: 0 })
  const pageOf = (p: typeof paged) => (p.key === pageKey ? Math.min(p.page, pages - 1) : 0)
  const page = pageOf(paged)
  const slots: (MidiTarget | undefined)[] = Array.from({ length: STRIP }, (_, i) => performing[page * STRIP + i])
  const liveKnobs = useMemo(
    () =>
      new Set(
        knobsOf(scene)
          .filter((at) => liveKnob(scene, at, performing, turned[side]))
          .map((at) => at.address),
      ),
    [scene, performing, turned, side],
  )
  // the next page or the one before, round from the last to the first
  const turnPage = (by: 1 | -1) => setPaged((p) => ({ key: pageKey, page: (pageOf(p) + by + pages) % pages }))

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
    slots,
    pages,
    turnPage,
  })
  useEffect(() => {
    now.current = {
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
      slots,
      pages,
      turnPage,
    }
  })
  useEffect(() => {
    if (!midi) return
    const at = new Map<string, number>() // each control's last position, for pickup
    return attach(
      midi,
      () => {
        const { scene, fader, looks, mode, controls, slots, pages } = now.current
        return echoes(
          scene,
          controls,
          fader,
          (t) => ('slot' in t ? looks[t.slot]?.name === scene.name : 'page' in t ? pages > 1 : t.mode === mode),
          slots,
        )
      },
      {
        inputs: setInputs,
        message: (m) => {
          const {
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
            learning,
            slots,
            turnPage,
          } = now.current
          // a target learning takes the first control of its kind: knobs, macros, the fader and the strip's slots a
          // CC, triggers a note
          if (m.kind === 'note') {
            if (learning && ('slot' in learning || 'mode' in learning || 'page' in learning)) {
              now.current.learning = null
              setLearning(null)
              return saveControls({ ...controls, buttons: learnTrigger(controls.buttons, learning, m) })
            }
            const t = controls.buttons.find((x) => x.channel === m.channel && x.note === m.number)
            // in Play a slot rides a transition, as the number keys do
            if (t && 'mode' in t) toMode(t.mode)
            else if (t && 'page' in t) turnPage(t.page)
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
            return saveControls({
              ...release(controls, m.channel, m.number),
              fader: { channel: m.channel, control: m.number, pickup: true },
            })
          }
          if (learning && 'strip' in learning) {
            // a turning encoder sends a burst: a CC this round learned already is not a new one
            if (
              controls.strip?.some((x) => x.channel === m.channel && x.control === m.number && x.index < learning.strip)
            )
              return
            const next = learning.strip < STRIP - 1 ? { strip: learning.strip + 1 } : null
            now.current.learning = next
            setLearning(next)
            now.current.controls = learnStrip(controls, learning.strip, m)
            saveControls(now.current.controls)
            return setScene((s) => update(s, (d) => unmapControl(d, m)))
          }
          if (learning && ('knob' in learning || 'macro' in learning)) {
            now.current.learning = null
            setLearning(null)
            // the A/B fader and the strip let the control go, and a control learning a target drives it from its
            // first move
            saveControls(release(controls, m.channel, m.number))
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
          } else setScene((s) => driveStrip(s, controls, slots, m) ?? drive(s, m, last))
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
    set,
    liveKnobs,
    typing,
    type: setTyping,
    walk,
    pick: setPicked,
    learning: learningNow,
    learn: learnMidi,
    positions,
    locked,
    armed: armedNow,
    arm: (a) => setArmed(a && { ...a, side }),
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // by its tag, as the controls window's elements are of its realm, not this one's
      const tag = (e.target as Element).tagName
      if (tag === 'INPUT' || tag === 'SELECT') return
      if (e.key === 'Tab') {
        e.preventDefault()
        walk(e.shiftKey ? -1 : 1)
      } else if ((e.key === 'h' || e.key === 'H') && !e.metaKey && !e.ctrlKey) setHidden((h) => !h)
      else if ((e.key === 'u' || e.key === 'U') && mode !== 'play' && !e.metaKey && !e.ctrlKey) undock()
      else if (mode === 'direct') {
        // Direct takes the song's keys itself
        if (e.key === 't' || e.key === 'Escape') toMode('stage')
      } else if (e.key === 'Enter') {
        // the value of the focused knob, or of the strip macro Tab is on, typed in its field; a button keeps its Enter
        const el = doc.activeElement as HTMLElement | null
        if (el !== doc.body && !el?.matches('.knob')) return
        const macro = tabbing.current ? el?.dataset.macro : undefined
        const t = macro ? { macro } : focused && { knob: focused }
        if (!t || !doc.querySelector(`[data-${macro ? 'macro' : 'knob'}="${CSS.escape(macro ?? focused!)}"]`)) return
        e.preventDefault()
        setTyping(t)
      } else if (e.key === 't') toMode('direct')
      else if (e.key === 'i') {
        setReadout((r) => !r)
        setFrames(undefined)
      } else if (e.key === 'e' || e.key === 'E') toMode(mode === 'edit' ? 'stage' : 'edit')
      else if (e.key === 'd' || e.key === 'D') toMode(mode === 'decks' ? 'stage' : 'decks')
      else if (e.key === 'f') toMode(mode === 'play' ? 'stage' : 'play')
      else if (e.key === 'o') changeBank({ ...bank, autopilot: { ...auto, on: !auto.on } })
      else if (e.key === 'n') autopilot()
      else if (e.key === 'PageDown' || e.key === 'PageUp') {
        e.preventDefault()
        turnPage(e.key === 'PageDown' ? 1 : -1)
      } else if (e.key === ' ') {
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
        nudge({ knob: focused }, (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1))
      } else if (e.key === 's' && !e.metaKey && !e.ctrlKey) save()
      else if (e.key === 'p')
        setScene((s) => update(s, (d) => d.presets.push(capturePreset(d, `Preset ${d.presets.length + 1}`))))
      else if ((e.key === 'm' || e.key === 'M') && focused && HAS_MIDI) learnMidi({ knob: focused })
      else if (e.key === 'Escape' && mode === 'play') toMode('stage')
      else if (e.key === 'Escape') {
        setFocus(null)
        setLearning(null)
        setArmed(null)
        if (tabbing.current) (doc.activeElement as HTMLElement | null)?.blur()
        tabbing.current = false
      } else if (e.key === 'l') toggleLoop()
      else if (e.key === 'r') mutateShown()
      // the hand fader's keys are Stage's and Edit's: in Play every change rides a transition
      else if (mode === 'play') return
      else if (e.key === 'a' || e.key === 'b') setSide(e.key)
      else if (e.key === ',' || e.key === '.')
        setFader((x) => Math.min(1, Math.max(0, x + (e.key === '.' ? 0.05 : -0.05))))
      else if (e.key === 'x') swap()
      else if ((e.key === 'c' || e.key === 'C') && !e.metaKey && !e.ctrlKey && !locked) {
        const at = (e.key === 'c' ? chipKnobs(scene, pickedChip) : knobsOf(scene)).map((k) => k.address)
        edit((d) => dice(d, at, Math.random))
      }
    }
    // the controls window's keys act where they were pressed
    const wins = undocked ? [window, undocked] : [window]
    for (const v of wins) v.addEventListener('keydown', onKey)
    return () => wins.forEach((v) => v.removeEventListener('keydown', onKey))
  })

  // the wheel over the picture, or the controls window's copy of it, turns the knob or strip macro Tab is on, and else
  // nothing (over a knob, each knob takes its own)
  const app = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = app.current!
    const onWheel = (e: WheelEvent) => {
      const on = doc.activeElement as HTMLElement | null
      if (!tabbing.current || !on?.checkVisibility()) return
      const t = on.dataset.knob ? { knob: on.dataset.knob } : on.dataset.macro ? { macro: on.dataset.macro } : null
      if (!t || mode === 'play' || !(e.target as Element).matches('.picture')) return
      e.preventDefault()
      nudge(t, wheelTurn(e))
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
        setTurned({ a: new Set(), b: new Set() })
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

  const musicBlock = <Music music={music} heard={heard} ended={ended} onListen={hear} onStop={unhear} />

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

  const cls = `app ${mode}${hidden ? ' hidden' : ''}`
  // what floats over the picture ahead of Direct: the readout, the bar and the error; then each view's panels
  const top = (
    <>
      {readout && frames && <FrameTime {...frames} />}
      {mode !== 'play' && (
        <header className="bar panel">
          <span className="brand">bermuda</span>
          <input
            className="look-title"
            value={scene.name}
            onChange={(e) => e.target.value && edit((d) => (d.name = e.target.value))}
          />
          <Dice at={knobsOf(scene).map((k) => k.address)} what="the whole look" />
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
          <button
            className="mini undock"
            onClick={undock}
            title="undock: the controls in their own window, this one the picture alone (U); close it to dock them back"
          >
            {undocked ? '⇲ docked out' : '⇱ undock'}
          </button>
          <button className="mini" onClick={() => setRunning((r) => !r)} title="space">
            {running ? '❚❚' : '▶'}
          </button>
          <label className="num" title={heard?.locked ? "the music's tempo" : undefined}>
            <span>{heard?.locked ? '♪ bpm' : 'bpm'}</span>
            <input
              type="number"
              min={10}
              max={300}
              value={tempo}
              disabled={heard?.locked}
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
              H hides · Space play · Home rewinds · wheel zooms · shift-drag the waveform loops · double-click adds a
              key · U undock · T or Esc to Stage
            </span>
          ) : (
            <span className="dim keys">
              H hides · Tab live knobs · Enter types · E edit · D decks · T direct · Space pause · 1-0 looks · [ ]
              presets · ← → chips · ↑ ↓ knob · PgDn PgUp strip page · M MIDI learn · S save · P preset · A B side · , .
              fader · X swap · L loop · R mutate · C roll chip · ⇧C roll look · F play · U undock · O autopilot · N next
              · I readout
            </span>
          )}
        </header>
      )}
      {error && (
        <div className="error panel" onClick={() => setError(undefined)}>
          {error} <span className="dim">(click to close)</span>
        </div>
      )}
    </>
  )
  const views =
    mode === 'direct' ? null : mode === 'play' ? (
      <aside className="panel playbar">
        <div className="now">
          <b>{run ? pair[run.to].name : scene.name}</b>
          {heard && (
            <span className="dim music-tempo" title="the music's tempo; each change lands on its beat">
              {' '}
              ♪ {heard.locked ? tempo : '…'}
            </span>
          )}
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
          <div className="seg tabs">
            {TABS.map((t) => (
              <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </div>
          {tab === 'Music' && musicBlock}
          {tab === 'Motion' && <Modulators />}
          {tab === 'Macros' && <Macros />}
          {tab === 'MIDI' && midiBlock}
          {tab === 'Bank' && (
            <>
              {looksPanel}
              {bankPanel}
            </>
          )}
        </aside>
        {/* the knob detail floats over the knobs' panel, so opening it moves no knob */}
        <div className="stage-bottom">
          {more && focused && (
            <div className="panel knob-slot">
              <KnobDetail />
            </div>
          )}
          <section className="panel bottom">
            {more ? (
              <>
                <button className="mini strip-back" title="back to the Perform strip" onClick={() => setMore(false)}>
                  ◂ strip
                </button>
                <Section chip={pickedChip} />
              </>
            ) : (
              <Perform slots={slots} page={page} pages={pages} onPage={turnPage} onMore={() => setMore(true)} />
            )}
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
                {musicBlock}
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
        <div className="panel knob-slot">{focused ? <KnobDetail /> : <span className="dim">no knob focused</span>}</div>
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
          {musicBlock}
          <Modulators />
          <Macros />
          {midiBlock}
        </div>
        <div className="panel">{looksPanel}</div>
        <div className="panel">{bankPanel}</div>
      </aside>
    )
  // Direct's place, after the bar and the error panel, in the window the UI is in
  const ui = (
    <>
      {top}
      <div ref={dockDirect} />
      {views}
    </>
  )
  const aspect = mode === 'direct' ? video.width / video.height : undefined
  // undocked, this window keeps the picture alone, whole, out of the view's place, and the UI is in the controls
  // window over its copy of the picture, in the picture's place
  return (
    <CtlContext.Provider value={ctl}>
      <div ref={undocked ? undefined : app} className={undocked ? 'app' : cls}>
        <Picture
          pair={pair}
          side={side}
          fader={fader}
          edge={edge}
          bpm={tempo}
          running={running}
          lives={lives}
          transition={run}
          decks={mode === 'decks' ? decks.current : undefined}
          music={music}
          onLive={(live, now) => {
            setShown(live)
            setHeard(now)
            setHeardBpm((t) =>
              !now?.locked ? undefined : t !== undefined && Math.abs(now.bpm - t) < 1 ? t : Math.round(now.bpm),
            )
          }}
          onLand={land}
          shot={mode === 'direct' ? () => directShot.current?.() : undefined}
          aspect={aspect}
          ahead={ahead}
          onFrames={readout ? setFrames : undefined}
          monitor={monitor}
        />
        {!undocked && ui}
        {createPortal(
          <Direct
            timeline={timeline}
            looks={looks}
            entries={looks.flatMap((l) => [l.name, ...l.presets.map((p) => entryName(l.name, p.name))])}
            current={entryName(scene.name, presets[side] < 0 ? undefined : scene.presets[presets[side]]?.name)}
            bpm={bpm}
            active={mode === 'direct'}
            video={video}
            shot={directShot}
            music={music}
            undocked={undocked}
            onSong={hear}
            onVideo={setVideo}
            onTimeline={changeTimeline}
            onError={setError}
          />,
          directSlot,
        )}
        {undocked &&
          createPortal(
            <div ref={app} className={cls}>
              <canvas
                ref={setMonitor}
                className={`picture${aspect ? ' framed' : ''}`}
                style={aspect ? ({ '--aspect': aspect } as React.CSSProperties) : undefined}
              />
              {ui}
            </div>,
            undocked.document.body,
          )}
      </div>
    </CtlContext.Provider>
  )
}
