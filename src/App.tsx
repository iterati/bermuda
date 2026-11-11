// Bermuda: the picture, and over it (Stage) or beside it (Edit) the chain, the picked chip's knobs,
// the modulators, the macros and the bank. Every change is instant.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { LOOKS } from './looks'
import { applyPreset, capturePreset, newLive, setKnob, update } from './motion'
import { allLevels, hardRange, knobsOf, parseScene, resolve, type Address, type Scene } from './scene'
import { Bank } from './ui/Bank'
import { Chain } from './ui/Chain'
import { CHIPS, CtlContext, Section, type Ctl } from './ui/controls'
import { KnobDetail } from './ui/KnobDetail'
import { Macros, Modulators } from './ui/Motion'
import { Picture } from './ui/Picture'

const STORE = 'bermuda.looks'

function loadSaved(): { looks: Scene[]; error?: string } {
  const text = localStorage.getItem(STORE)
  if (!text) return { looks: [] }
  try {
    return { looks: (JSON.parse(text) as unknown[]).map(parseScene) }
  } catch (err) {
    return { looks: [], error: `saved looks: ${(err as Error).message}` }
  }
}

export function App() {
  const [initial] = useState(loadSaved)
  const [saved, setSaved] = useState(initial.looks)
  const [error, setError] = useState(initial.error)
  const [scene, setScene] = useState(() => structuredClone(LOOKS[0]))
  const [shown, setShown] = useState(scene)
  const [mode, setMode] = useState<'stage' | 'edit'>('stage')
  const [hidden, setHidden] = useState(false)
  const [picked, setPicked] = useState<string>(LOOKS[0].levels[0].id)
  const [focus, setFocus] = useState<Address | null>(null)
  const [bpm, setBpm] = useState(60)
  const [running, setRunning] = useState(true)
  const [live] = useState(newLive)
  const [preset, setPreset] = useState(-1)

  // a look saved under a built-in's name takes its place in the bank
  const looks = useMemo(
    () => [
      ...LOOKS.map((l) => saved.find((s) => s.name === l.name) ?? l),
      ...saved.filter((s) => !LOOKS.some((l) => l.name === s.name)),
    ],
    [saved],
  )
  const edit = useCallback((fn: (d: Scene) => void) => setScene((s) => update(s, fn)), [])
  const load = useCallback((look: Scene, presetIndex?: number) => {
    const next = presetIndex === undefined ? structuredClone(look) : applyPreset(look, look.presets[presetIndex])
    setScene(next)
    setPreset(presetIndex ?? -1)
    setPicked(next.levels[0].id)
    setFocus(null)
  }, [])
  const save = useCallback(() => {
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
        const base = looks.find((l) => l.name === scene.name) ?? scene
        if (!base.presets.length) return
        const n = base.presets.length
        const next = (((preset + (e.key === ']' ? 1 : -1)) % n) + n) % n
        setScene(applyPreset(scene, base.presets[next]))
        setPreset(next)
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
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [looks, load, save, scene, preset, chips, pickedChip, focused])

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

  return (
    <CtlContext.Provider value={ctl}>
      <div className={`app ${mode}${hidden ? ' hidden' : ''}`}>
        <Picture scene={scene} bpm={bpm} running={running} live={live} onLive={setShown} />
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
          <span className="dim keys">
            Tab hides · E edit · Space pause · 1-0 looks · [ ] presets · ← → chips · ↑ ↓ knob · S save · P preset
          </span>
        </header>
        {error && (
          <div className="error panel" onClick={() => setError(undefined)}>
            {error} <span className="dim">(click to close)</span>
          </div>
        )}
        {mode === 'stage' ? (
          <>
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
