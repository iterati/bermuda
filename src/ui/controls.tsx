// The controls of each chip of the chain: frame, a level, contour, line, palette, post.
// Stage shows the picked chip's; Edit shows every chip's at once.
import { createContext, useContext, type ReactNode } from 'react'
import { COSINES, css, gradient, stopsFromCosine } from '../colour'
import { addSubChain, duplicateLevel, findLevel, moveLevel, newId, prune, removeLevel, unlink } from '../edit'
import {
  hardRange,
  LINES,
  MAX_STOPS,
  MAX_VARIANTS,
  MIXES,
  resolve,
  STAR_N,
  VARIATIONS,
  type Address,
  type Level,
  type Scene,
} from '../scene'
import { Knob } from './Knob'

export type Ctl = {
  scene: Scene
  live: Scene
  focus: Address | null
  setFocus: (address: Address) => void
  edit: (fn: (draft: Scene) => void) => void
  setKnob: (address: Address, value: number) => void
  pick: (chip: string) => void
}
export const CtlContext = createContext<Ctl | null>(null)
export const useCtl = () => useContext(CtlContext)!

// A knob of the scene by its address.
export function K({ label, at }: { label: string; at: Address }) {
  const { scene, live, focus, setFocus, edit, setKnob } = useCtl()
  const knob = resolve(scene, at)!
  // the live scene lags the scene by a frame after a structural edit
  return (
    <Knob
      label={label}
      address={at}
      knob={knob}
      live={resolve(live, at)?.value}
      modulated={scene.modulators.some((m) => m.targets.some((t) => t.knob === at))}
      focused={focus === at}
      onFocus={() => setFocus(at)}
      onChange={(v) => setKnob(at, v)}
      onModulate={(id) =>
        edit((d) => {
          // a drop carries the id of a modulator of this scene, or of one a look switch took away
          const m = d.modulators.find((x) => x.id === id)
          const [lo, hi] = hardRange(at)
          if (m && !m.targets.some((t) => t.knob === at)) m.targets.push({ knob: at, depth: (hi - lo) / 10 })
        })
      }
    />
  )
}

export function Choice<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly T[]
  onChange: (v: T) => void
}) {
  return (
    <label className="choice">
      <span>{label}</span>
      <select
        value={String(value)}
        onChange={(e) => onChange(options.find((o) => String(o) === e.target.value)!)}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {options.map((o) => (
          <option key={String(o)} value={String(o)}>
            {String(o)}
          </option>
        ))}
      </select>
    </label>
  )
}

const Group = ({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) => (
  <div className="group">
    <div className="group-title">
      <span>{title}</span>
      {actions}
    </div>
    <div className="group-body">{children}</div>
  </div>
)

export const CHIPS = ['frame', 'contour', 'line', 'palette', 'post'] as const

export function Section({ chip }: { chip: string }) {
  switch (chip) {
    case 'frame':
      return (
        <Group title="Frame">
          <K label="origin x" at="frame.origin[0]" />
          <K label="origin y" at="frame.origin[1]" />
          <K label="zoom" at="frame.zoom" />
          <K label="turn" at="frame.turn" />
        </Group>
      )
    case 'contour':
      return (
        <Group title="Contour">
          <K label="rings" at="contour.rings" />
          <K label="drift" at="contour.drift" />
          <K label="radial wt" at="contour.radialWeight" />
        </Group>
      )
    case 'line':
      return <LineSection />
    case 'palette':
      return <PaletteSection />
    case 'post':
      return <PostSection />
    default:
      return <LevelSection id={chip} />
  }
}

function LineSection() {
  const { scene, edit } = useCtl()
  return (
    <Group title="Line">
      <Choice label="kind" value={scene.line.kind} options={LINES} onChange={(v) => edit((d) => (d.line.kind = v))} />
      <Choice
        label="units"
        value={scene.line.units}
        options={['cell', 'screen'] as const}
        onChange={(v) => edit((d) => (d.line.units = v))}
      />
      <K label="width" at="line.width" />
      <K label="falloff" at="line.falloff" />
    </Group>
  )
}

function PostSection() {
  const { scene, edit } = useCtl()
  return (
    <Group title="Composite and post">
      <Choice
        label="composite"
        value={scene.composite}
        options={['add', 'first'] as const}
        onChange={(v) => edit((d) => (d.composite = v))}
      />
      <Choice
        label="AA"
        value={scene.post.aa}
        options={[1, 2, 3] as const}
        onChange={(v) => edit((d) => (d.post.aa = v))}
      />
      <K label="gamma" at="post.gamma" />
    </Group>
  )
}

function PaletteSection() {
  const { scene, live, edit } = useCtl()
  const { stops } = scene.palette
  return (
    <Group
      title="Palette"
      actions={
        <select
          className="mini"
          value=""
          onKeyDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            const name = e.target.value
            edit((d) => (d.palette.stops = stopsFromCosine(name, d.palette.stops.length)))
          }}
        >
          <option value="">fill from cosine…</option>
          {Object.keys(COSINES).map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      }
    >
      <div className="palette-bar" style={{ background: gradient(live.palette) }} />
      <K label="hue" at="palette.hue" />
      <K label="contrast" at="palette.contrast" />
      <K label="radius" at="palette.radius" />
      <K label="time" at="palette.time" />
      <div className="stops">
        {stops.map((s, i) => (
          <div className="stop" key={i}>
            <div
              className="swatch"
              style={{ background: css([s.lch[0].value, s.lch[1].value, s.lch[2].value]) }}
              title={`stop at ${s.at.toFixed(2)}`}
            />
            <K label="L" at={`palette.stops[${i}].lch[0]`} />
            <K label="C" at={`palette.stops[${i}].lch[1]`} />
            <K label="h" at={`palette.stops[${i}].lch[2]`} />
            <Choice
              label="to next"
              value={s.mix}
              options={MIXES}
              onChange={(v) => edit((d) => (d.palette.stops[i].mix = v))}
            />
            <button
              className="mini"
              disabled={stops.length <= 2}
              onClick={() =>
                edit((d) => {
                  d.palette.stops.splice(i, 1)
                  d.palette.stops.forEach((st, j) => (st.at = j / d.palette.stops.length))
                  prune(d)
                })
              }
            >
              ×
            </button>
          </div>
        ))}
        <button
          className="mini"
          disabled={stops.length >= MAX_STOPS}
          onClick={() =>
            edit((d) => {
              d.palette.stops.push(structuredClone(d.palette.stops[d.palette.stops.length - 1]))
              d.palette.stops.forEach((st, j) => (st.at = j / d.palette.stops.length))
            })
          }
        >
          + stop
        </button>
      </div>
    </Group>
  )
}

// The address prefix of a level, through the variants and sub-chains above it.
export function prefixOf(levels: Level[], id: string, base = 'levels'): Address | undefined {
  for (const level of levels) {
    const here = `${base}[${level.id}]`
    if (level.id === id) return here
    for (const [v, variant] of level.variants.entries()) {
      const found = variant.below && prefixOf(variant.below, id, `${here}.variants[${v}].below`)
      if (found) return found
    }
  }
  return undefined
}

function LevelSection({ id }: { id: string }) {
  const { scene, edit, pick } = useCtl()
  const { level, list } = findLevel(scene, id)
  const at = prefixOf(scene.levels, id)!
  const index = list.indexOf(level)
  const leaders = list.slice(0, index).filter((l) => !l.link)
  const actions = (
    <span className="actions">
      <select
        className="mini"
        value={level.link ?? ''}
        title="link: share an earlier level's knobs, with its spreads across the group"
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          const to = e.target.value
          edit((d) => {
            if (to) findLevel(d, id).level.link = to
            else unlink(d, id)
          })
        }}
      >
        <option value="">no link</option>
        {leaders.map((l) => (
          <option key={l.id} value={l.id}>
            link {l.id}
          </option>
        ))}
      </select>
      <button className="mini" title="move up" onClick={() => edit((d) => moveLevel(d, id, -1))}>
        ↑
      </button>
      <button className="mini" title="move down" onClick={() => edit((d) => moveLevel(d, id, 1))}>
        ↓
      </button>
      <button
        className="mini"
        title="duplicate"
        onClick={() => {
          const copy = newId(scene, id)
          edit((d) => duplicateLevel(d, id, copy))
          pick(copy)
        }}
      >
        ⧉
      </button>
      <button
        className="mini"
        title="remove"
        disabled={list === scene.levels && list.length === 1}
        onClick={() => {
          pick(index > 0 ? list[index - 1].id : 'frame')
          edit((d) => removeLevel(d, id))
        }}
      >
        ×
      </button>
    </span>
  )
  if (level.link)
    return (
      <Group title={`Level ${id}`} actions={actions}>
        <p className="note">
          Linked to {level.link}: it shares {level.link}'s knobs, each with its spread across the group. Pick{' '}
          <button className="link" onClick={() => pick(level.link!)}>
            {level.link}
          </button>{' '}
          to play them, or unlink it to give it its own.
        </p>
      </Group>
    )
  return (
    <Group title={`Level ${id}`} actions={actions}>
      <div className="row">
        <K label="weight" at={`${at}.weight`} />
        <K label="scale" at={`${at}.affine.scale`} />
        <K label="turn" at={`${at}.affine.turn`} />
        <K label="offset x" at={`${at}.affine.offset[0]`} />
        <K label="offset y" at={`${at}.affine.offset[1]`} />
      </div>
      <div className="row">
        <span className="row-title">variations</span>
        {level.variations.map((v, i) => (
          <span className="pair" key={i}>
            <Choice
              label=""
              value={v.kind}
              options={VARIATIONS}
              onChange={(kind) => edit((d) => (findLevel(d, id).level.variations[i].kind = kind))}
            />
            <K label={v.kind} at={`${at}.variations[${i}].weight`} />
            {level.variations.length > 1 && (
              <button
                className="mini"
                onClick={() =>
                  edit((d) => {
                    findLevel(d, id).level.variations.splice(i, 1)
                    prune(d)
                  })
                }
              >
                ×
              </button>
            )}
          </span>
        ))}
        {level.variations.length < VARIATIONS.length && (
          <button
            className="mini"
            onClick={() =>
              edit((d) => {
                const l = findLevel(d, id).level
                const kind = VARIATIONS.find((k) => !l.variations.some((v) => v.kind === k))!
                l.variations.push({ kind, weight: { value: 0 } })
              })
            }
          >
            + variation
          </button>
        )}
      </div>
      <div className="row">
        <span className="row-title">lattice</span>
        <LatticePad at={at} />
        <K label="shear" at={`${at}.lattice.e2[0]`} />
        <K label="height" at={`${at}.lattice.e2[1]`} />
        <Choice
          label="cell"
          value={level.cell.by}
          options={['none', 'parity'] as const}
          onChange={(by) => edit((d) => (findLevel(d, id).level.cell.by = by))}
        />
        <K label="cell turn" at={`${at}.cell.turn`} />
        <K label="ring phase" at={`${at}.cell.phase`} />
      </div>
      {level.variants.map((v, i) => (
        <div className="row variant" key={i}>
          <span className="row-title">{level.variants.length > 1 ? `variant ${i + 1}` : 'shape'}</span>
          {level.variants.length > 1 && <K label="share" at={`${at}.variants[${i}].share`} />}
          <label className="choice">
            <span>points</span>
            <span className="stepper">
              <button
                className="mini"
                disabled={v.shape.n <= STAR_N[0]}
                onClick={() => edit((d) => findLevel(d, id).level.variants[i].shape.n--)}
              >
                −
              </button>
              <b>{v.shape.n}</b>
              <button
                className="mini"
                disabled={v.shape.n >= STAR_N[1]}
                onClick={() => edit((d) => findLevel(d, id).level.variants[i].shape.n++)}
              >
                +
              </button>
            </span>
          </label>
          <K label="m" at={`${at}.variants[${i}].shape.m`} />
          <K label="r" at={`${at}.variants[${i}].shape.r`} />
          <K label="round" at={`${at}.variants[${i}].shape.round`} />
          <K label="twist" at={`${at}.variants[${i}].shape.twist`} />
          {!v.below && (
            <button
              className="mini"
              title="give this variant's cells their own levels below"
              onClick={() => edit((d) => addSubChain(d, id, i))}
            >
              + sub-chain
            </button>
          )}
          {level.variants.length > 1 && (
            <button
              className="mini"
              onClick={() =>
                edit((d) => {
                  findLevel(d, id).level.variants.splice(i, 1)
                  prune(d)
                })
              }
            >
              ×
            </button>
          )}
        </div>
      ))}
      <div className="row">
        {level.variants.length < MAX_VARIANTS && (
          <button
            className="mini"
            onClick={() =>
              edit((d) => {
                const l = findLevel(d, id).level
                const v = structuredClone(l.variants[l.variants.length - 1])
                delete v.below
                l.variants.push(v)
              })
            }
          >
            + variant
          </button>
        )}
      </div>
      <div className="row">
        <span className="row-title">colour</span>
        <K label="at" at={`${at}.colour.at`} />
        <K label="speed" at={`${at}.colour.speed`} />
        <K label="cell spread" at={`${at}.colour.cellSpread`} />
      </div>
    </Group>
  )
}

// The lattice pad: e2 from square (0, 1) along the rhombic arc to hex (½, √3/2), or anywhere on the pad.
function LatticePad({ at }: { at: Address }) {
  const { scene, live, setKnob } = useCtl()
  const [sx, sy] = [`${at}.lattice.e2[0]`, `${at}.lattice.e2[1]`]
  const W = 56
  const H = 76
  const [x0, x1] = hardRange(sx)
  const [y0, y1] = hardRange(sy)
  const toPx = (x: number, y: number) => [((x - x0) / (x1 - x0)) * W, H - ((y - y0) / (y1 - y0)) * H]
  const set = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setKnob(sx, x0 + ((e.clientX - r.left) / W) * (x1 - x0))
    setKnob(sy, y0 + ((H - (e.clientY - r.top)) / H) * (y1 - y0))
  }
  const [bx, by] = toPx(resolve(scene, sx)!.value, resolve(scene, sy)!.value)
  // the live scene lags the scene by a frame after a structural edit
  const [lx, ly] = toPx(
    (resolve(live, sx) ?? resolve(scene, sx)!).value,
    (resolve(live, sy) ?? resolve(scene, sy)!).value,
  )
  const arcPath = Array.from({ length: 13 }, (_, i) => {
    const a = Math.PI / 2 - (i / 12) * (Math.PI / 6)
    const [px, py] = toPx(Math.cos(a), Math.sin(a))
    return `${i ? 'L' : 'M'}${px} ${py}`
  }).join(' ')
  const [qx, qy] = toPx(0, 1)
  const [hx, hy] = toPx(0.5, Math.sqrt(3) / 2)
  return (
    <svg
      className="pad"
      width={W}
      height={H}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        set(e)
      }}
      onPointerMove={(e) => e.buttons && set(e)}
    >
      <title>the lattice pad: shear across, height up; square at the left, hex at the right of the arc</title>
      <path className="arc" d={arcPath} />
      <circle className="mark" cx={qx} cy={qy} r="2.5" />
      <circle className="mark" cx={hx} cy={hy} r="2.5" />
      <text x={qx + 4} y={qy - 4}>
        sq
      </text>
      <text x={hx - 18} y={hy + 12}>
        hex
      </text>
      <circle className="base" cx={bx} cy={by} r="4" />
      <circle className="live" cx={lx} cy={ly} r="2.5" />
    </svg>
  )
}
