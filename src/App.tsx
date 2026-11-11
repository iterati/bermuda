// Bermuda: the picture, and over it (Stage) or beside it (Edit) the fader from scene A to scene B, the chain,
// the picked chip's knobs, the modulators, the macros and the bank. The controls edit one side, A or B; every
// change is instant.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { LOOKS } from './looks'
import { morphSize } from './morph'
import { applyPreset, capturePreset, newLive, setKnob, update } from './motion'
import {
  allLevels,
  CHIPS,
  depthOf,
  hardRange,
  knobsOf,
  MAX_DEPTH,
  MAX_LEVELS,
  parseScene,
  resolve,
  type Address,
  type Edge,
  type Scene,
} from './scene'
import { Bank } from './ui/Bank'
import { Chain } from './ui/Chain'
import { CtlContext, Section, type Ctl } from './ui/controls'
import { Fader } from './ui/Fader'
import { KnobDetail } from './ui/KnobDetail'
import { Macros, Modulators } from './ui/Motion'
import { Picture, type Side } from './ui/Picture'

const STORE = 'bermuda.looks'

function loadSaved(): { looks: Scene[]; error?: string } {
  const text = localStorage.getItem(STORE)
  if (!text) return { looks: [] }
  try {
    return { looks: (JSON.parse(text) as unknown[]).map(parseScene) }
  } catch (err) {
    // set aside whole, so the next save does not write over the looks that did parse
    localStorage.setItem(`${STORE}.broken`, text)
    localStorage.removeItem(STORE)
    return { looks: [], error: `saved looks moved to ${STORE}.broken: ${(err as Error).message}` }
  }
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

const other = (side: Side): Side => (side === 'a' ? 'b' : 'a')

export function App() {
  const [initial] = useState(loadSaved)
  const [saved, setSaved] = useState(initial.looks)
  const [error, setError] = useState(initial.error)
  const [pair, setPair] = useState<Record<Side, Scene>>(() => ({
    a: structuredClone(LOOKS[0]),
    b: structuredClone(LOOKS.find((l) => l.name.startsWith('Tapestry 7 '))!),
  }))
  const [side, setSide] = useState<Side>('a')
  const [fader, setFader] = useState(0)
  const [edge, setEdge] = useState<Edge>({ seconds: 2, stagger: 0.4, deepFirst: false })
  const scene = pair[side]
  const setScene = useCallback((fn: (s: Scene) => Scene) => setPair((p) => ({ ...p, [side]: fn(p[side]) })), [side])
  const [shown, setShown] = useState(scene)
  const [mode, setMode] = useState<'stage' | 'edit'>('stage')
  const [hidden, setHidden] = useState(false)
  const [picked, setPicked] = useState<string>(LOOKS[0].levels[0].id)
  const [focus, setFocus] = useState<Address | null>(null)
  const [bpm, setBpm] = useState(60)
  const [running, setRunning] = useState(true)
  const [lives] = useState(() => ({ a: newLive(), b: newLive() }))
  // each side's preset in play, for [ and ]
  const [presets, setPresets] = useState<Record<Side, number>>({ a: -1, b: -1 })

  // a look saved under a built-in's name takes its place in the bank
  const looks = useMemo(
    () => [
      ...LOOKS.map((l) => saved.find((s) => s.name === l.name) ?? l),
      ...saved.filter((s) => !LOOKS.some((l) => l.name === s.name)),
    ],
    [saved],
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
  const load = useCallback(
    (look: Scene, presetIndex?: number) => {
      const next = presetIndex === undefined ? structuredClone(look) : applyPreset(look, look.presets[presetIndex])
      const why = refusal({ ...pair, [side]: next })
      if (why) return setError(why)
      // a new look starts its modulators and glides afresh
      Object.assign(lives[side], newLive())
      setScene(() => next)
      setPresets((p) => ({ ...p, [side]: presetIndex ?? -1 }))
      setPicked(next.levels[0].id)
      setFocus(null)
    },
    [lives, pair, side, setScene],
  )
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
  const toggleLoop = useCallback(() => edit((d) => (d.loop ? delete d.loop : (d.loop = { seconds: 30 }))), [edit])
  const save = useCallback(() => {
    try {
      parseScene(structuredClone(scene))
    } catch (err) {
      return setError(`not saved: ${(err as Error).message}`)
    }
    const next = [...saved.filter((s) => s.name !== scene.name), structuredClone(scene)]
    localStorage.setItem(STORE, JSON.stringify(next))
    setSaved(next)
  }, [saved, scene])

  // a focused knob that an edit took away is dropped
  const focused = focus && knobsOf(scene).some((k) => k.address === focus) ? focus : null
  const ctl: Ctl = {
    scene,
    live: shown,
    focus: focused,
    setFocus,
    edit,
    setKnob: (address, value) => setScene((s) => setKnob(s, address, value)),
    pick: setPicked,
  }

  // the chips in chain order, for the arrow keys
  const chips = useMemo(
    () => ['frame', ...allLevels(scene.levels).map(({ level }) => level.id), ...CHIPS.slice(1)],
    [scene.levels],
  )
  const pickedChip = chips.includes(picked) ? picked : 'frame'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      if (e.key === 'Tab') {
        e.preventDefault()
        setHidden((h) => !h)
      } else if (e.key === 'e' || e.key === 'E') setMode((m) => (m === 'stage' ? 'edit' : 'stage'))
      else if (e.key === ' ') {
        e.preventDefault()
        setRunning((r) => !r)
      } else if (/^[0-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey) {
        const look = looks[(Number(e.key) + 9) % 10]
        if (look) load(look)
      } else if (e.key === '[' || e.key === ']') {
        const n = scene.presets.length
        if (!n) return
        const next = (((presets[side] + (e.key === ']' ? 1 : -1)) % n) + n) % n
        setScene((s) => applyPreset(s, s.presets[next]))
        setPresets((p) => ({ ...p, [side]: next }))
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const i = chips.indexOf(pickedChip) + (e.key === 'ArrowRight' ? 1 : -1)
        setPicked(chips[(i + chips.length) % chips.length])
      } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && focused) {
        e.preventDefault()
        const [lo, hi] = hardRange(focused)
        const step = (hi - lo) * (e.shiftKey ? 0.1 : 0.01) * (e.key === 'ArrowUp' ? 1 : -1)
        setScene((s) => setKnob(s, focused, resolve(s, focused)!.value + step))
      } else if (e.key === 's' && !e.metaKey && !e.ctrlKey) save()
      else if (e.key === 'p')
        setScene((s) => update(s, (d) => d.presets.push(capturePreset(d, `Preset ${d.presets.length + 1}`))))
      else if (e.key === 'Escape') setFocus(null)
      else if (e.key === 'a' || e.key === 'b') setSide(e.key)
      else if (e.key === ',' || e.key === '.')
        setFader((x) => Math.min(1, Math.max(0, x + (e.key === '.' ? 0.05 : -0.05))))
      else if (e.key === 'x') swap()
      else if (e.key === 'l') toggleLoop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [looks, load, save, scene, presets, side, chips, pickedChip, focused, setScene, swap, toggleLoop])

  const bank = (
    <Bank
      looks={looks}
      saved={new Set(saved.map((s) => s.name))}
      onLoad={load}
      onSave={save}
      onDelete={(name) => {
        const next = saved.filter((s) => s.name !== name)
        localStorage.setItem(STORE, JSON.stringify(next))
        setSaved(next)
      }}
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
    />
  )

  return (
    <CtlContext.Provider value={ctl}>
      <div className={`app ${mode}${hidden ? ' hidden' : ''}`}>
        <Picture
          pair={pair}
          side={side}
          fader={fader}
          edge={edge}
          bpm={bpm}
          running={running}
          lives={lives}
          onLive={setShown}
        />
        <header className="bar panel">
          <span className="brand">bermuda</span>
          <input
            className="look-title"
            value={scene.name}
            onChange={(e) => e.target.value && edit((d) => (d.name = e.target.value))}
          />
          <span className="seg">
            <button className={mode === 'stage' ? 'on' : ''} onClick={() => setMode('stage')}>
              Stage
            </button>
            <button className={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')}>
              Edit
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
          <span className="dim keys">
            Tab hides · E edit · Space pause · 1-0 looks · [ ] presets · ← → chips · ↑ ↓ knob · S save · P preset · A B
            side · , . fader · X swap · L loop
          </span>
        </header>
        {error && (
          <div className="error panel" onClick={() => setError(undefined)}>
            {error} <span className="dim">(click to close)</span>
          </div>
        )}
        {mode === 'stage' ? (
          <>
            <section className="panel top">{faderPanel}</section>
            <nav className="panel left">
              <Chain picked={pickedChip} />
            </nav>
            <aside className="panel right">
              <Modulators />
              <Macros />
              {bank}
            </aside>
            <section className="panel bottom">
              <KnobDetail />
              <Section chip={pickedChip} />
            </section>
          </>
        ) : (
          <aside className="rack">
            <div className="panel">{faderPanel}</div>
            <div className="panel rack-chain">
              <Chain picked={pickedChip} />
            </div>
            {focused && (
              <div className="panel">
                <KnobDetail />
              </div>
            )}
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
            </div>
            <div className="panel">{bank}</div>
          </aside>
        )}
      </div>
    </CtlContext.Provider>
  )
}
