// An on-screen knob: drag up and down (shift for fine), or the wheel. Its arc shows the value inside the
// kind's hard range, the brighter band its play range, the dot its live value; drop a modulator chip on it to modulate it.
import { useRef } from 'react'
import { clamp, hardRange, type Address, type Knob as KnobT } from '../scene'

export const MOD_DRAG = 'application/x-bermuda-modulator'

type Props = {
  label: string
  address: Address
  knob: KnobT
  live?: number
  modulated: boolean
  focused: boolean
  onChange: (value: number) => void
  onFocus: () => void
  onModulate: (modulator: string) => void
}

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

export function Knob({ label, address, knob, live, modulated, focused, onChange, onFocus, onModulate }: Props) {
  const [lo, hi] = hardRange(address)
  const f = (v: number) => (clamp(v, [lo, hi]) - lo) / (hi - lo)
  const drag = useRef<{ y: number; value: number } | null>(null)
  const a = (live ?? knob.value) !== knob.value ? f(live!) : undefined
  const dot = a === undefined ? undefined : ((-135 + SWEEP * a) * Math.PI) / 180
  return (
    <div
      className={`knob${focused ? ' focused' : ''}${modulated ? ' modulated' : ''}`}
      title={`${address}\ndrag or wheel; shift for fine`}
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
      onWheel={(e) =>
        onChange(clamp(knob.value - Math.sign(e.deltaY) * (hi - lo) * (e.shiftKey ? 0.002 : 0.01), [lo, hi]))
      }
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(MOD_DRAG)) e.preventDefault()
      }}
      onDrop={(e) => {
        e.preventDefault()
        onModulate(e.dataTransfer.getData(MOD_DRAG))
      }}
    >
      <svg width="44" height="44" viewBox="0 0 44 44">
        <path className="track" d={arc(0, 1)} />
        {knob.play && <path className="play" d={arc(f(knob.play[0]), f(knob.play[1]))} />}
        <path className="value" d={arc(0, f(knob.value))} />
        {dot !== undefined && <circle className="live" cx={22 + R * Math.sin(dot)} cy={22 - R * Math.cos(dot)} r="3" />}
      </svg>
      <div className="knob-value">{format(address, live ?? knob.value)}</div>
      <div className="knob-label">{label}</div>
    </div>
  )
}
