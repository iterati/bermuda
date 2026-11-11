// The focused knob in full: its value, play range, spread and glide, the modulators and macros that drive it.
import { clamp, hardRange, resolve, type Knob } from '../scene'
import { useCtl } from './controls'
import { format } from './Knob'

function Num({
  label,
  value,
  onChange,
  step,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
}) {
  return (
    <label className="num">
      <span>{label}</span>
      <input
        type="number"
        step={step ?? 'any'}
        value={Number(value.toFixed(5))}
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) =>
          e.target.value !== '' && Number.isFinite(e.target.valueAsNumber) && onChange(e.target.valueAsNumber)
        }
      />
    </label>
  )
}

export function KnobDetail() {
  const { scene, live, focus, edit, setKnob } = useCtl()
  const knob = focus ? resolve(scene, focus) : undefined
  if (!focus || !knob) return null
  const range = hardRange(focus)
  const change = (fn: (k: Knob) => void) => edit((d) => fn(resolve(d, focus)!))
  const mods = scene.modulators.flatMap((m) =>
    m.targets.map((t, i) => ({ m, t, i })).filter(({ t }) => t.knob === focus),
  )
  const macros = scene.macros.filter((m) => m.targets.some((t) => t.knob === focus))
  return (
    <div className="detail">
      <div className="detail-head">
        <code>{focus}</code>
        <span className="dim">
          hard {format(focus, range[0])} to {format(focus, range[1])} · live{' '}
          {format(focus, (resolve(live, focus) ?? knob).value)}
        </span>
      </div>
      <div className="detail-row">
        <Num label="value" value={knob.value} onChange={(v) => setKnob(focus, v)} />
        <Num
          label="spread"
          value={knob.spread ?? 0}
          onChange={(v) => change((k) => (v ? (k.spread = v) : delete k.spread))}
        />
        <Num
          label="glide s"
          value={knob.glide ?? 0}
          onChange={(v) => change((k) => (v > 0 ? (k.glide = Math.min(v, 60)) : delete k.glide))}
        />
        {knob.play ? (
          <>
            <Num
              label="play from"
              value={knob.play[0]}
              onChange={(v) => change((k) => (k.play = [clamp(Math.min(v, k.play![1]), range), k.play![1]]))}
            />
            <Num
              label="play to"
              value={knob.play[1]}
              onChange={(v) => change((k) => (k.play = [k.play![0], clamp(Math.max(v, k.play![0]), range)]))}
            />
            <button className="mini" onClick={() => change((k) => delete k.play)}>
              clear play range
            </button>
          </>
        ) : (
          <button
            className="mini"
            title="the range every modulator and macro keeps this knob to"
            onClick={() => {
              const span = (range[1] - range[0]) / 8
              change((k) => (k.play = [clamp(k.value - span, range), clamp(k.value + span, range)]))
            }}
          >
            + play range
          </button>
        )}
      </div>
      {mods.length > 0 && (
        <div className="detail-row">
          {mods.map(({ m, t, i }) => (
            <span className="pair" key={`${m.id}${i}`}>
              <b className="chip-mod">{m.id}</b>
              <Num
                label="depth"
                value={t.depth}
                onChange={(v) => edit((d) => (d.modulators.find((x) => x.id === m.id)!.targets[i].depth = v))}
              />
              <Num
                label="phase spread"
                value={t.phaseSpread ?? 0}
                onChange={(v) =>
                  edit((d) => {
                    const target = d.modulators.find((x) => x.id === m.id)!.targets[i]
                    if (v) target.phaseSpread = v
                    else delete target.phaseSpread
                  })
                }
              />
              <button
                className="mini"
                onClick={() => edit((d) => d.modulators.find((x) => x.id === m.id)!.targets.splice(i, 1))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="detail-row">
        {macros.map((m) => (
          <span key={m.id} className="chip-macro">
            macro {m.name}
          </span>
        ))}
        {scene.macros
          .filter((m) => !macros.includes(m))
          .map((m) => (
            <button
              key={m.id}
              className="mini"
              onClick={() =>
                edit((d) =>
                  d.macros.find((x) => x.id === m.id)!.targets.push({ knob: focus, from: knob.value, to: knob.value }),
                )
              }
            >
              + to macro {m.name}
            </button>
          ))}
        <span className="dim">drag a modulator chip onto a knob to modulate it</span>
      </div>
    </div>
  )
}
