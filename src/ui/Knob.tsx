// An on-screen knob: the wheel over it turns it (shift for fine), Enter on it or a double-click types its value, and
// a live one (scene.ts liveKnob) is a stop of Tab's walk; its title says what it does. Its arc
// shows the value inside the kind's hard range (a macro's 0 to 1), the brighter band its play range, the dot its
// live value; drop a modulator chip on it to modulate it. Its face shows what else moves it: ticks outside the arc
// where its spread puts the other levels of its link group (or a thin arc to where it runs at the deepest level, on
// the knobs the shader spreads over depth), a dotted tail for its glide, longer the slower, and an inner arc as far
// as its modulators swing it. Its corner names the MIDI control that drives it, dimmed while a fader waits to pick
// it up.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { label as midiLabel, mappingOf, positionOf, same, waiting } from '../midi'
import { allLevels, clamp, knobKind, playRange, resolve, type Address, type MidiTarget } from '../scene'
import { useCtl } from './controls'

export const MOD_DRAG = 'application/x-bermuda-modulator'

const SWEEP = 270
const R = 17
// the spread's marks just outside the arc, the modulators' inside it
const OUT = 20.5
const IN = 13
// the knobs whose spread the shader runs over depth, deepest last (render.ts)
const DEPTH = [
  'contour.rings',
  'contour.radialWeight',
  'line.width',
  'line.falloff',
  'line.dots.count',
  'line.dots.size',
]

// a place round the sweep (0 to 1) at radius r
const point = (f: number, r: number) => {
  const a = ((-135 + SWEEP * f) * Math.PI) / 180
  return [22 + r * Math.sin(a), 22 - r * Math.cos(a)]
}

function arc(from: number, to: number, r = R) {
  if (to - from < 1e-4) return ''
  return `M ${point(from, r).join(' ')} A ${r} ${r} 0 ${(to - from) * SWEEP > 180 ? 1 : 0} 1 ${point(to, r).join(' ')}`
}

export const format = (address: Address, v: number) => {
  const deg = /turn|twist|hue|lch\[2\]/.test(address)
  const text =
    v === 0
      ? '0'
      : Math.abs(v) >= 100
        ? v.toFixed(0)
        : Math.abs(v) >= 10
          ? v.toFixed(1)
          : Math.abs(v) >= 0.1
            ? v.toFixed(2)
            : v.toFixed(4)
  return deg ? `${text}°` : text
}

// A wheel turn in notches, up for more: a mouse's notch is one, a trackpad's stream its share of one (100 pixels,
// deltaMode 0, or 3 lines to a notch); shift for a fifth, which some systems send as a sideways turn.
export const wheelSteps = (e: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode' | 'shiftKey'>) => {
  const d = e.deltaY || (e.shiftKey ? e.deltaX : 0)
  return (-d / (e.deltaMode === 0 ? 100 : 3)) * (e.shiftKey ? 0.2 : 1)
}

// The most notches the wheel turns each way in an animation frame: a trackpad's stream past it is dropped, its
// momentum too, while a mouse's notches come a frame or more apart and land whole.
export const CAP = 4
// The steps of a turn that land, the frame's turn so far being sum.
export const capped = (sum: number, steps: number) => clamp(sum + steps, [-CAP, CAP]) - sum

// the wheel's turn in this animation frame, over every knob and slider
let frame: number | undefined
let sum = 0
// A wheel event's notches that land, under the frame's cap.
export function wheelTurn(e: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode' | 'shiftKey'>) {
  frame ??= requestAnimationFrame(() => {
    frame = undefined
    sum = 0
  })
  const steps = capped(sum, wheelSteps(e))
  sum += steps
  return steps
}

// A range input the wheel turns, a notch 1% of min to max (at least its step), landed on its step; a press, click or
// drag moves it no more. What a turn rounds away carries on to the next, so a trackpad's stream and shift's fifths add
// up. data-learn: what it learns in MIDI map mode, if a controller can drive it.
export function Slider(props: {
  className?: string
  'data-learn'?: string
  min: number
  max: number
  step: number
  value: number
  onChange: (v: number) => void
}) {
  const { min, max, step } = props
  const el = useRef<HTMLInputElement>(null)
  // the value and handler as rendered, read by the wheel between renders
  const now = useRef(props)
  useLayoutEffect(() => {
    now.current = props
  })
  // the last turn: where it reached, the step it landed on, and the value it turned from
  const last = useRef<{ raw: number; sent: number; from: number } | null>(null)
  // the wheel's own listener, and the press's, as React's are passive: the panel under it would scroll on the turn
  useEffect(() => {
    const input = el.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const { value, onChange } = now.current
      const t = last.current
      // a turn before the last one rendered goes on from where that one reached
      const from = t && (value === t.sent || value === t.from) ? t.raw : value
      const raw = clamp(from + wheelTurn(e) * Math.max((max - min) / 100, step), [min, max])
      const sent = Number(clamp(min + Math.round((raw - min) / step) * step, [min, max]).toFixed(12))
      last.current = { raw, sent, from: value }
      if (sent !== value) onChange(sent)
    }
    const still = (e: Event) => e.preventDefault()
    input.addEventListener('wheel', onWheel, { passive: false })
    for (const type of ['pointerdown', 'mousedown', 'touchstart'])
      input.addEventListener(type, still, { passive: false })
    return () => {
      input.removeEventListener('wheel', onWheel)
      for (const type of ['pointerdown', 'mousedown', 'touchstart']) input.removeEventListener(type, still)
    }
  }, [min, max, step])
  return (
    <input
      ref={el}
      className={props.className}
      data-learn={props['data-learn']}
      type="range"
      min={min}
      max={max}
      step={step}
      value={props.value}
      onKeyDown={(e) => e.stopPropagation()}
      onChange={(e) => props.onChange(e.target.valueAsNumber)}
    />
  )
}

export const short = (address: string) => address.replace(/^levels/, '').replace(/variants\[(\d+)\]\.shape/, 'v$1')

// A knob of the scene by its address, or a macro's (running 0 to 1, moving its knobs; it takes no focus, play range
// or modulator, and as one on the strip it is always live).
export function Knob(props: { label: string } & ({ at: Address } | { macro: string })) {
  const { label } = props
  const {
    scene,
    live: shown,
    focus,
    setFocus,
    edit,
    nudge,
    set,
    learning,
    positions,
    liveKnobs,
    typing,
    type,
    walk,
  } = useCtl()
  // the knob's address, or the macro's id
  const id = 'at' in props ? props.at : props.macro
  const isMacro = 'macro' in props
  const target: MidiTarget = isMacro ? { macro: id } : { knob: id }
  const macro = isMacro ? scene.macros.find((m) => m.id === id)! : undefined
  const knob = macro ? undefined : resolve(scene, id)!
  // a macro that listens shows where the music has it
  const value = macro ? (shown.macros.find((m) => m.id === id)?.value ?? macro.value) : knob!.value
  // the live scene lags the scene by a frame after a structural edit
  const live = macro ? undefined : resolve(shown, id)?.value
  const modulated = !macro && scene.modulators.some((m) => m.targets.some((t) => t.knob === id))
  const focused = !macro && focus === id
  const midi = mappingOf(scene, target)
  const learningThis = !!learning && same(learning, target)
  const el = useRef<HTMLDivElement>(null)
  // a knob shown twice, on the strip and in the context panel, types in one of them: the one holding the focus, or
  // else the first
  const typingThis =
    !!typing &&
    same(typing, target) &&
    !!el.current &&
    (() => {
      const doc = el.current.ownerDocument
      const all = [...doc.querySelectorAll(`[data-${isMacro ? 'macro' : 'knob'}="${CSS.escape(id)}"]`)]
      const at = all.find((k) => k.contains(doc.activeElement))
      return (at ?? all[0]) === el.current
    })()
  const kind = macro ? undefined : knobKind(id)
  const [lo, hi] = kind ? kind.range : [0, 1]
  const f = (v: number) => (clamp(v, [lo, hi]) - lo) / (hi - lo)
  // the wheel's own listener, as React's is passive and the panel under the knob would scroll on the same turn
  useEffect(() => {
    const knob = el.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      nudge(isMacro ? { macro: id } : { knob: id }, wheelTurn(e))
    }
    knob.addEventListener('wheel', onWheel, { passive: false })
    return () => knob.removeEventListener('wheel', onWheel)
  }, [id, isMacro, nudge])
  // the field closes: this one, and not another opened since
  const done = useCallback(
    () => type((t) => (t && same(t, isMacro ? { macro: id } : { knob: id }) ? null : t)),
    [type, id, isMacro],
  )
  // the typed value's field, opened holding the value, selected; its hint over the page just above the knob, as the
  // panel under the knob clips what leaves it, kept there as the panel scrolls
  const field = useRef<HTMLInputElement>(null)
  const [hintAt, setHintAt] = useState<{ x: number; y: number; body: HTMLElement } | null>(null)
  useLayoutEffect(() => {
    if (!typingThis) return
    field.current!.select()
    // the knob's own document, the controls window's while the UI is undocked
    const page = el.current!.ownerDocument
    const place = () => {
      const r = el.current!.getBoundingClientRect()
      setHintAt({ x: r.x + r.width / 2, y: r.y, body: page.body })
    }
    place()
    page.defaultView!.addEventListener('scroll', place, true)
    return () => {
      page.defaultView!.removeEventListener('scroll', place, true)
      // a knob gone while its field is open, as a strip page turns, leaves it closed
      done()
    }
  }, [typingThis, done])
  const text = macro ? value.toFixed(2) : format(id, value).replace('°', '')
  // Enter sets the value typed and Esc leaves it, the knob keeping the browser's focus; Tab sets it and walks on. A
  // field that is not a number sets nothing, and a click away leaves it.
  const onType = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (e.key !== 'Enter' && e.key !== 'Escape' && e.key !== 'Tab') return
    e.preventDefault()
    const typed = e.currentTarget.value.trim().replace(/°$/, '')
    if (e.key !== 'Escape' && typed !== text && typed !== '' && Number.isFinite(Number(typed)))
      set(target, Number(typed))
    done()
    el.current!.focus()
    if (e.key === 'Tab') walk(e.shiftKey ? -1 : 1)
  }
  const a = (live ?? value) !== value ? f(live!) : undefined
  // the levels following this knob's level, which play it with its spread (motion.ts advance)
  const own = /(?:^levels|\.below)\[([^\]]+)\](?!.*\.below\[)/.exec(id)?.[1]
  const followers =
    knob?.spread && own
      ? allLevels(scene.levels)
          .find(({ level }) => level.id === own)!
          .list.filter((l) => l.link === own).length
      : 0
  const ticks = Array.from({ length: followers }, (_, i) => f(value + (knob!.spread! * (i + 1)) / (followers + 1)))
  const depth = knob?.spread && DEPTH.includes(id) ? [value, value + knob.spread].map(f).sort((x, y) => x - y) : []
  const glide = knob?.glide ? 0.04 + 0.21 * Math.sqrt(knob.glide / 60) : 0
  // how far down and up the modulators swing it: a wave either side, a feature up from where it rests by its depth
  const swing = (macro ? [] : scene.modulators).flatMap((m) =>
    m.targets
      .filter((t) => t.knob === id)
      .map((t) =>
        m.listen && m.listen !== 'beats'
          ? [Math.max(0, -t.depth), Math.max(0, t.depth)]
          : [Math.abs(t.depth), Math.abs(t.depth)],
      ),
  )
  const [plo, phi] = knob ? playRange(id, knob) : [lo, hi]
  const reach = (v: number) => f(clamp(v, [Math.min(plo, value), Math.max(phi, value)]))
  const down = reach(value - swing.reduce((s, [d]) => s + d, 0))
  const up = reach(value + swing.reduce((s, [, u]) => s + u, 0))
  return (
    <div
      ref={el}
      tabIndex={-1}
      data-tab={macro || liveKnobs.has(id) ? '' : undefined}
      data-knob={macro ? undefined : id}
      data-macro={macro?.id}
      data-learn={JSON.stringify(target)}
      className={`knob${focused ? ' focused' : ''}${modulated ? ' modulated' : ''}${learningThis ? ' learning' : ''}${macro ? ' macro' : ''}${typingThis ? ' typing' : ''}`}
      title={
        macro
          ? `macro ${macro.name}: moves ${macro.targets.length} knob${macro.targets.length === 1 ? '' : 's'}\nwheel; shift for fine · Enter or double-click types`
          : `${kind!.label}: ${kind!.help}\n${id}${knob!.glide ? ` · glide ${knob!.glide} s` : ''} · wheel; shift for fine · Enter or double-click types`
      }
      onPointerDown={() => {
        if (!macro) setFocus(id)
      }}
      onDoubleClick={() => type(target)}
      onDragOver={(e) => {
        if (!macro && e.dataTransfer.types.includes(MOD_DRAG)) e.preventDefault()
      }}
      onDrop={(e) => {
        if (macro) return
        e.preventDefault()
        const mod = e.dataTransfer.getData(MOD_DRAG)
        edit((d) => {
          // a drop carries the id of a modulator of this scene, or of one a look switch took away
          const m = d.modulators.find((x) => x.id === mod)
          if (m && !m.targets.some((t) => t.knob === id)) m.targets.push({ knob: id, depth: (hi - lo) / 10 })
        })
      }}
    >
      <svg width="44" height="44" viewBox="0 0 44 44">
        <path className="track" d={arc(0, 1)} />
        {knob?.play && <path className="play" d={arc(f(knob.play[0]), f(knob.play[1]))} />}
        <path className="value" d={arc(0, f(value))} />
        {glide > 0 && <path className="glide" d={arc(Math.max(0, f(value) - glide), f(value))} />}
        {swing.length > 0 && <path className="swing" d={arc(down, up, IN)} />}
        {depth.length > 0 && <path className="spread" d={arc(depth[0], depth[1], OUT)} />}
        {ticks.map((t, i) => {
          const [x, y] = point(t, OUT)
          return <circle key={i} className="tick" cx={x} cy={y} r="1.5" />
        })}
        {a !== undefined && <circle className="live" cx={point(a, R)[0]} cy={point(a, R)[1]} r="3" />}
      </svg>
      {midi && (
        <span
          className={`knob-midi${waiting(midi, positionOf(scene, midi), positions) ? ' waiting' : ''}`}
          title={`${midiLabel(midi)}${midi.pickup ? ', a fader with pickup' : ''}`}
        >
          cc{midi.control}
        </span>
      )}
      {typingThis ? (
        <input ref={field} className="knob-type" defaultValue={text} autoFocus onKeyDown={onType} onBlur={done} />
      ) : (
        <div className="knob-value">{macro ? value.toFixed(2) : format(id, live ?? value)}</div>
      )}
      <div className="knob-label">{label}</div>
      {typingThis &&
        hintAt &&
        createPortal(
          <div className="type-hint" style={{ left: hintAt.x, top: hintAt.y }}>
            Enter sets · Esc · Tab next · {kind ? `${format(id, lo)} to ${format(id, hi)}` : '0 to 1'}
          </div>,
          hintAt.body,
        )}
    </div>
  )
}
