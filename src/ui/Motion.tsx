// The modulators and macros. A modulator's chip drags onto any knob; a macro's slider moves all its knobs at once.
// Either can listen to the music: a modulator to its beats or a feature, a macro to a feature.
import { prune } from '../edit'
import { detunePeriods, setMacro, wave } from '../motion'
import { blend } from '../music'
import { clamp, FEATURES, hardRange, LISTENS, resolve, WAVES, type Modulator } from '../scene'
import { Choice, Num, useCtl } from './controls'
import { MOD_DRAG, short } from './Knob'
import { MidiLearn } from './Midi'

// A modulator's wave over one period, as a small sparkline.
function WaveLine({ m }: { m: Modulator }) {
  const d = Array.from(
    { length: 49 },
    (_, i) => `${i ? 'L' : 'M'}${i * 1.5} ${18 - 16 * wave(m, i / 48 + m.phase)}`,
  ).join(' ')
  return (
    <svg className="wave" width="72" height="20">
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

export function Modulators() {
  const { scene, live, edit, setFocus } = useCtl()
  const change = (id: string, fn: (m: Modulator) => void) => edit((d) => fn(d.modulators.find((m) => m.id === id)!))
  // a loop plays each period snapped to it
  const plays = new Map(live.modulators.map((m) => [m.id, m.period]))
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
          <button
            className="mini"
            onClick={() =>
              edit((d) => {
                let n = d.modulators.length + 1
                while (d.modulators.some((m) => m.id === `mod${n}`)) n++
                d.modulators.push({ id: `mod${n}`, wave: 'cos', period: 8, phase: 0, glide: 0, targets: [] })
              })
            }
          >
            + modulator
          </button>
        </span>
      </div>
      {scene.modulators.map((m) => (
        <div className="mod" key={m.id}>
          <div className="mod-head">
            <span
              className="chip-mod"
              draggable
              title="drag onto a knob"
              onDragStart={(e) => {
                e.dataTransfer.setData(MOD_DRAG, m.id)
                e.dataTransfer.effectAllowed = 'link'
              }}
            >
              ⠿ {m.id}
            </span>
            {wavy(m) && <WaveLine m={m} />}
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
            <button
              className="mini"
              onClick={() => edit((d) => (d.modulators = d.modulators.filter((x) => x.id !== m.id)))}
            >
              ×
            </button>
          </div>
          <div className="mod-row">
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
                <Num label="depth" value={t.depth} onChange={(v) => change(m.id, (x) => (x.targets[i].depth = v))} />
                <button className="mini" onClick={() => change(m.id, (x) => x.targets.splice(i, 1))}>
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function Macros() {
  const { scene, live, edit, focus, setFocus } = useCtl()
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
          <button
            className="mini"
            onClick={() =>
              edit((d) => {
                let n = d.macros.length + 1
                while (d.macros.some((m) => m.id === `macro${n}`)) n++
                d.macros.push({ id: `macro${n}`, name: `Macro ${n}`, value: 0, targets: [] })
              })
            }
          >
            + macro
          </button>
        </span>
      </div>
      {scene.macros.map((m) => (
        <div className="mod" key={m.id}>
          <div className="mod-head">
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
          <input
            className="macro-slider"
            type="range"
            min={0}
            max={1}
            step={0.001}
            // one that listens shows where the music has it
            value={m.listen ? (live.macros.find((x) => x.id === m.id)?.value ?? m.value) : m.value}
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => edit((d) => setMacro(d, m.id, e.target.valueAsNumber))}
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
