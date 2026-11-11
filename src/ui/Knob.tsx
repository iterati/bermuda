// An on-screen knob: drag up and down (shift for fine), or the wheel over it; its title says what it does. Its arc
// shows the value inside the kind's hard range, the brighter band its play range, the dot its live value; drop a
// modulator chip on it to modulate it. Its corner names the MIDI control that drives it, dimmed while a fader waits
// to pick it up.
import { useEffect, useRef } from 'react'
import { label as midiLabel, mappingOf, positionOf, waiting } from '../midi'
import { clamp, knobKind, resolve, type Address } from '../scene'
import { useCtl } from './controls'

export const MOD_DRAG = 'application/x-bermuda-modulator'

const SWEEP = 270
const R = 17

function arc(from: number, to: number) {
  const point = (f: number) => {
    const a = ((-135 + SWEEP * f) * Math.PI) / 180
    return `${22 + R * Math.sin(a)} ${22 - R * Math.cos(a)}`
  }
  if (to - from < 1e-4) return ''
  return `M ${point(from)} A ${R} ${R} 0 ${(to - from) * SWEEP > 180 ? 1 : 0} 1 ${point(to)}`
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

// A wheel turn in knob steps, up for more: a mouse's notch is one, a trackpad's stream its share of one; shift for
// fine, which some systems send as a sideways turn.
export const wheelSteps = (e: WheelEvent) => {
  const d = e.deltaY || (e.shiftKey ? e.deltaX : 0)
  return (-d / (e.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? 100 : 3)) * (e.shiftKey ? 0.2 : 1)
}

export const short = (address: string) => address.replace(/^levels/, '').replace(/variants\[(\d+)\]\.shape/, 'v$1')

// A knob of the scene by its address.
export function Knob({ label, at: address }: { label: string; at: Address }) {
  const { scene, live: shown, focus, setFocus, edit, setKnob, nudge, learning, positions } = useCtl()
  const knob = resolve(scene, address)!
  // the live scene lags the scene by a frame after a structural edit
  const live = resolve(shown, address)?.value
  const modulated = scene.modulators.some((m) => m.targets.some((t) => t.knob === address))
  const focused = focus === address
  const midi = mappingOf(scene, { knob: address })
  const learningThis = !!learning && 'knob' in learning && learning.knob === address
  const onFocus = () => setFocus(address)
  const onChange = (v: number) => setKnob(address, v)
  const kind = knobKind(address)
  const [lo, hi] = kind.range
  const f = (v: number) => (clamp(v, [lo, hi]) - lo) / (hi - lo)
  const drag = useRef<{ y: number; value: number } | null>(null)
  // the wheel's own listener, as React's is passive and the panel under the knob would scroll on the same turn
  const el = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const knob = el.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      nudge(address, wheelSteps(e))
    }
    knob.addEventListener('wheel', onWheel, { passive: false })
    return () => knob.removeEventListener('wheel', onWheel)
  }, [address, nudge])
  const a = (live ?? knob.value) !== knob.value ? f(live!) : undefined
  const dot = a === undefined ? undefined : ((-135 + SWEEP * a) * Math.PI) / 180
  return (
    <div
      ref={el}
      className={`knob${focused ? ' focused' : ''}${modulated ? ' modulated' : ''}${learningThis ? ' learning' : ''}`}
      title={`${kind.label}: ${kind.help}\n${address} · drag or wheel; shift for fine`}
      onPointerDown={(e) => {
        onFocus()
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { y: e.clientY, value: knob.value }
      }}
      onPointerMove={(e) => {
        if (!drag.current) return
        const step = ((hi - lo) / 180) * (e.shiftKey ? 0.1 : 1)
        onChange(clamp(drag.current.value + (drag.current.y - e.clientY) * step, [lo, hi]))
      }}
      onPointerUp={() => (drag.current = null)}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(MOD_DRAG)) e.preventDefault()
      }}
      onDrop={(e) => {
        e.preventDefault()
        const id = e.dataTransfer.getData(MOD_DRAG)
        edit((d) => {
          // a drop carries the id of a modulator of this scene, or of one a look switch took away
          const m = d.modulators.find((x) => x.id === id)
          if (m && !m.targets.some((t) => t.knob === address)) m.targets.push({ knob: address, depth: (hi - lo) / 10 })
        })
      }}
    >
      <svg width="44" height="44" viewBox="0 0 44 44">
        <path className="track" d={arc(0, 1)} />
        {knob.play && <path className="play" d={arc(f(knob.play[0]), f(knob.play[1]))} />}
        <path className="value" d={arc(0, f(knob.value))} />
        {dot !== undefined && <circle className="live" cx={22 + R * Math.sin(dot)} cy={22 - R * Math.cos(dot)} r="3" />}
      </svg>
      {midi && (
        <span
          className={`knob-midi${waiting(midi, positionOf(scene, midi), positions) ? ' waiting' : ''}`}
          title={`${midiLabel(midi)}${midi.pickup ? ', a fader with pickup' : ''}`}
        >
          cc{midi.control}
        </span>
      )}
      <div className="knob-value">{format(address, live ?? knob.value)}</div>
      <div className="knob-label">{label}</div>
    </div>
  )
}
