// The picture: one canvas and the renderer, drawing every animation frame. Scenes A and B each run on their own
// clock; between the fader's ends it draws the morph. A transition runs the fader itself, on the clock, bent on its
// curve, and says when it lands. It hands the edited side's live scene up a few times a second so the knobs can
// show it.
import { useEffect, useMemo, useRef } from 'react'
import { snapLoop } from '../loop'
import { morph, smooth } from '../morph'
import { advance, type Live } from '../motion'
import { bend, type Bend } from '../play'
import { createRenderer } from '../render'
import type { Edge, Scene } from '../scene'

export type Side = 'a' | 'b'
// the fader run from where it was (from) to the end of the side it goes to, over seconds, on its curve
export type Transition = { to: Side; from: number; seconds: number; bend: Bend }
type Props = {
  pair: Record<Side, Scene>
  side: Side
  fader: number
  edge: Edge
  bpm: number
  running: boolean
  lives: Record<Side, Live>
  transition: Transition | null
  onLive: (scene: Scene) => void
  onLand: () => void
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
    // the transition running, how far through it is (0 to 1), and whether it has said it landed
    let run: Transition | null = null
    let through = 0
    let landed = false
    let raf = requestAnimationFrame(function tick(now) {
      const { snapped, side, fader, edge, bpm, running, transition, onLive, onLand } = latest.current
      const dt = running ? Math.min(0.1, (now - last) / 1000) : 0
      last = now
      if (transition !== run) [run, through, landed] = [transition, 0, false]
      if (run) through = run.seconds > 0 ? Math.min(1, through + dt / run.seconds) : 1
      const x = run ? run.from + ((run.to === 'b' ? 1 : 0) - run.from) * smooth(0, 1, through) : fader
      const a = advance(snapped.a, lives.a, dt, bpm)
      const b = advance(snapped.b, lives.b, dt, bpm)
      if (x <= 0) renderer.draw(a, lives.a)
      else if (x >= 1) renderer.draw(b, lives.b)
      else {
        const { scene, toward } = morph(a, b, x, edge, lives.b)
        if (run) bend(scene, run.bend, through)
        renderer.draw(scene, lives.a, toward)
      }
      if (run && through >= 1 && !landed) {
        landed = true
        onLand()
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
