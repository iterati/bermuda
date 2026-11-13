// The MIDI block: the controller's connection, the look's mappings (each to follow to its knob, to give pickup as a
// fader, or to drop), and the controller drawn: the strip's encoders (learned in turn, slot 1 to 8, and dropped at
// once), the A/B fader's control, and its 16 pads, each learned on, over the app's buttons (each to drop). Beside it,
// what is learning a control, shown on every view, in MIDI map mode what drives each control a controller can drive,
// and the pads, the drawing's and the Stage's.
import { useState } from 'react'
import { HAS_MIDI, keyOf, label, mappingOf, positionOf, release, same, unmap, waiting, type Learning } from '../midi'
import {
  STRIP,
  VIEWS,
  type Controls,
  type MidiTarget,
  type Scene,
  type Trigger,
  type TriggerTarget,
  type View,
} from '../scene'
import { useCtl } from './controls'
import { short } from './Knob'

type Props = {
  connected: boolean
  inputs: string[]
  onConnect: () => void
  looks: Scene[]
  controls: Controls
  fader: number
  lit: (t: TriggerTarget) => boolean
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

export function Midi({ connected, inputs, onConnect, looks, controls, fader, lit, onControls }: Props) {
  const { scene, edit, setFocus, learning, learn, positions } = useCtl()
  const [button, setButton] = useState('slot 0')
  const picked: TriggerTarget = button.startsWith('slot ')
    ? { slot: Number(button.slice(5)) }
    : button.startsWith('page ')
      ? { page: button === 'page 1' ? 1 : -1 }
      : { mode: button as View }
  const learningPicked = !!learning && same(learning, picked)
  const faderWaits = !!controls.fader && waiting(controls.fader, fader, positions)
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
      {/* the controller drawn, each part learned on it, and the learned buttons' list under it */}
      {HAS_MIDI && (
        <div className="controller">
          <div className="dim">X-Touch Mini · layer A</div>
          <div className="sm-row">
            <span className="sm-label">encoders → the strip</span>
            {Array.from({ length: STRIP }, (_, i) => {
              const e = controls.strip?.find((x) => x.index === i)
              return (
                <span
                  key={i}
                  className={`sm-enc${e ? '' : ' none'}${learning && 'strip' in learning && learning.strip === i ? ' learning' : ''}`}
                  title={e ? label(e) : `slot ${i + 1}: no encoder`}
                >
                  E{i + 1}
                  <i>{e ? `cc${e.control}` : '—'}</i>
                </span>
              )
            })}
            {controls.strip?.length ? (
              <button
                className="mini"
                title="forget the strip's encoders"
                onClick={() => onControls({ ...controls, strip: [] })}
              >
                ×
              </button>
            ) : null}
            <button
              className={`mini${learning && 'strip' in learning ? ' learning' : ''}`}
              title="map the next 8 encoders you turn to the strip's 8 slots, in turn, on every look (Esc stops)"
              onClick={() => learn(learning && 'strip' in learning ? null : { strip: 0 })}
            >
              {learning && 'strip' in learning ? 'turn an encoder…' : 'learn the strip'}
            </button>
          </div>
          <div className="sm-row">
            <span className="sm-label">fader → A/B</span>
            <span
              className={`sm-enc${controls.fader ? '' : ' none'}${faderWaits ? ' waiting' : ''}${learning && 'fader' in learning ? ' learning' : ''}`}
              title={controls.fader ? label(controls.fader) : 'the A/B fader: no control'}
            >
              F<i>{controls.fader ? `cc${controls.fader.control}${controls.fader.pickup ? ' · pickup' : ''}` : '—'}</i>
            </span>
            {controls.fader ? (
              <>
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
          </div>
          {faderWaits && <div className="pickup">waiting: move the fader to {percent(fader)}</div>}
          <div className="targets midi-buttons">
            <span className="sm-label">buttons: click a pad, then press its button</span>
            <span className="target">
              <label className="choice">
                <span>button for</span>
                <select
                  value={button}
                  onChange={(e) => setButton(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                >
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
            {/* a learned pad learns its own target again, an empty one what button for picks */}
            <Pads
              looks={looks}
              lit={lit}
              notes
              onPad={(t) => {
                const to = t ?? picked
                learn(learning && same(learning, to) ? null : to)
              }}
            />
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

// The X-Touch Mini's 16 buttons on layer A, notes 8 to 15 the top row and 16 to 23 the bottom one
const PAD_NOTES = Array.from({ length: 16 }, (_, i) => 8 + i)

// a button's target without its note, as a learn takes it
const targetOf = (t: Trigger): TriggerTarget =>
  'slot' in t ? { slot: t.slot } : 'page' in t ? { page: t.page } : { mode: t.mode }
// what a learned button does, in a pad's few words
const padName = (t: TriggerTarget, looks: Scene[]) =>
  'slot' in t
    ? `${t.slot + 1}${looks[t.slot] ? ` ${looks[t.slot].name}` : ''}`
    : 'page' in t
      ? t.page > 0
        ? 'page ▸'
        : '◂ page'
      : VIEW_NAMES[t.mode]

// The controller's 16 pads, each the button learned on its note (on any channel), lit as its LED is, pulsing while
// its target learns, and with its note when notes is on; a pad pressed gives its target, or undefined if it has none.
// A learned pad is a control a controller can drive, for MIDI map mode.
export function Pads({
  looks,
  lit,
  notes,
  onPad,
}: {
  looks: Scene[]
  lit: (t: TriggerTarget) => boolean
  notes: boolean
  onPad: (t: TriggerTarget | undefined) => void
}) {
  const { scene, controls, learning } = useCtl()
  return (
    <div className="pads">
      {PAD_NOTES.map((n) => {
        const b = controls.buttons.find((x) => x.note === n)
        const t = b && targetOf(b)
        return (
          <button
            key={n}
            className={`hwpad${t ? '' : ' empty'}${t && lit(t) ? ' lit' : ''}${t && learning && same(learning, t) ? ' learning' : ''}`}
            title={b ? `${label(b)}: ${nameOf(b, scene, looks)}` : `note ${n}: not learned`}
            data-learn={t && JSON.stringify(t)}
            onClick={() => onPad(t)}
          >
            <span>{t ? padName(t, looks) : '·'}</span>
            {notes && (
              <b className="map-tag" title={b ? label(b) : `note ${n}: not learned`}>
                n{n}
              </b>
            )}
          </button>
        )
      })}
    </div>
  )
}
