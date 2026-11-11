// The picture: one canvas and the renderer, drawing every animation frame. Scenes A and B each run on their own
// clock; between the fader's ends it draws the morph. It hands the edited side's live scene up a few times a
// second so the knobs can show it.
import { useEffect, useMemo, useRef } from 'react'
import { snapLoop } from '../loop'
import { morph } from '../morph'
import { advance, type Live } from '../motion'
import { createRenderer } from '../render'
import type { Edge, Scene } from '../scene'

export type Side = 'a' | 'b'
type Props = {
  pair: Record<Side, Scene>
  side: Side
  fader: number
  edge: Edge
  bpm: number
  running: boolean
  lives: Record<Side, Live>
  onLive: (scene: Scene) => void
}

export function Picture(props: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const { pair, bpm, lives } = props
  // each side as it plays, snapped to its loop
  const snapped = useMemo(() => ({ a: snapLoop(pair.a, bpm), b: snapLoop(pair.b, bpm) }), [pair, bpm])
  const latest = useRef({ ...props, snapped })
  useEffect(() => {
    latest.current = { ...props, snapped }
  })
  useEffect(() => {
    const el = canvas.current!
    const renderer = createRenderer(el)
    const fit = new ResizeObserver(() => {
      const scale = Math.min(window.devicePixelRatio, 1.5)
      el.width = Math.round(el.clientWidth * scale)
      el.height = Math.round(el.clientHeight * scale)
    })
    fit.observe(el)
    let frame = 0
    let last = performance.now()
    let raf = requestAnimationFrame(function tick(now) {
      const { snapped, side, fader, edge, bpm, running, onLive } = latest.current
      const dt = running ? Math.min(0.1, (now - last) / 1000) : 0
      last = now
      const a = advance(snapped.a, lives.a, dt, bpm)
      const b = advance(snapped.b, lives.b, dt, bpm)
      if (fader <= 0) renderer.draw(a, lives.a)
      else if (fader >= 1) renderer.draw(b, lives.b)
      else {
        const { scene, toward } = morph(a, b, fader, edge, lives.b)
        renderer.draw(scene, lives.a, toward)
      }
      if (frame++ % 4 === 0) onLive(side === 'a' ? a : b)
      raf = requestAnimationFrame(tick)
    })
    return () => {
      cancelAnimationFrame(raf)
      fit.disconnect()
    }
  }, [lives])
  return <canvas ref={canvas} className="picture" />
}
