// The hand fader from scene A to scene B: which side the controls edit, the fader itself drawn as each depth's
// window of it, and the edge's stagger and direction. The Stage's is one slim row, its edge opened elsewhere.
import { useMemo } from 'react'
import { depthWindow, morphSize } from '../morph'
import type { Edge as EdgeShape, Scene } from '../scene'
import { Slider } from './Knob'
import { MapTag } from './Midi'
import type { Side } from './Picture'

type Props = {
  pair: Record<Side, Scene>
  side: Side
  fader: number
  edge: EdgeShape
  onSide: (side: Side) => void
  onFader: (at: number) => void
  onEdge: (edge: EdgeShape) => void
  onSwap: () => void
  onCopy: () => void
  pickup?: string // a MIDI fader waiting to pick the fader up, and where to move it
  openEdge?: () => void // the slim row: the edge is not drawn here, and edge ▸ opens it
}

const W = 1000
const ROW = 5

// The edge's stagger and direction.
export function Edge({ edge, onEdge }: { edge: EdgeShape; onEdge: (edge: EdgeShape) => void }) {
  return (
    <>
      <label className="slide" title="how far apart the depths morph: 0 all at once, 1 one after another">
        <span>stagger</span>
        <Slider min={0} max={1} step={0.01} value={edge.stagger} onChange={(stagger) => onEdge({ ...edge, stagger })} />
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
    </>
  )
}

export function Fader({ pair, side, fader, edge, onSide, onFader, onEdge, onSwap, onCopy, pickup, openEdge }: Props) {
  const { depth } = useMemo(() => morphSize(pair.a, pair.b), [pair])
  const height = Math.max(depth, 1) * ROW + 6
  const set = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    onFader(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)))
  }
  const other = side === 'a' ? 'B' : 'A'
  const at = <span className="dim fader-at">{Math.round(fader * 100)}%</span>
  const actions = (
    <>
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
    </>
  )
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
          data-learn={JSON.stringify({ fader: true })}
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
        <MapTag target={{ fader: true }} />
        <button className={`side${side === 'b' ? ' on' : ''}`} title="edit B (key B)" onClick={() => onSide('b')}>
          <kbd>B</kbd>
          <span>{pair.b.name}</span>
        </button>
        {openEdge && (
          <>
            {at}
            {actions}
            <button className="mini" title="the edge: stagger and deep first, in the context panel" onClick={openEdge}>
              edge ▸
            </button>
          </>
        )}
      </div>
      {openEdge ? (
        pickup && <span className="pickup">{pickup}</span>
      ) : (
        <div className="fader-row">
          {at}
          {pickup && <span className="pickup">{pickup}</span>}
          <Edge edge={edge} onEdge={onEdge} />
          <span className="actions">{actions}</span>
        </div>
      )}
    </div>
  )
}
