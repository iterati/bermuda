// The modulators and macros. A modulator is one line, its chip to drag onto any knob, its editor opened under it
// by a click on the line (the Stage's context panel shows one alone, its editor open); a macro's slider moves all its
// knobs at once. Either can listen to the music: a modulator to its beats or a feature, a macro to a feature. A macro
// learns by example: arm it, move knobs, press learn again; the strip's macro learn does it for a new macro.
import { useState, type MouseEvent, type ReactNode } from 'react'
import { prune } from '../edit'
import { detunePeriods, learnMacro, setMacro, wave } from '../motion'
import { blend } from '../music'
import { clamp, FEATURES, hardRange, LISTENS, resolve, WAVES, type Macro, type Modulator } from '../scene'
import { Choice, Num, useCtl } from './controls'
import { MOD_DRAG, short, Slider } from './Knob'
import { MidiLearn } from './Midi'

// A modulator's wave over one period, as a small sparkline.
function WaveLine({ m }: { m: Modulator }) {
  const d = Array.from(
    { length: 49 },
    (_, i) => `${i ? 'L' : 'M'}${i * 1.5} ${18 - 16 * wave(m, i / 48 + m.phase)}`,
  ).join(' ')
  return (
    <svg className="wave" width="48" height="20" viewBox="0 0 72 20" preserveAspectRatio="none">
      <path d={d} />
    </svg>
  )
}

// What a modulator or macro runs on: its own (the first option) or what the music gives it.
function ListenTo<T extends string>(props: { value: T; options: T[]; title: string; onChange: (v: T) => void }) {
  return (
    <select
      className="mini listen"
      value={props.value}
      title={props.title}
      onKeyDown={(e) => e.stopPropagation()}
      onChange={(e) => props.onChange(e.target.value as T)}
    >
      {props.options.map((o, i) => (
        <option key={o} value={o}>
          {i ? `♪ ${o}` : o}
        </option>
      ))}
    </select>
  )
}

// a modulator that plays a wave, on the clock or the music's beats, rather than a feature
const wavy = (m: Modulator) => !m.listen || m.listen === 'beats'

// A modulator's chip, to drag onto a knob, which takes the drop (Knob.tsx).
export function ModChip(props: { id: string; on?: boolean; title: string; onClick: (e: MouseEvent) => void }) {
  return (
    <span
      className={`chip-mod${props.on ? ' on' : ''}`}
      draggable
      title={props.title}
      onClick={props.onClick}
      onDragStart={(e) => {
        e.dataTransfer.setData(MOD_DRAG, props.id)
        e.dataTransfer.effectAllowed = 'link'
      }}
    >
      ⠿ {props.id}
    </span>
  )
}

// A new modulator, a cosine named after the scene's others; onAdd hears its id.
export function AddModulator(props: { title?: string; onAdd?: (id: string) => void; children: ReactNode }) {
  const { scene, edit } = useCtl()
  return (
    <button
      className="mini"
      title={props.title}
      onClick={() => {
        let n = scene.modulators.length + 1
        while (scene.modulators.some((m) => m.id === `mod${n}`)) n++
        const id = `mod${n}`
        edit((d) => d.modulators.push({ id, wave: 'cos', period: 8, phase: 0, glide: 0, targets: [] }))
        props.onAdd?.(id)
      }}
    >
      {props.children}
    </button>
  )
}

// Every modulator, or only the one named, its editor open.
export function Modulators({ only, onAdd }: { only?: string; onAdd?: (id: string) => void }) {
  const { scene, live, edit, setFocus } = useCtl()
  // the one modulator whose editor is open
  const [open, setOpen] = useState<string | null>(only ?? null)
  const change = (id: string, fn: (m: Modulator) => void) => edit((d) => fn(d.modulators.find((m) => m.id === id)!))
  // a loop plays each period snapped to it
  const plays = new Map(live.modulators.map((m) => [m.id, m.period]))
  const shown = only ? scene.modulators.filter((m) => m.id === only) : scene.modulators
  return (
    <div className="panel-block">
      <div className="block-title">
        <span>Modulators</span>
        <span className="actions">
          <button
            className="mini"
            disabled={scene.modulators.length === 0}
            title="detune every period to the nearest whole number coprime with the shorter ones, so the piece rarely repeats"
            onClick={() => edit(detunePeriods)}
          >
            detune
          </button>
          <AddModulator onAdd={onAdd}>+ modulator</AddModulator>
        </span>
      </div>
      {shown.map((m) => (
        <div className="mod" key={m.id}>
          <div
            className="mod-head mod-line"
            title={open === m.id ? 'close its editor' : 'open its editor'}
            onClick={() => setOpen(open === m.id ? null : m.id)}
          >
            <ModChip id={m.id} title="drag onto a knob" onClick={(e) => e.stopPropagation()} />
            {wavy(m) && <WaveLine m={m} />}
            <span className="mod-sum">
              {wavy(m) ? m.wave : `♪ ${m.listen}`}
              {wavy(m) && <> · {Number((plays.get(m.id) ?? m.period).toFixed(2))}</>}
              <span className="dim">
                {' '}
                · {m.targets.length} knob{m.targets.length === 1 ? '' : 's'}
              </span>
            </span>
            <button
              className="mini"
              onClick={(e) => {
                e.stopPropagation()
                edit((d) => (d.modulators = d.modulators.filter((x) => x.id !== m.id)))
              }}
            >
              ×
            </button>
          </div>
          {open === m.id && (
            <>
              <div className="mod-row">
                <ListenTo
                  value={m.listen ?? 'clock'}
                  options={['clock', ...LISTENS]}
                  title="what it runs on: the clock, the music's beats (its wave on them), or a feature it plays instead of its wave, pushing its knobs up by depth"
                  onChange={(l) =>
                    change(m.id, (x) => {
                      if (l === 'clock') delete x.listen
                      else x.listen = l
                    })
                  }
                />
                {wavy(m) && (
                  <>
                    <Choice
                      label="wave"
                      value={m.wave}
                      options={WAVES}
                      onChange={(w) =>
                        change(m.id, (x) => {
                          x.wave = w
                          if (w === 'steps' && !x.steps) x.steps = [0, 0.33, 0.67, 1]
                          if (w === 'beat' && !x.harmonics) x.harmonics = [4, 3]
                        })
                      }
                    />
                    <Num
                      // the live scene lags an edit that adds a modulator by a frame, so a new one shows its own period
                      label={
                        Math.abs((plays.get(m.id) ?? m.period) - m.period) > 1e-9
                          ? `period · loop ${Number(plays.get(m.id)!.toFixed(2))}`
                          : 'period'
                      }
                      value={m.period}
                      min={0.01}
                      onChange={(v) => change(m.id, (x) => (x.period = v))}
                    />
                    <Num label="phase" value={m.phase} onChange={(v) => change(m.id, (x) => (x.phase = v))} />
                  </>
                )}
                <Num
                  label="glide"
                  value={m.glide}
                  min={0}
                  onChange={(v) => change(m.id, (x) => (x.glide = Math.min(v, 60)))}
                />
              </div>
              {wavy(m) && m.wave === 'beat' && (
                <div className="mod-row">
                  <Num
                    label="harmonic a"
                    value={m.harmonics![0]}
                    min={0}
                    onChange={(v) => change(m.id, (x) => (x.harmonics = [Math.min(v, 64), x.harmonics![1]]))}
                  />
                  <Num
                    label="harmonic b"
                    value={m.harmonics![1]}
                    min={0}
                    onChange={(v) => change(m.id, (x) => (x.harmonics = [x.harmonics![0], Math.min(v, 64)]))}
                  />
                </div>
              )}
              {wavy(m) && m.wave === 'steps' && (
                <div className="mod-row">
                  <label className="num wide">
                    <span>steps 0 to 1</span>
                    <input
                      defaultValue={m.steps!.join(' ')}
                      onKeyDown={(e) => e.stopPropagation()}
                      onBlur={(e) => {
                        const steps = e.target.value
                          .split(/[\s,]+/)
                          .filter(Boolean)
                          .map(Number)
                        if (steps.length && steps.every((s) => s >= 0 && s <= 1)) change(m.id, (x) => (x.steps = steps))
                      }}
                    />
                  </label>
                </div>
              )}
              <div className="targets">
                {m.targets.length === 0 && <span className="dim">no knobs yet: drag the chip onto one</span>}
                {m.targets.map((t, i) => (
                  <span className="target" key={i}>
                    <button className="link" onClick={() => setFocus(t.knob)} title={t.knob}>
                      {short(t.knob)}
                    </button>
                    <Num
                      label="depth"
                      value={t.depth}
                      onChange={(v) => change(m.id, (x) => (x.targets[i].depth = v))}
                    />
                    <button className="mini" onClick={() => change(m.id, (x) => x.targets.splice(i, 1))}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  )
}

// The next macro + macro adds and the strip's macro learn makes: the first free macro<n>, named Macro <n>.
const newMacro = (macros: readonly Macro[]): Macro => {
  let n = macros.length + 1
  while (macros.some((m) => m.id === `macro${n}`)) n++
  return { id: `macro${n}`, name: `Macro ${n}`, value: 0, targets: [] }
}

// The strip's macro learn: pressed, it arms a new macro and opens Macros (onOpen); pressed again, it keeps the knobs
// moved since into it, made only then and only if one moved, or into the macro whose own learn armed it.
export function MacroLearn({ onOpen }: { onOpen: () => void }) {
  const { scene, edit, armed, arm } = useCtl()
  return (
    <button
      className={`mini${armed ? ' armed' : ''}`}
      title="macro learn by example: arm, move the knobs it should move, press again"
      onClick={() => {
        if (!armed) {
          arm({ id: newMacro(scene.macros).id, before: scene, fresh: true })
          return onOpen()
        }
        edit((d) => {
          if (!armed.fresh) return learnMacro(d, armed.id, armed.before)
          const m = newMacro(d.macros)
          d.macros.push(m)
          learnMacro(d, m.id, armed.before)
          if (!m.targets.length) d.macros.pop()
        })
        arm(null)
      }}
    >
      {armed ? '● press to keep' : '● macro learn'}
    </button>
  )
}

export function Macros() {
  const { scene, live, edit, focus, setFocus, armed, arm } = useCtl()
  const pairs = scene.presets.flatMap((_, i) => scene.presets.flatMap((_, j) => (i === j ? [] : [[i, j]])))
  return (
    <div className="panel-block">
      <div className="block-title">
        <span>Macros</span>
        <span className="actions">
          {pairs.length > 0 && (
            <select
              className="mini"
              value=""
              title="a macro from one preset to another, the tone playing it: dark the first, light the second"
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                const [i, j] = e.target.value.split(' ').map(Number)
                edit((d) => blend(d, i, j))
              }}
            >
              <option value="">+ blend presets</option>
              {pairs.map(([i, j]) => (
                <option key={`${i} ${j}`} value={`${i} ${j}`}>
                  {scene.presets[i].name} → {scene.presets[j].name}
                </option>
              ))}
            </select>
          )}
          <button className="mini" onClick={() => edit((d) => d.macros.push(newMacro(d.macros)))}>
            + macro
          </button>
        </span>
      </div>
      {armed?.fresh && (
        <div className="armed-note">a new macro: move knobs, by hand or MIDI, then press ● again by the strip</div>
      )}
      {scene.macros.map((m) => (
        <div className={`mod${armed?.id === m.id ? ' armed' : ''}`} key={m.id}>
          <div className="mod-head macro-head">
            <input
              className="macro-name"
              value={m.name}
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) =>
                e.target.value && edit((d) => (d.macros.find((x) => x.id === m.id)!.name = e.target.value))
              }
            />
            <ListenTo
              value={m.listen ?? 'hand'}
              options={['hand', ...FEATURES]}
              title="what sets it: the hand, or while music plays a feature of it"
              onChange={(l) =>
                edit((d) => {
                  const x = d.macros.find((y) => y.id === m.id)!
                  if (l === 'hand') delete x.listen
                  else x.listen = l
                })
              }
            />
            <MidiLearn target={{ macro: m.id }} />
            <button
              className={`mini${armed?.id === m.id ? ' armed' : ''}`}
              disabled={!!armed && armed.id !== m.id}
              title="move the knobs this macro should drive, then press learn again"
              onClick={() => {
                if (armed) edit((d) => learnMacro(d, armed.id, armed.before))
                arm(armed ? null : { id: m.id, before: scene, fresh: false })
              }}
            >
              learn
            </button>
            <button
              className="mini"
              onClick={() =>
                edit((d) => {
                  d.macros = d.macros.filter((x) => x.id !== m.id)
                  prune(d)
                })
              }
            >
              ×
            </button>
          </div>
          {armed?.id === m.id && <div className="armed-note">move knobs, by hand or MIDI, then press learn</div>}
          <Slider
            className="macro-slider"
            data-learn={JSON.stringify({ macro: m.id })}
            min={0}
            max={1}
            step={0.001}
            // one that listens shows where the music has it
            value={m.listen ? (live.macros.find((x) => x.id === m.id)?.value ?? m.value) : m.value}
            onChange={(v) => edit((d) => setMacro(d, m.id, v))}
          />
          <div className="targets">
            {m.targets.map((t, i) => (
              <span className="target" key={i}>
                <button className="link" onClick={() => setFocus(t.knob)} title={t.knob}>
                  {short(t.knob)}
                </button>
                <Num
                  label="from"
                  value={t.from}
                  onChange={(v) =>
                    edit((d) => (d.macros.find((x) => x.id === m.id)!.targets[i].from = clamp(v, hardRange(t.knob))))
                  }
                />
                <Num
                  label="to"
                  value={t.to}
                  onChange={(v) =>
                    edit((d) => (d.macros.find((x) => x.id === m.id)!.targets[i].to = clamp(v, hardRange(t.knob))))
                  }
                />
                <button
                  className="mini"
                  onClick={() => edit((d) => d.macros.find((x) => x.id === m.id)!.targets.splice(i, 1))}
                >
                  ×
                </button>
              </span>
            ))}
            {focus && !m.targets.some((t) => t.knob === focus) && (
              <button
                className="mini"
                onClick={() =>
                  edit((d) => {
                    const value = resolve(d, focus)!.value
                    d.macros.find((x) => x.id === m.id)!.targets.push({ knob: focus, from: value, to: value })
                  })
                }
              >
                + focused knob
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
