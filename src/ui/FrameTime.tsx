// The frame-time readout (key I): the picture's frames a second over about the last second, the program its main
// picture drew on (its parts as a count that a click opens into their list, or the everything program standing in
// while its own is not ready) and that program's compile time.
import { useState } from 'react'
import type { Drew } from '../render'

export type Frames = { fps: number; drew: Drew }

export function FrameTime({ fps, drew }: Frames) {
  const [open, setOpen] = useState(false)
  const { parts, fallback, ms } = drew
  return (
    <div className="panel frame-time">
      <div>{fps < 10 ? fps.toFixed(1) : Math.round(fps)} fps</div>
      {fallback ? (
        <div>everything (fallback)</div>
      ) : (
        <div className="frame-parts" onClick={() => setOpen((o) => !o)} title="the program's parts (click)">
          {parts.length} {parts.length === 1 ? 'part' : 'parts'}
          {open && <div className="dim">{parts.join(' ')}</div>}
        </div>
      )}
      <div>compiled in {Math.round(ms)} ms</div>
    </div>
  )
}
