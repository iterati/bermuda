// The MIDI block: the controller's connection, the look's mappings (each to follow to its knob, to give pickup as a
// fader, or to drop), the A/B fader's control, the strip's encoders (learned in turn, slot 1 to 8, and dropped at
// once), and the app's buttons (each to drop), and learning a button. Beside it, what is learning a control, shown on
// every view, and in MIDI map mode what drives each control a controller can drive.
import { useState } from 'react'
import { HAS_MIDI, keyOf, label, mappingOf, positionOf, release, same, unmap, waiting, type Learning } from '../midi'
import { VIEWS, type Controls, type MidiTarget, type Scene, type TriggerTarget, type View } from '../scene'
import { useCtl } from './controls'
import { short } from './Knob'

type Props = {
  connected: boolean
  inputs: string[]
  onConnect: () => void
  looks: Scene[]
  controls: Controls
  fader: number
  onControls: (next: Controls) => void
}

const percent = (v: number) => `${Math.round(v * 100)}%`
const VIEW_NAMES: Record<View, string> = { stage: 'Stage', edit: 'Edit', decks: 'Decks' }

const macroName = (scene: Scene, id: string) => scene.macros.find((m) => m.id === id)!.name
// what learns, or what a button drives, in words
const nameOf = (t: Learning, scene: Scene, looks: Scene[]) =>
  'knob' in t
    ? short(t.knob)
    : 'macro' in t
      ? `macro ${macroName(scene, t.macro)}`
      : 'fader' in t
        ? 'the A/B fader'
        : 'slot' in t
          ? `look ${t.slot + 1}${looks[t.slot] ? ` · ${looks[t.slot].name}` : ''}`
          : 'strip' in t
            ? `slot ${t.strip + 1} of the strip`
            : 'page' in t
              ? `${t.page > 0 ? 'next' : 'previous'} strip page`
              : VIEW_NAMES[t.mode]

export function Midi({ connected, inputs, onConnect, looks, controls, fader, onControls }: Props) {
  const { scene, edit, setFocus, learning, learn, positions } = useCtl()
  const [button, setButton] = useState('slot 0')
  const picked: TriggerTarget = button.startsWith('slot ')
    ? { slot: Number(button.slice(5)) }
    : button.startsWith('page ')
      ? { page: button === 'page 1' ? 1 : -1 }
      : { mode: button as View }
  const learningPicked = !!learning && same(learning, picked)
  return (
    <div className="panel-block">
      <div className="block-title">
        <span>MIDI</span>
        {!HAS_MIDI ? (
          <span className="dim">this browser has no Web MIDI</span>
        ) : connected ? (
          <span className="dim midi-inputs" title={inputs.join('\n')}>
            {inputs.length ? inputs.join(', ') : 'no controller plugged in'}
          </span>
        ) : (
          <button className="mini" title="let this page hear your MIDI controllers" onClick={onConnect}>
            connect
          </button>
        )}
      </div>
      {HAS_MIDI && (
        <div className="targets">
          {!scene.midi?.length && !learning && (
            <span className="dim">
              ◎ map (M): click a knob or macro, then move a control; or focus a knob and press M
            </span>
          )}
          {scene.midi?.map((m) => {
            const at = positions.get(keyOf('cc', m.channel, m.control))
            const to = positionOf(scene, m)
            return (
              <div key={label(m)}>
                <span className="target">
                  <b className="chip-midi">{label(m)}</b>
                  {'knob' in m ? (
                    <button className="link" onClick={() => setFocus(m.knob)} title={m.knob}>
                      {short(m.knob)}
                    </button>
                  ) : (
                    <span className="chip-macro">macro {macroName(scene, m.macro)}</span>
                  )}
                  <label className="check" title="a fader: it takes over only once it passes the value">
                    <input
                      type="checkbox"
                      checked={!!m.pickup}
                      onChange={(e) =>
                        edit((d) => {
                          const x = d.midi!.find((x) => same(x, m))!
                          if (e.target.checked) x.pickup = true
                          else delete x.pickup
                        })
                      }
                    />
                    fader
                  </label>
                  <button className="mini" onClick={() => edit((d) => unmap(d, m))}>
                    ×
                  </button>
                </span>
                {waiting(m, to, positions) && (
                  <div className="pickup">
                    waiting: move the fader {at === undefined ? 'to' : at < to ? 'up to' : 'down to'} {percent(to)}
                    {at !== undefined && <span className="dim"> (at {percent(at)})</span>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {HAS_MIDI && (
        <div className="targets">
          <span className="target">
            <span>A/B fader</span>
            {controls.fader ? (
              <>
                <b className={`chip-midi${waiting(controls.fader, fader, positions) ? ' waiting' : ''}`}>
                  {label(controls.fader)}
                </b>
                <label className="check" title="a fader: it takes over only once it passes where the A/B fader is">
                  <input
                    type="checkbox"
                    checked={!!controls.fader.pickup}
                    onChange={(e) => {
                      const { channel, control } = controls.fader!
                      onControls({
                        ...controls,
                        fader: e.target.checked ? { channel, control, pickup: true } : { channel, control },
                      })
                    }}
                  />
                  fader
                </label>
                <button
                  className="mini"
                  onClick={() => onControls(release(controls, controls.fader!.channel, controls.fader!.control))}
                >
                  ×
                </button>
              </>
            ) : (
              <button
                className={`mini${learning && 'fader' in learning ? ' learning' : ''}`}
                title="map the next MIDI control you move to the A/B fader"
                onClick={() => learn(learning && 'fader' in learning ? null : { fader: true })}
              >
                {learning && 'fader' in learning ? 'move a control…' : 'MIDI learn'}
              </button>
            )}
          </span>
          {controls.fader && waiting(controls.fader, fader, positions) && (
            <div className="pickup">waiting: move the fader to {percent(fader)}</div>
          )}
          <span className="target">
            <span>strip</span>
            {controls.strip?.length ? (
              <>
                <span className="dim">
                  {[...controls.strip]
                    .sort((a, b) => a.index - b.index)
                    .map((x) => `${x.index + 1} ch${x.channel} cc${x.control}`)
                    .join(', ')}
                </span>
                <button
                  className="mini"
                  title="forget the strip's encoders"
                  onClick={() => onControls({ ...controls, strip: [] })}
                >
                  ×
                </button>
              </>
            ) : null}
            <button
              className={`mini${learning && 'strip' in learning ? ' learning' : ''}`}
              title="map the next 8 encoders you turn to the strip's 8 slots, in turn, on every look (Esc stops)"
              onClick={() => learn(learning && 'strip' in learning ? null : { strip: 0 })}
            >
              {learning && 'strip' in learning ? 'turn an encoder…' : 'learn the strip'}
            </button>
          </span>
        </div>
      )}
      {HAS_MIDI && (
        <div className="targets midi-buttons">
          <span className="target">
            <label className="choice">
              <span>button for</span>
              <select value={button} onChange={(e) => setButton(e.target.value)} onKeyDown={(e) => e.stopPropagation()}>
                {looks.map((look, i) => (
                  <option key={look.name} value={`slot ${i}`}>
                    look {i + 1} · {look.name}
                  </option>
                ))}
                {VIEWS.map((v) => (
                  <option key={v} value={v}>
                    {VIEW_NAMES[v]}
                  </option>
                ))}
                <option value="page 1">next strip page</option>
                <option value="page -1">previous strip page</option>
              </select>
            </label>
            <button
              className={`mini${learningPicked ? ' learning' : ''}`}
              title="map the next button you press to this; its LED shows when it is on"
              onClick={() => learn(learningPicked ? null : picked)}
            >
              {learningPicked ? 'press a button…' : 'MIDI learn'}
            </button>
          </span>
          {controls.buttons.map((t) => (
            <span className="target" key={label(t)}>
              <b className="chip-midi">{label(t)}</b>
              <span>{nameOf(t, scene, looks)}</span>
              <button
                className="mini"
                onClick={() => onControls({ ...controls, buttons: controls.buttons.filter((x) => x !== t) })}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// What is learning a control, with its cancel, on every view; in MIDI map mode with nothing learning, how to map.
export function MidiLearning({ looks }: { looks: Scene[] }) {
  const { scene, learning, learn, mapping } = useCtl()
  if (!learning && !mapping) return null
  return (
    <div className="midi-learning panel">
      {!learning ? (
        <span>MIDI map: click a control, then move a knob or press a button on the controller · Esc ends</span>
      ) : 'strip' in learning ? (
        <span>
          turn the encoder for <b>slot {learning.strip + 1}</b>
        </span>
      ) : (
        <span>
          {'slot' in learning || 'mode' in learning || 'page' in learning ? 'press a button' : 'move a control'} for{' '}
          <b>{nameOf(learning, scene, looks)}</b>
        </span>
      )}
      {learning && (
        <button className="mini" title="Esc" onClick={() => learn(null)}>
          cancel
        </button>
      )}
    </div>
  )
}

// What drives a target, if anything: a knob's or macro's CC on the look, the A/B fader's and a strip slot's CC, a
// button's note.
function driver(scene: Scene, controls: Controls, t: Learning) {
  if ('knob' in t || 'macro' in t) return mappingOf(scene, t)
  if ('fader' in t) return controls.fader
  if ('strip' in t) return controls.strip?.find((x) => x.index === t.strip)
  return controls.buttons.find((x) => same(x, t))
}

// In MIDI map mode, the CC or note that drives a control, its whole label its title; a strip slot's its encoder.
export function MapTag({ target }: { target: Learning }) {
  const { scene, controls, mapping } = useCtl()
  const d = mapping ? driver(scene, controls, target) : undefined
  if (!d) return null
  const text = 'note' in d ? `n${d.note}` : `cc${d.control}`
  return (
    <b className="map-tag" title={label(d)}>
      {'strip' in target ? `E${target.strip + 1} · ${text}` : text}
    </b>
  )
}

// A knob's or a macro's control, in MIDI map mode: its mapping to drop (amber while its fader waits to pick up), else
// a learn button. Without Web MIDI there is no map mode, so a mapping a look brings shows, to drop.
export function MidiLearn({ target }: { target: MidiTarget }) {
  const { scene, edit, learning, learn, positions, mapping } = useCtl()
  const map = mappingOf(scene, target)
  const on = !!learning && same(learning, target)
  if (!mapping && (HAS_MIDI || !map)) return null
  if (map)
    return (
      <span className="pair">
        <b
          className={`chip-midi${waiting(map, positionOf(scene, map), positions) ? ' waiting' : ''}`}
          title={`the MIDI control driving this${map.pickup ? ', a fader with pickup' : ''}`}
        >
          {label(map)}
        </b>
        <button className="mini" title="forget the MIDI control" onClick={() => edit((d) => unmap(d, target))}>
          ×
        </button>
      </span>
    )
  return (
    <button
      className={`mini${on ? ' learning' : ''}`}
      disabled={!HAS_MIDI}
      title={HAS_MIDI ? 'map the next MIDI control you move to this (M on a focused knob)' : 'no Web MIDI here'}
      onClick={() => learn(on ? null : target)}
    >
      {on ? 'move a control…' : 'MIDI learn'}
    </button>
  )
}
