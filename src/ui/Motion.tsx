// The modulators and macros. A modulator's chip drags onto any knob; a macro's slider moves all its knobs at once.
import { setMacro, wave } from '../motion'
import { resolve, WAVES, type Modulator } from '../scene'
import { Choice, useCtl } from './controls'
import { MOD_DRAG } from './Knob'

const short = (address: string) => address.replace(/^levels/, '').replace(/variants\[(\d+)\]\.shape/, 'v$1')

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

export function Modulators() {
  const { scene, edit, setFocus } = useCtl()
  const change = (id: string, fn: (m: Modulator) => void) => edit((d) => fn(d.modulators.find((m) => m.id === id)!))
  return (
    <div className="panel-block">
      <div className="block-title">
        <span>Modulators</span>
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
            <WaveLine m={m} />
            <button
              className="mini"
              onClick={() => edit((d) => (d.modulators = d.modulators.filter((x) => x.id !== m.id)))}
            >
              ×
            </button>
          </div>
          <div className="mod-row">
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
            <Field label="period" value={m.period} min={0.01} onChange={(v) => change(m.id, (x) => (x.period = v))} />
            <Field label="phase" value={m.phase} onChange={(v) => change(m.id, (x) => (x.phase = v))} />
            <Field
              label="glide"
              value={m.glide}
              min={0}
              onChange={(v) => change(m.id, (x) => (x.glide = Math.min(v, 60)))}
            />
          </div>
          {m.wave === 'beat' && (
            <div className="mod-row">
              <Field
                label="harmonic a"
                value={m.harmonics?.[0] ?? 4}
                min={0}
                onChange={(v) => change(m.id, (x) => (x.harmonics = [Math.min(v, 64), x.harmonics?.[1] ?? 3]))}
              />
              <Field
                label="harmonic b"
                value={m.harmonics?.[1] ?? 3}
                min={0}
                onChange={(v) => change(m.id, (x) => (x.harmonics = [x.harmonics?.[0] ?? 4, Math.min(v, 64)]))}
              />
            </div>
          )}
          {m.wave === 'steps' && (
            <div className="mod-row">
              <label className="num wide">
                <span>steps 0 to 1</span>
                <input
                  defaultValue={(m.steps ?? []).join(' ')}
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
                <Field label="depth" value={t.depth} onChange={(v) => change(m.id, (x) => (x.targets[i].depth = v))} />
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
  const { scene, edit, focus, setFocus } = useCtl()
  return (
    <div className="panel-block">
      <div className="block-title">
        <span>Macros</span>
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
            <button className="mini" onClick={() => edit((d) => (d.macros = d.macros.filter((x) => x.id !== m.id)))}>
              ×
            </button>
          </div>
          <input
            className="macro-slider"
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={m.value}
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => edit((d) => setMacro(d, m.id, e.target.valueAsNumber))}
          />
          <div className="targets">
            {m.targets.map((t, i) => (
              <span className="target" key={i}>
                <button className="link" onClick={() => setFocus(t.knob)} title={t.knob}>
                  {short(t.knob)}
                </button>
                <Field
                  label="from"
                  value={t.from}
                  onChange={(v) => edit((d) => (d.macros.find((x) => x.id === m.id)!.targets[i].from = v))}
                />
                <Field
                  label="to"
                  value={t.to}
                  onChange={(v) => edit((d) => (d.macros.find((x) => x.id === m.id)!.targets[i].to = v))}
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

function Field({
  label,
  value,
  onChange,
  min,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
}) {
  return (
    <label className="num">
      <span>{label}</span>
      <input
        type="number"
        step="any"
        min={min}
        value={Number(value.toFixed(5))}
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          const v = e.target.valueAsNumber
          if (Number.isFinite(v) && (min === undefined || v >= min)) onChange(v)
        }}
      />
    </label>
  )
}
