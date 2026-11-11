// The hand fader from scene A to scene B: which side the controls edit, the fader itself drawn as each depth's
// window of it, the edge's stagger and direction, and the pair as one file.
import { useMemo } from 'react'
import { depthWindow, morphSize } from '../morph'
import { parseFader, type Edge, type Fader as Pair, type Scene } from '../scene'
import { download } from './Bank'
import type { Side } from './Picture'

type Props = {
  pair: Record<Side, Scene>
  side: Side
  fader: number
  edge: Edge
  onSide: (side: Side) => void
  onFader: (at: number) => void
  onEdge: (edge: Edge) => void
  onSwap: () => void
  onCopy: () => void
  onPair: (pair: Pair) => void
  onError: (message: string) => void
  pickup?: string // a MIDI fader waiting to pick the fader up, and where to move it
}

const W = 1000
const ROW = 5

export function Fader({
  pair,
  side,
  fader,
  edge,
  onSide,
  onFader,
  onEdge,
  onSwap,
  onCopy,
  onPair,
  onError,
  pickup,
}: Props) {
  const { depth } = useMemo(() => morphSize(pair.a, pair.b), [pair])
  const height = Math.max(depth, 1) * ROW + 6
  const set = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    onFader(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)))
  }
  const other = side === 'a' ? 'B' : 'A'
  return (
    <div className="fader-panel">
      <div className="fader-row">
        <button className={`side${side === 'a' ? ' on' : ''}`} title="edit A (key A)" onClick={() => onSide('a')}>
          <kbd>A</kbd>
          <span>{pair.a.name}</span>
        </button>
        <svg
          className="fader"
          viewBox={`0 0 ${W} ${height}`}
          preserveAspectRatio="none"
          height={height}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            set(e)
          }}
          onPointerMove={(e) => e.buttons && set(e)}
        >
          <title>
            the fader from A to B (keys , and .): each bar is a depth of the chain and the part of the fader it morphs
            over
          </title>
          {Array.from({ length: depth }, (_, k) => {
            const [from, to] = depthWindow(k, depth, edge)
            const y = 3 + k * ROW
            return (
              <g key={k}>
                <rect className="span" x={from * W} y={y} width={(to - from) * W} height={ROW - 2} />
                <rect
                  className="done"
                  x={from * W}
                  y={y}
                  width={Math.min(Math.max(fader - from, 0), to - from) * W}
                  height={ROW - 2}
                />
              </g>
            )
          })}
          <line className="handle" x1={fader * W} x2={fader * W} y1={0} y2={height} />
        </svg>
        <button className={`side${side === 'b' ? ' on' : ''}`} title="edit B (key B)" onClick={() => onSide('b')}>
          <kbd>B</kbd>
          <span>{pair.b.name}</span>
        </button>
      </div>
      <div className="fader-row">
        <span className="dim fader-at">{Math.round(fader * 100)}%</span>
        {pickup && <span className="pickup">{pickup}</span>}
        <label className="slide" title="how far apart the depths morph: 0 all at once, 1 one after another">
          <span>stagger</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={edge.stagger}
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => onEdge({ ...edge, stagger: e.target.valueAsNumber })}
          />
          <b>{edge.stagger.toFixed(2)}</b>
        </label>
        <label className="check" title="morph the deepest levels first">
          <input
            type="checkbox"
            checked={edge.deepFirst}
            onChange={(e) => onEdge({ ...edge, deepFirst: e.target.checked })}
          />
          deep first
        </label>
        <span className="actions">
          <button
            className="mini"
            title="swap A and B, flipping the fader and the direction so the picture stays (key X)"
            onClick={onSwap}
          >
            ⇄ swap
          </button>
          <button className="mini" title={`put a copy of the edited scene on ${other}`} onClick={onCopy}>
            copy to {other}
          </button>
          <button
            className="mini"
            title="download A, B, the fader and the edge as one JSON file"
            onClick={() =>
              download(`${pair.a.name} to ${pair.b.name}`, { a: pair.a, b: pair.b, at: fader, edge } satisfies Pair)
            }
          >
            export pair
          </button>
          <label className="mini file">
            import pair
            <input
              type="file"
              accept=".json,application/json"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                try {
                  onPair(parseFader(await file.text()))
                } catch (err) {
                  onError(`${file.name}: ${(err as Error).message}`)
                }
              }}
            />
          </label>
        </span>
      </div>
    </div>
  )
}
