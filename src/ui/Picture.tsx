// The picture: one canvas and the renderer, drawing every animation frame. It runs the app's one clock, and scenes A
// and B each play at its time; between the fader's ends it draws the morph. A transition runs the fader itself, on
// the clock, bent on its curve, and says when it lands. It hands the edited side's live scene up a few times a second
// so the knobs can show it. In Decks it draws A and B into their decks too, each at its deck's size in the canvas's
// corner and copied out, before the mix goes over the whole canvas: one shader, each side run once a frame. While
// music is heard the clock runs on its beat, a transition sets off on a beat and lands on one a whole number of beats
// on, and what is heard goes up with the live scene, paused or not. In Direct it draws the timeline's frame instead,
// at the export's aspect.
import { useEffect, useMemo, useRef } from 'react'
import type { Shot } from '../direct'
import { snapLoop } from '../loop'
import { morph, smooth } from '../morph'
import { advance, keepTime, newTime, type Live } from '../motion'
import { heardAt, type Heard, type Listening } from '../music'
import { bend, onBeat, type Bend } from '../play'
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
  decks?: Record<Side, HTMLCanvasElement | null>
  music: Listening | null
  onLive: (scene: Scene, heard?: Heard) => void
  onLand: () => void
  shot?: () => Shot | undefined // Direct's frame, when it has a timeline
  aspect?: number // width over height, else the picture fills the screen
}

const density = () => Math.min(window.devicePixelRatio, 1.5)

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
      el.width = Math.round(el.clientWidth * density())
      el.height = Math.round(el.clientHeight * density())
    })
    fit.observe(el)
    let frame = 0
    const time = newTime()
    let last = performance.now()
    // the transition running, how far through it is (0 to 1), and whether it has said it landed
    let run: Transition | null = null
    let through = 0
    let landed = false
    // the beat the transition running set off on, once music is heard; what the picture heard, held while paused
    let begin: number | undefined
    let held: Heard | undefined
    let paused = false
    let raf = requestAnimationFrame(function tick(now) {
      const { snapped, side, fader, edge, bpm, running, transition, decks, music, onLive, onLand, shot } =
        latest.current
      const dt = running ? Math.min(0.1, (now - last) / 1000) : 0
      last = now
      const direct = shot?.()
      if (direct) {
        renderer.draw(direct.scene, direct.phases, direct.toward)
        raf = requestAnimationFrame(tick)
        return
      }
      // what is heard at the audio clock's time of the sound now leaving the speakers
      const heardNow = music ? heardAt(music.ear, music.ctx.getOutputTimestamp().contextTime! - music.start) : undefined
      const heard = running ? heardNow : held
      // back from a pause the song has played on: the clock takes up from the beat as it is, and the transition
      // running from its beat as many whole beats on
      if (running && paused && heard && held?.locked) {
        if (begin !== undefined) begin += Math.round(heard.beat - held.beat)
        time.felt = undefined
      }
      paused = !running
      held = heard
      if (transition !== run) [run, through, landed, begin] = [transition, 0, false, undefined]
      if (run && heard?.locked && run.seconds > 0) {
        // on the beat, never back from where it was before the music came
        const at = onBeat(heard, run.seconds, begin)
        begin = at.begin
        through = Math.max(through, at.through)
      } else if (run) through = run.seconds > 0 ? Math.min(1, through + dt / run.seconds) : 1
      const x = run ? run.from + ((run.to === 'b' ? 1 : 0) - run.from) * smooth(0, 1, through) : fader
      keepTime(time, dt, bpm, heard)
      const a = advance(snapped.a, lives.a, time.beats, dt, heard)
      const b = advance(snapped.b, lives.b, time.beats, dt, heard)
      if (decks)
        for (const [s, scene] of [
          ['a', a],
          ['b', b],
        ] as const) {
          const deck = decks[s]
          if (!deck?.clientWidth) continue
          const [w, h] = [Math.round(deck.clientWidth * density()), Math.round(deck.clientHeight * density())]
          if (deck.width !== w || deck.height !== h) [deck.width, deck.height] = [w, h]
          // a deck larger than the canvas draws smaller and is stretched up to fill
          const k = Math.min(1, el.width / w, el.height / h)
          const [dw, dh] = [Math.round(w * k), Math.round(h * k)]
          renderer.draw(scene, lives[s], undefined, [dw, dh])
          deck.getContext('2d')!.drawImage(el, 0, el.height - dh, dw, dh, 0, 0, w, h)
        }
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
      if (frame++ % 4 === 0) onLive(side === 'a' ? a : b, heardNow)
      raf = requestAnimationFrame(tick)
    })
    return () => {
      cancelAnimationFrame(raf)
      fit.disconnect()
    }
  }, [lives])
  return (
    <canvas
      ref={canvas}
      className={`picture${props.aspect ? ' framed' : ''}`}
      style={props.aspect ? ({ '--aspect': props.aspect } as React.CSSProperties) : undefined}
    />
  )
}
