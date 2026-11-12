// Direct: a timeline over a song picked from disk. Its ordered keys, each a scene and the edge into it, and drawn
// curves for any knob lie along the song, which plays, scrubs and loops a span while the picture draws the
// timeline's frame at the song's time, framed as the export will be. The export renders the timeline (or the looped
// span) frame by frame and saves the video with the song muxed in; the timeline saves in the browser and as a file.
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { decodeSong, director, exportVideo, FORMATS, missingKeys, type Clock, type Format, type Shot } from '../direct'
import type { Listening } from '../music'
import { entryScene } from '../play'
import { clamp, hardRange, knobsOf, parseTimeline, type Edge, type Scene, type Timeline } from '../scene'
import { download } from './Looks'

// what the export renders: its size, frame rate and container
export type Video = { width: number; height: number; fps: number; format: Format }
const SIZES: [string, number, number][] = [
  ['720p', 1280, 720],
  ['1080p', 1920, 1080],
  ['1440p', 2560, 1440],
  ['4K', 3840, 2160],
  ['square', 1080, 1080],
  ['vertical', 1080, 1920],
]
const RATES = [24, 25, 30, 50, 60]
const EDGE: Edge = { seconds: 2, stagger: 0.4, deepFirst: false }
const W = 1000 // the tracks' drawing width
const PEAKS = 4000 // the song's loudness at this many points, for its waveform

type Stroke = { knob: string; erase: boolean; points: [number, number][] }
type Song = { name: string; duration: number; buffer: AudioBuffer; peaks: Float32Array }
type Props = {
  timeline: Timeline | null
  looks: Scene[]
  entries: string[] // every look and preset a key can name
  current: string // the entry on the edited side, a new key's scene
  bpm: number // a new timeline's tempo
  active: boolean
  video: Video
  shot: RefObject<(() => Shot) | null> // the picture's frame while Direct is on
  music: Listening | null // the app's one song (or the microphone), which the timeline runs over and the music hears
  onSong: (file: File) => void
  onVideo: (video: Video) => void
  onTimeline: (timeline: Timeline) => void
  onError: (message: string) => void
}

// 75.5 -> '1:15.50'
const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`

export function Direct(props: Props) {
  const { timeline, looks, entries, current, active, video, shot, music, onSong, onTimeline, onError } = props
  // the song as the tracks and the export take it: decoded whole, and its loudness for the waveform
  const [song, setSong] = useState<Song | null>(null)
  const audio = useRef<HTMLAudioElement>(undefined)
  const [playing, setPlaying] = useState(false)
  // the song's time while it is still, and the same as state for what shows it
  const at = useRef(0)
  const [held, setHeld] = useState(0)
  const hold = (t: number) => {
    at.current = t
    setHeld(t)
  }
  const [loop, setLoop] = useState<[number, number] | null>(null)
  const [looping, setLooping] = useState(false)
  const marking = useRef(false) // a shift-drag on the waveform setting the loop
  const [picked, setPicked] = useState(0)
  const [lanes, setLanes] = useState<string[]>([]) // knobs opened for a curve not drawn yet
  // the curve being drawn: built in a ref as the pointer moves, shown from its state
  const drawing = useRef<Stroke | null>(null)
  const [stroke, setStroke] = useState<Stroke | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number; abort: AbortController } | null>(null)
  const keys = timeline?.keys ?? []
  const curves = timeline?.curves ?? []
  // the time the tracks run over: the song, or past the last key and curve while there is no song
  const end = Math.max(0, ...keys.map((k) => k.at), ...curves.map((c) => c.points[c.points.length - 1][0]))
  const length = song ? Math.max(song.duration, end) : end + 10
  // the span the tracks show: all of it until the wheel zooms in
  const [view, setView] = useState<[number, number] | null>(null)
  const [v0, v1] = view && view[1] <= length ? view : [0, length]
  const x = (t: number) => ((t - v0) / (v1 - v0)) * W
  const pct = (t: number) => `${((t - v0) / (v1 - v0)) * 100}%`
  // the app keeps the timeline's keys to the looks; each build keeps the clocks an edit left as they were
  const [clocks] = useState(() => new Map<string, Clock>())
  const draw = useMemo(() => timeline && director(timeline, looks, clocks), [timeline, looks, clocks])
  const time = () => (audio.current && !audio.current.paused ? audio.current.currentTime : at.current)

  // the picture draws the frame at the song's time
  useEffect(() => {
    shot.current = draw && (() => draw(time()))
  })
  const playhead = useRef<HTMLDivElement>(null)
  const readout = useRef<HTMLSpanElement>(null)

  // while Direct is on: the looped span plays round, and the playhead and the time follow the song
  useEffect(() => {
    if (!active) {
      audio.current?.pause()
      return
    }
    let raf = requestAnimationFrame(function tick() {
      const { loop, looping, v0, v1 } = now.current
      const a = audio.current
      if (a && !a.paused && looping && loop && (a.currentTime >= loop[1] || a.currentTime < loop[0] - 0.25))
        a.currentTime = loop[0]
      const t = time()
      if (playhead.current) playhead.current.style.left = `${((t - v0) / (v1 - v0)) * 100}%`
      if (readout.current) readout.current.textContent = clock(t)
      raf = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(raf)
  }, [active])

  const seek = (t: number) => {
    hold(clamp(t, [0, length]))
    if (audio.current) audio.current.currentTime = at.current
  }
  const play = () => {
    const a = audio.current
    if (!a || !song) return onError(`pick the song ${timeline ? `(${timeline.song}) ` : ''}to play`)
    if (!a.paused) return a.pause()
    a.currentTime = looping && loop && (at.current < loop[0] || at.current >= loop[1]) ? loop[0] : at.current
    void a.play()
  }
  // what the animation frames, the keys and the wheel read of the view as it is now
  const now = useRef({ play, seek, loop, looping, v0, v1 })
  useEffect(() => {
    now.current = { play, seek, loop, looping, v0, v1 }
  })
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      const { play, seek, loop, looping } = now.current
      if (e.key === ' ') {
        e.preventDefault()
        play()
      } else if (e.key === 'Home') seek(looping && loop ? loop[0] : 0)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  // the wheel zooms the tracks round the pointer, a sideways scroll pans them
  const tracks = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = tracks.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const { v0, v1 } = now.current
      const span = v1 - v0
      const t = v0 + clamp((e.clientX - r.left) / r.width, [0, 1]) * span
      const f = Math.exp(e.deltaY * 0.002)
      const next = clamp(span * f, [1, length])
      const shift = (e.deltaX / r.width) * span
      const from = clamp(t - (t - v0) * (next / span) + shift, [0, length - next])
      setView([from, from + next])
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [length])
  const timeAt = (e: { clientX: number }) => {
    const r = tracks.current!.getBoundingClientRect()
    return clamp(v0 + ((e.clientX - r.left) / r.width) * (v1 - v0), [0, length])
  }

  const change = (fn: (t: Timeline) => void) => {
    if (!timeline) return
    const next = structuredClone(timeline)
    fn(next)
    onTimeline(next)
  }
  // a key at t, after those at or before it: the scene being edited
  const addKey = (when: number) => {
    const t = Math.round(when * 100) / 100
    const i = keys.findIndex((k) => k.at > t)
    change((d) => d.keys.splice(i < 0 ? keys.length : i, 0, { at: t, scene: current, edge: { ...EDGE } }))
    setPicked(i < 0 ? keys.length : i)
  }
  // the song the app plays, picked here or in the Music block: its player, followed as it plays and pauses, and
  // its file decoded
  useEffect(() => {
    const a = music?.song
    const file = music?.file
    audio.current = a
    if (!a || !file) return setSong(null)
    let gone = false
    const onPlay = () => setPlaying(true)
    const onPause = () => {
      hold(a.currentTime)
      setPlaying(false)
    }
    a.addEventListener('play', onPlay)
    a.addEventListener('pause', onPause)
    setPlaying(!a.paused)
    file
      .arrayBuffer()
      .then(decodeSong)
      .then(
        (buffer) => {
          if (gone) return
          const data = buffer.getChannelData(0)
          const peaks = new Float32Array(PEAKS)
          const per = Math.ceil(data.length / PEAKS)
          for (let i = 0; i < data.length; i++)
            peaks[Math.floor(i / per)] = Math.max(peaks[Math.floor(i / per)], Math.abs(data[i]))
          setSong({ name: file.name, duration: buffer.duration, buffer, peaks })
          setView(null)
        },
        (err: Error) => onError(`${file.name}: ${err.message}`),
      )
    return () => {
      gone = true
      a.removeEventListener('play', onPlay)
      a.removeEventListener('pause', onPause)
    }
  }, [music, onError])
  const pickSong = (file: File) => {
    onSong(file)
    onTimeline(
      timeline
        ? { ...timeline, song: file.name }
        : { song: file.name, bpm: props.bpm, keys: [{ at: 0, scene: current, edge: { ...EDGE } }], curves: [] },
    )
  }
  const save = async () => {
    if (!song || !timeline || !draw) return
    const [from, to] = looping && loop ? loop : [0, song.duration]
    audio.current?.pause()
    const abort = new AbortController()
    setProgress({ done: 0, total: Math.round((to - from) * video.fps), abort })
    try {
      const { file } = await exportVideo({
        timeline,
        looks,
        song: song.buffer,
        from,
        to,
        ...video,
        signal: abort.signal,
        onFrame: (done, total) => setProgress((p) => p && { ...p, done, total }),
      })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(file)
      a.download = `${timeline.song.replace(/\.\w+$/, '').replace(/[^\w-]+/g, '-')}-bermuda.${video.format}`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (err) {
      if (!abort.signal.aborted) onError(`export: ${(err as Error).message}`)
    }
    setProgress(null)
  }

  const ki = Math.min(picked, keys.length - 1)
  const key = keys[ki] as Timeline['keys'][number] | undefined
  // the knobs a curve can take: those of the scene at the playhead's key
  const shown = keys.findLastIndex((k) => k.at <= held)
  const here = keys[Math.max(0, shown)]
  const sceneNow = here && entryScene(looks, here.scene)
  const open = [...curves.map((c) => c.knob), ...lanes.filter((l) => !curves.some((c) => c.knob === l))]
  const waveform = useMemo(() => {
    if (!song) return ''
    let d = ''
    for (let i = 0; i < W; i += 2) {
      const t = v0 + (i / W) * (v1 - v0)
      const h = 2 + 46 * song.peaks[Math.min(PEAKS - 1, Math.floor((t / song.duration) * PEAKS))]
      d += `M${i},${50 - h}V${50 + h}`
    }
    return d
  }, [song, v0, v1])
  const exportable = typeof VideoEncoder !== 'undefined'
  // the ruler's whole seconds, a dozen or fewer across the view
  const every = [1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => (v1 - v0) / s <= 12) ?? 600
  const ticks = Array.from(
    { length: Math.floor(v1 / every) - Math.ceil(v0 / every) + 1 },
    (_, i) => (Math.ceil(v0 / every) + i) * every,
  )

  return (
    <section className="panel direct-panel" style={active ? undefined : { display: 'none' }}>
      <div className="direct-row">
        <label className="mini file" title="the song the timeline runs over, from disk">
          {song ? 'song…' : 'pick song…'}
          <input
            type="file"
            accept="audio/*"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) pickSong(file)
            }}
          />
        </label>
        <span className="song-name" title={timeline?.song}>
          {song ? song.name : timeline ? <span className="warn">pick {timeline.song} to play</span> : 'no song yet'}
        </span>
        <button className="mini" disabled={!song} title="play or pause the song (space)" onClick={play}>
          {playing ? '❚❚' : '▶'}
        </button>
        <span className="time">
          <span ref={readout}>{clock(at.current)}</span>
          <span className="dim"> / {clock(song?.duration ?? length)}</span>
        </span>
        <label className="check" title="play round the span shift-dragged on the waveform, and export only it">
          <input
            type="checkbox"
            disabled={!loop}
            checked={looping && !!loop}
            onChange={(e) => setLooping(e.target.checked)}
          />
          loop {loop ? `${clock(loop[0])} – ${clock(loop[1])}` : '(shift-drag the waveform)'}
        </label>
        {timeline && (
          <label className="num" title="the song's tempo: the clock the scenes' periods count in">
            <span>bpm</span>
            <input
              type="number"
              min={10}
              max={300}
              value={timeline.bpm}
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                const v = e.target.valueAsNumber
                if (v >= 10 && v <= 300) change((d) => (d.bpm = v))
              }}
            />
          </label>
        )}
        <span className="actions">
          <button
            className="mini"
            disabled={!timeline}
            title="a key at the playhead: the scene being edited"
            onClick={() => addKey(time())}
          >
            + key
          </button>
          <select
            className="mini"
            value=""
            disabled={!sceneNow}
            title="a lane to draw a knob's curve in"
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => e.target.value && setLanes((l) => [...l, e.target.value])}
          >
            <option value="">+ curve…</option>
            {sceneNow &&
              knobsOf(sceneNow)
                .filter((k) => !open.includes(k.address))
                .map((k) => (
                  <option key={k.address} value={k.address}>
                    {k.address}
                  </option>
                ))}
          </select>
          <button
            className="mini"
            disabled={!timeline}
            title="download the timeline as a JSON file"
            onClick={() => timeline && download(`${timeline.song.replace(/\.\w+$/, '')} timeline`, timeline)}
          >
            export
          </button>
          <label className="mini file" title="load a timeline from a JSON file">
            import
            <input
              type="file"
              accept=".json,application/json"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                try {
                  const t = parseTimeline(await file.text())
                  const gone = missingKeys(t, looks)
                  if (gone.length) return onError(`${file.name}: no look here for ${gone.join(', ')}`)
                  onTimeline(t)
                  setPicked(0)
                  setView(null)
                } catch (err) {
                  onError(`${file.name}: ${(err as Error).message}`)
                }
              }}
            />
          </label>
        </span>
      </div>

      <div className="lanes">
        <div className="gutter">
          <div className="lane-name ruler-name">{song ? 'song' : ''}</div>
          <div className="lane-name keys-name">keys</div>
          {open.map((knob) => (
            <div key={knob} className="lane-name curve-name" title={knob}>
              <span>{knob}</span>
              <button
                className="mini"
                title="take the curve away"
                onClick={() => {
                  setLanes((l) => l.filter((x) => x !== knob))
                  change((d) => (d.curves = d.curves.filter((c) => c.knob !== knob)))
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="tracks" ref={tracks}>
          <svg
            className="ruler"
            viewBox={`0 0 ${W} 100`}
            preserveAspectRatio="none"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              const t = timeAt(e)
              marking.current = e.shiftKey
              if (e.shiftKey) setLoop([t, t])
              else seek(t)
            }}
            onPointerMove={(e) => {
              if (!e.buttons) return
              const t = timeAt(e)
              if (marking.current) setLoop((l) => l && [l[0], t])
              else seek(t)
            }}
            onPointerUp={() => {
              if (!marking.current) return
              marking.current = false
              setLoop((l) => {
                // inside the song, which plays no further
                const [a, b] = l ? [Math.min(...l), Math.min(Math.max(...l), song?.duration ?? length)] : [0, 0]
                return b - a < 0.2 ? null : [a, b]
              })
              setLooping(true)
            }}
          >
            <title>click or drag to scrub · shift-drag to set the loop · wheel to zoom</title>
            <path className="wave" d={waveform} />
            {ticks.map((t) => (
              <line key={t} className="tick" x1={x(t)} x2={x(t)} y1={0} y2={18} />
            ))}
          </svg>
          <div
            className="keys-track"
            onDoubleClick={(e) => {
              if (e.target === e.currentTarget) addKey(timeAt(e))
            }}
          >
            {keys.map((k, i) => {
              const start = i ? Math.max(keys[i - 1].at, k.at - k.edge.seconds) : k.at
              return (
                <div key={i}>
                  {start < k.at && (
                    <div className="edge" style={{ left: pct(start), width: `calc(${pct(k.at)} - ${pct(start)})` }} />
                  )}
                  <div
                    className={`key${i === ki ? ' picked' : ''}`}
                    style={{ left: pct(k.at) }}
                    title={`${k.scene} at ${clock(k.at)}: drag to move`}
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId)
                      setPicked(i)
                    }}
                    onPointerMove={(e) => {
                      if (!e.buttons) return
                      const lo = i ? keys[i - 1].at : 0
                      const hi = i + 1 < keys.length ? keys[i + 1].at : length
                      const t = clamp(timeAt(e), [lo, hi])
                      change((d) => (d.keys[i].at = Math.round(t * 100) / 100))
                    }}
                  >
                    <i />
                    {/* 'Tapestry 7 - Hexes / Ice' -> 'T7 Hexes / Ice' */}
                    <span>{k.scene.replace(/^Tapestry (\w+) - /, 'T$1 ').replace(/^(Remix|Lattice) - /, '')}</span>
                  </div>
                </div>
              )
            })}
          </div>
          {open.map((knob) => {
            const [lo, hi] = hardRange(knob)
            const y = (v: number) => 100 - ((v - lo) / (hi - lo)) * 100
            const line = (ps: [number, number][]) => ps.map(([t, v]) => `${x(t)},${y(v)}`).join(' ')
            const curve = curves.find((c) => c.knob === knob)
            const own = sceneNow && knobsOf(sceneNow).find((k) => k.address === knob)?.knob.value
            const point = (e: React.PointerEvent<SVGSVGElement>): [number, number] => {
              const r = e.currentTarget.getBoundingClientRect()
              return [timeAt(e), clamp(hi - ((e.clientY - r.top) / r.height) * (hi - lo), [lo, hi])]
            }
            return (
              <svg
                key={knob}
                className="curve"
                viewBox={`0 0 ${W} 100`}
                preserveAspectRatio="none"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId)
                  drawing.current = { knob, erase: e.altKey || e.shiftKey, points: [point(e)] }
                  setStroke(drawing.current)
                }}
                onPointerMove={(e) => {
                  const stroke = drawing.current
                  if (!e.buttons || stroke?.knob !== knob) return
                  stroke.points.push(point(e))
                  setStroke({ ...stroke })
                }}
                onPointerUp={() => {
                  const stroke = drawing.current
                  if (!stroke || stroke.knob !== knob) return
                  drawing.current = null
                  setStroke(null)
                  // the stroke takes the place of the curve's points over its span, or with alt or shift rubs them out
                  const drawn = [...stroke.points]
                    .sort((p, q) => p[0] - q[0])
                    .filter((p, i, all) => i === all.length - 1 || all[i + 1][0] - p[0] >= 0.02)
                  const [a, b] = [drawn[0][0], drawn[drawn.length - 1][0]]
                  const before = curve?.points ?? []
                  const points = [
                    ...before.filter(([t]) => t < a),
                    ...(stroke.erase ? [] : drawn),
                    ...before.filter(([t]) => t > b),
                  ]
                  change((d) => {
                    d.curves = d.curves.filter((c) => c.knob !== knob)
                    if (points.length >= 2) d.curves.push({ knob, points })
                  })
                }}
              >
                <title>{`${knob}: draw its value along the song · alt- or shift-drag rubs it out`}</title>
                {own !== undefined && <line className="own" x1={0} x2={W} y1={y(own)} y2={y(own)} />}
                {curve && <polyline points={line(curve.points)} />}
                {stroke?.knob === knob && (
                  <polyline className={stroke.erase ? 'rub' : 'drawing'} points={line(stroke.points)} />
                )}
              </svg>
            )
          })}
          <div className="overlay">
            {ticks.map((t) => (
              <span key={t} className="tick-label" style={{ left: pct(t) }}>
                {`${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`}
              </span>
            ))}
            {loop && (
              <div
                className={`loop${looping ? ' on' : ''}`}
                style={{
                  left: pct(Math.min(...loop)),
                  width: `calc(${pct(Math.max(...loop))} - ${pct(Math.min(...loop))})`,
                }}
              />
            )}
            <div className="playhead" ref={playhead} />
          </div>
        </div>
      </div>

      <div className="direct-row">
        {key ? (
          <>
            <span className="dim">key {ki + 1}</span>
            <label className="choice">
              <span>scene</span>
              <select
                value={key.scene}
                onKeyDown={(e) => e.stopPropagation()}
                onChange={(e) => change((d) => (d.keys[ki].scene = e.target.value))}
              >
                {entries.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="num">
              <span>at s</span>
              <input
                type="number"
                step={0.01}
                value={key.at}
                onKeyDown={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const v = e.target.valueAsNumber
                  const lo = ki ? keys[ki - 1].at : 0
                  const hi = ki + 1 < keys.length ? keys[ki + 1].at : length
                  if (v >= lo && v <= hi) change((d) => (d.keys[ki].at = v))
                }}
              />
            </label>
            <label className="num" title="seconds the edge into this key takes, landing on it">
              <span>edge s</span>
              <input
                type="number"
                min={0}
                max={600}
                step={0.1}
                value={key.edge.seconds}
                onKeyDown={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const v = e.target.valueAsNumber
                  if (v >= 0 && v <= 600) change((d) => (d.keys[ki].edge.seconds = v))
                }}
              />
            </label>
            <label className="slide" title="how far apart the depths morph: 0 all at once, 1 one after another">
              <span>stagger</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={key.edge.stagger}
                onKeyDown={(e) => e.stopPropagation()}
                onChange={(e) => change((d) => (d.keys[ki].edge.stagger = e.target.valueAsNumber))}
              />
              <b>{key.edge.stagger.toFixed(2)}</b>
            </label>
            <label className="check" title="the edge morphs the deepest levels first">
              <input
                type="checkbox"
                checked={key.edge.deepFirst}
                onChange={(e) => change((d) => (d.keys[ki].edge.deepFirst = e.target.checked))}
              />
              deep first
            </label>
            <button
              className="mini"
              disabled={keys.length < 2}
              title="take this key away (a timeline keeps one at least)"
              onClick={() => {
                change((d) => d.keys.splice(ki, 1))
                setPicked(0)
              }}
            >
              − key
            </button>
          </>
        ) : (
          <span className="dim">pick a song to start a timeline: its first key is the scene being edited</span>
        )}
        <span className="actions export">
          {progress ? (
            <>
              <progress max={progress.total} value={progress.done} />
              <span className="dim">
                {progress.done} / {progress.total}
              </span>
              <button className="mini" onClick={() => progress.abort.abort()}>
                cancel
              </button>
            </>
          ) : (
            <>
              <label className="choice">
                <span>size</span>
                <select
                  value={`${video.width}x${video.height}`}
                  onKeyDown={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    const [, width, height] = SIZES.find(([, w, h]) => `${w}x${h}` === e.target.value)!
                    props.onVideo({ ...video, width, height })
                  }}
                >
                  {SIZES.map(([name, w, h]) => (
                    <option key={name} value={`${w}x${h}`}>
                      {name} {w}×{h}
                    </option>
                  ))}
                </select>
              </label>
              <label className="choice">
                <span>fps</span>
                <select
                  value={video.fps}
                  onKeyDown={(e) => e.stopPropagation()}
                  onChange={(e) => props.onVideo({ ...video, fps: Number(e.target.value) })}
                >
                  {RATES.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
              <label className="choice">
                <span>file</span>
                <select
                  value={video.format}
                  onKeyDown={(e) => e.stopPropagation()}
                  onChange={(e) => props.onVideo({ ...video, format: e.target.value as Format })}
                >
                  {(Object.keys(FORMATS) as Format[]).map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
              <button
                className="mini go"
                disabled={!song || !draw || !exportable}
                title={
                  exportable
                    ? 'render the timeline, or the looped span, frame by frame into a video with the song'
                    : 'this browser has no WebCodecs to encode with'
                }
                onClick={save}
              >
                export video
              </button>
            </>
          )}
        </span>
      </div>
    </section>
  )
}
