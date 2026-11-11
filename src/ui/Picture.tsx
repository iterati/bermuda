// The picture: one canvas and the renderer, drawing every animation frame; it hands the live scene up
// a few times a second so the knobs can show it.
import { useEffect, useRef } from 'react'
import { advance, type Live } from '../motion'
import { createRenderer } from '../render'
import type { Scene } from '../scene'

type Props = { scene: Scene; bpm: number; running: boolean; live: Live; onLive: (scene: Scene) => void }

export function Picture({ scene, bpm, running, live, onLive }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const props = useRef({ scene, bpm, running, onLive })
  useEffect(() => {
    props.current = { scene, bpm, running, onLive }
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
      const { scene, bpm, running, onLive } = props.current
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const shown = advance(scene, live, running ? dt : 0, bpm)
      renderer.draw(shown, live)
      if (frame++ % 4 === 0) onLive(shown)
      raf = requestAnimationFrame(tick)
    })
    return () => {
      cancelAnimationFrame(raf)
      fit.disconnect()
    }
  }, [live])
  return <canvas ref={canvas} className="picture" />
}
