// The picture: one canvas and the renderer, drawing every animation frame. It runs the app's one clock, and scenes A
// and B each play at its time; between the fader's ends it draws the morph. A transition runs the fader itself, on
// the clock, bent on its curve, and says when it lands. It hands the edited side's live scene up a few times a second
// so the knobs can show it. In Decks it draws A and B into their decks too, each at its deck's size in the canvas's
// corner and copied out, before the mix goes over the whole canvas: one shader, each side run once a frame. While
// music is heard the clock runs on its beat, a transition sets off on a beat and lands on one a whole number of beats
// on, and what is heard goes up with the live scene, paused or not. In Direct it draws the timeline's frame instead,
// at the export's aspect. Each draw is given the parts it needs, a side's alone and the pair's for the morph between
// them, and the renderer warms what may draw next between frames; while the readout is on, the frames a second and
// what the picture drew on go up a few times a second. While the UI is undocked, each frame is copied to the controls
// window's monitor.
import { useEffect, useMemo, useRef } from 'react'
import type { Shot } from '../direct'
import { snapLoop } from '../loop'
import { morph, smooth } from '../morph'
import { advance, keepTime, newTime, type Live } from '../motion'
import { heardAt, type Heard, type Listening } from '../music'
import { bend, onBeat, type Bend } from '../play'
import { createRenderer, EVERYTHING, type Drew } from '../render'
import type { Edge, Scene } from '../scene'
import { needs, type Part } from '../shader'
import type { Frames } from './FrameTime'

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
  ahead?: Set<Part>[] // the parts sets the app may draw next, in order, for the warm-up after the pair's
  onFrames?: (frames: Frames) => void // the readout's numbers, while it is on
  monitor?: HTMLCanvasElement | null // the controls window's copy of the frame, while the UI is undocked
}

const density = () => Math.min(window.devicePixelRatio, 1.5)

export function Picture(props: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const { pair, bpm, lives } = props
  // each side as it plays, snapped to its loop
  const snapped = useMemo(() => ({ a: snapLoop(pair.a, bpm), b: snapLoop(pair.b, bpm) }), [pair, bpm])
  // the parts each side draws with alone, and the morph between them: the same at every preset, dice and frame
  const parts = useMemo(() => ({ a: needs(pair.a), b: needs(pair.b), ab: needs(pair.a, pair.b) }), [pair])
  // what to warm, in order: the showing side's, the everything programs, the other side's, the morph's, then ahead
  const showing: Side = props.fader > 0.5 ? 'b' : 'a'
  const { ahead } = props
  const warming = useMemo(
    () => [parts[showing], ...EVERYTHING, parts[showing === 'a' ? 'b' : 'a'], parts.ab, ...(ahead ?? [])],
    [parts, showing, ahead],
  )
  const latest = useRef({ ...props, snapped, parts, warming })
  useEffect(() => {
    latest.current = { ...props, snapped, parts, warming }
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
    // the warm-up list last given; the frames' times over about the last second, and when the readout was last told
    let warmed: Iterable<Part>[] | undefined
    const times: number[] = []
    let told = 0
    // after the frame's draws: a slice of the warm-up, and the readout's numbers a few times a second while it is on
    const drawn = (now: number, drew: Drew) => {
      renderer.step()
      const { onFrames } = latest.current
      if (!onFrames) {
        times.length = 0
        return
      }
      times.push(now)
      // the frames since the last one a second or more ago, so a frame slower than a second still counts
      while (times.length > 2 && now - times[1] >= 1000) times.shift()
      if (times.length < 2 || now - told < 250) return
      told = now
      onFrames({ fps: times.length > 1 ? ((times.length - 1) * 1000) / (now - times[0]) : 0, drew })
    }
    let raf = requestAnimationFrame(function tick(now) {
      const {
        snapped,
        parts,
        warming,
        side,
        fader,
        edge,
        bpm,
        running,
        transition,
        decks,
        music,
        onLive,
        onLand,
        shot,
      } = latest.current
      if (warming !== warmed) {
        warmed = warming
        // where the browser cannot compile in parallel, a program compiles on first use alone
        if (renderer.parallel) renderer.warm(warming)
      }
      const dt = running ? Math.min(0.1, (now - last) / 1000) : 0
      last = now
      const direct = shot?.()
      if (direct) {
        drawn(now, renderer.draw(direct.scene, direct.phases, direct.toward, undefined, direct.parts))
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
          renderer.draw(scene, lives[s], undefined, [dw, dh], parts[s])
          deck.getContext('2d')!.drawImage(el, 0, el.height - dh, dw, dh, 0, 0, w, h)
        }
      let drew: Drew
      if (x <= 0) drew = renderer.draw(a, lives.a, undefined, undefined, parts.a)
      else if (x >= 1) drew = renderer.draw(b, lives.b, undefined, undefined, parts.b)
      else {
        const { scene, toward } = morph(a, b, x, edge, lives.b)
        if (run) bend(scene, run.bend, through)
        drew = renderer.draw(scene, lives.a, toward, undefined, parts.ab)
      }
      drawn(now, drew)
      if (run && through >= 1 && !landed) {
        landed = true
        onLand()
      }
      const mon = latest.current.monitor
      if (mon?.clientWidth) {
        if (mon.width !== mon.clientWidth || mon.height !== mon.clientHeight)
          [mon.width, mon.height] = [mon.clientWidth, mon.clientHeight]
        mon.getContext('2d')!.drawImage(el, 0, 0, mon.width, mon.height)
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
