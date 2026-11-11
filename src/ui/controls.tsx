// The controls of each chip of the chain: background, frame, a level, contour, line, palette, post.
// Stage shows the picked chip's; Edit shows every chip's at once.
import { createContext, useContext, type ReactNode } from 'react'
import { COSINES, css, paletteAt, stopsFromCosine } from '../colour'
import {
  addSubChain,
  alignedNesting,
  duplicateLevel,
  findLevel,
  moveLevel,
  newId,
  prune,
  removeLevel,
  setLattice,
  unlink,
} from '../edit'
import {
  BACKGROUNDS,
  CELLS,
  clamp,
  hardRange,
  LATTICES,
  LINES,
  MAX_STOPS,
  MAX_VARIANTS,
  MIXES,
  resolve,
  SECTORS,
  SHAPES,
  SPILLS,
  STAR_N,
  VARIATIONS,
  type Address,
  type LatticeKind,
  type Level,
  type Scene,
  type Shape,
  type ShapeKind,
} from '../scene'
import type { Learning } from '../midi'
import { Knob } from './Knob'

export type Ctl = {
  scene: Scene
  live: Scene
  focus: Address | null
  setFocus: (address: Address) => void
  edit: (fn: (draft: Scene) => void) => void
  setKnob: (address: Address, value: number) => void
  nudge: (address: Address, steps: number) => void // steps of 1% of its range, up for more
  pick: (chip: string) => void
  learning: Learning | null // what the next MIDI control or button maps to
  learn: (target: Learning | null) => void
  positions: ReadonlyMap<string, number> // each MIDI control's last position, 0 to 1, by midi.ts keyOf
}
export const CtlContext = createContext<Ctl | null>(null)
export const useCtl = () => useContext(CtlContext)!

// A number field: a change that is not a finite number at or above min is ignored.
export function Num({
  label,
  value,
  onChange,
  min,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
}) {
  return (
    <label className="num">
      <span>{label}</span>
      <input
        type="number"
        step="any"
        min={min}
        value={Number(value.toFixed(5))}
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          const v = e.target.valueAsNumber
          if (Number.isFinite(v) && (min === undefined || v >= min)) onChange(v)
        }}
      />
    </label>
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

// A whole number between the range's ends, one step at a time.
function Stepper({
  label,
  value,
  range: [lo, hi],
  onChange,
}: {
  label: string
  value: number
  range: [number, number]
  onChange: (v: number) => void
}) {
  return (
    <label className="choice">
      <span>{label}</span>
      <span className="stepper">
        <button className="mini" disabled={value <= lo} onClick={() => onChange(value - 1)}>
          −
        </button>
        <b>{value}</b>
        <button className="mini" disabled={value >= hi} onClick={() => onChange(value + 1)}>
          +
        </button>
      </span>
    </label>
  )
}

// A knob a scene may lack: the knob and a × that drops it, or a + that adds it.
function Extra({ label, at, has, set }: { label: string; at: Address; has: boolean; set: (on: boolean) => void }) {
  if (!has)
    return (
      <button className="mini" onClick={() => set(true)}>
        + {label}
      </button>
    )
  return (
    <span className="pair">
      <Knob label={label} at={at} />
      <button className="mini" title={`drop ${label}`} onClick={() => set(false)}>
        ×
      </button>
    </span>
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

export function Section({ chip }: { chip: string }) {
  switch (chip) {
    case 'background':
      return <BackgroundSection />
    case 'frame':
      return (
        <Group title="Frame">
          <Knob label="origin x" at="frame.origin[0]" />
          <Knob label="origin y" at="frame.origin[1]" />
          <Knob label="zoom" at="frame.zoom" />
          <Knob label="turn" at="frame.turn" />
        </Group>
      )
    case 'contour':
      return (
        <Group title="Contour">
          <Knob label="rings" at="contour.rings" />
          <Knob label="drift" at="contour.drift" />
          <Knob label="radial wt" at="contour.radialWeight" />
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

function BackgroundSection() {
  const { scene, edit } = useCtl()
  const kind = scene.background?.kind ?? 'none'
  return (
    <Group title="Background">
      <Choice
        label="kind"
        value={kind}
        options={['none', ...BACKGROUNDS] as const}
        onChange={(v) =>
          edit((d) => {
            if (v === 'none') {
              delete d.background
              prune(d)
              return
            }
            // a kind picked over another keeps its knobs
            d.background ??= {
              kind: v,
              at: [{ value: 0 }, { value: 0.5 }],
              amount: { value: 0.35 },
              turn: { value: 90 },
              scale: { value: 0.6 },
              edge: { value: 0.5 },
              seep: { value: 0 },
            }
            d.background.kind = v
          })
        }
      />
      {kind !== 'none' && (
        <>
          <Knob label="colour" at="background.at[0]" />
          {kind !== 'flat' && <Knob label="colour 2" at="background.at[1]" />}
          <Knob label="amount" at="background.amount" />
          {kind === 'gradient' && <Knob label="turn" at="background.turn" />}
          {kind === 'soak' && (
            <>
              <Knob label="pool size" at="background.scale" />
              <Knob label="edge" at="background.edge" />
              <Knob label="seep" at="background.seep" />
            </>
          )}
        </>
      )}
    </Group>
  )
}

function LineSection() {
  const { scene, edit } = useCtl()
  return (
    <Group title="Line">
      <Choice
        label="kind"
        value={scene.line.kind}
        options={LINES}
        onChange={(v) =>
          edit((d) => {
            d.line.kind = v
            // dots keep their knobs when the kind moves on, so a way back finds them as they were
            if (v === 'dots') d.line.dots ??= { count: { value: 16 }, size: { value: 0.3 }, crawl: { value: 1 } }
          })
        }
      />
      <Choice
        label="units"
        value={scene.line.units}
        options={['cell', 'screen'] as const}
        onChange={(v) => edit((d) => (d.line.units = v))}
      />
      <Knob label="width" at="line.width" />
      <Knob label="falloff" at="line.falloff" />
      {scene.line.kind === 'dots' && (
        <>
          <Knob label="dots" at="line.dots.count" />
          <Knob label="dot size" at="line.dots.size" />
          <Knob label="crawl" at="line.dots.crawl" />
        </>
      )}
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
      <Knob label="gamma" at="post.gamma" />
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
      <div
        className="palette-bar"
        style={{
          background: `linear-gradient(90deg, ${Array.from({ length: 33 }, (_, i) => css(paletteAt(live.palette, i / 32))).join(', ')})`,
        }}
      />
      <Knob label="hue" at="palette.hue" />
      <Knob label="contrast" at="palette.contrast" />
      <Knob label="radius" at="palette.radius" />
      <Knob label="time" at="palette.time" />
      {scene.palette.trap ? (
        <span className="pair">
          <Knob label="trap" at="palette.trap.weight" />
          <Knob label="trap size" at="palette.trap.size" />
          <button
            className="mini"
            title="drop the orbit trap"
            onClick={() =>
              edit((d) => {
                delete d.palette.trap
                prune(d)
              })
            }
          >
            ×
          </button>
        </span>
      ) : (
        <button
          className="mini"
          title="orbit-trap colour: the index moved by how near each point comes, down the chain, to a circle round its cell's middle"
          onClick={() => edit((d) => (d.palette.trap = { weight: { value: 0.5 }, size: { value: 0 } }))}
        >
          + orbit trap
        </button>
      )}
      <div className="stops">
        {stops.map((s, i) => (
          <div className="stop" key={i}>
            <div
              className="swatch"
              style={{ background: css([s.lch[0].value, s.lch[1].value, s.lch[2].value]) }}
              title={`stop at ${s.at.toFixed(2)}`}
            />
            <Knob label="L" at={`palette.stops[${i}].lch[0]`} />
            <Knob label="C" at={`palette.stops[${i}].lch[1]`} />
            <Knob label="h" at={`palette.stops[${i}].lch[2]`} />
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
  const { kind } = level.lattice
  const nesting = alignedNesting(scene, id)
  // a level others follow cannot follow one itself
  const leaders = list.some((l) => l.link === id) ? [] : list.slice(0, index).filter((l) => !l.link)
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
        <Knob label="weight" at={`${at}.weight`} />
        <Knob label="scale" at={`${at}.affine.scale`} />
        <Knob label="turn" at={`${at}.affine.turn`} />
        <Knob label="offset x" at={`${at}.affine.offset[0]`} />
        <Knob label="offset y" at={`${at}.affine.offset[1]`} />
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
            <Knob label={v.kind} at={`${at}.variations[${i}].weight`} />
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
        <Choice label="kind" value={kind} options={LATTICES} onChange={(to) => edit((d) => setLattice(d, id, to))} />
        <LatticePad at={at} kind={kind} />
        <Knob label={E2_LABELS[kind][0]} at={`${at}.lattice.e2[0]`} />
        <Knob label={E2_LABELS[kind][1]} at={`${at}.lattice.e2[1]`} />
        {kind === 'voronoi' && <Knob label="jitter" at={`${at}.lattice.jitter`} />}
        {level.lattice.sectors !== undefined && (
          <Stepper
            label="sectors"
            value={level.lattice.sectors}
            range={SECTORS}
            onChange={(n) => edit((d) => (findLevel(d, id).level.lattice.sectors = n))}
          />
        )}
        <button
          className="mini"
          disabled={!nesting}
          title="snap scale and turn to the nearest nesting that lines this level's cells up across the cells of the level above (under an oblique or unjittered voronoi level whose cells turn one way)"
          onClick={() =>
            edit((d) => {
              const { affine } = findLevel(d, id).level
              affine.scale.value = nesting!.scale
              affine.turn.value = nesting!.turn
            })
          }
        >
          snap
        </button>
      </div>
      <div className="row">
        <span className="row-title">cell</span>
        <Choice
          label="turn by"
          value={level.cell.by}
          options={CELLS}
          onChange={(by) => edit((d) => (findLevel(d, id).level.cell.by = by))}
        />
        <Knob label="cell turn" at={`${at}.cell.turn`} />
        <Knob label="ring phase" at={`${at}.cell.phase`} />
        {SPILLS.includes(kind) && (
          <Extra
            label="spill"
            at={`${at}.cell.spill`}
            has={!!level.cell.spill}
            set={(on) =>
              edit((d) => {
                const { cell } = findLevel(d, id).level
                if (on) cell.spill = { value: 1 }
                else delete cell.spill
                prune(d)
              })
            }
          />
        )}
      </div>
      {level.variants.map((v, i) => (
        <div className="row variant" key={i}>
          <span className="row-title">{level.variants.length > 1 ? `variant ${i + 1}` : 'shape'}</span>
          {level.variants.length > 1 && <Knob label="share" at={`${at}.variants[${i}].share`} />}
          <ShapeKnobs
            at={`${at}.variants[${i}].shape`}
            shape={v.shape}
            change={(fn) =>
              edit((d) => {
                fn(findLevel(d, id).level.variants[i].shape)
                prune(d)
              })
            }
          />
          <Extra
            label="onion"
            at={`${at}.variants[${i}].shape.onion`}
            has={!!v.shape.onion}
            set={(on) =>
              edit((d) => {
                const { shape } = findLevel(d, id).level.variants[i]
                if (on) shape.onion = { value: 0.03 }
                else delete shape.onion
                prune(d)
              })
            }
          />
          {!v.shape.join && (
            <button
              className="mini"
              title="smooth-union a second shape into this one"
              onClick={() =>
                edit((d) => {
                  const { shape } = findLevel(d, id).level.variants[i]
                  shape.join = {
                    shape: { n: 6, m: { value: 2 }, r: { value: 0.15 }, round: { value: 1 }, twist: { value: 0 } },
                    offset: [{ value: 0.25 }, { value: 0 }],
                    blend: { value: 0.1 },
                    weight: { value: 1 },
                  }
                })
              }
            >
              + join
            </button>
          )}
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
      {level.variants.map(
        ({ shape }, i) =>
          shape.join && (
            <div className="row variant" key={`join${i}`}>
              <span className="row-title">{level.variants.length > 1 ? `join ${i + 1}` : 'join'}</span>
              <ShapeKnobs
                at={`${at}.variants[${i}].shape.join.shape`}
                shape={shape.join.shape}
                change={(fn) =>
                  edit((d) => {
                    fn(findLevel(d, id).level.variants[i].shape.join!.shape)
                    prune(d)
                  })
                }
              />
              <Knob label="offset x" at={`${at}.variants[${i}].shape.join.offset[0]`} />
              <Knob label="offset y" at={`${at}.variants[${i}].shape.join.offset[1]`} />
              <Knob label="blend" at={`${at}.variants[${i}].shape.join.blend`} />
              <Knob label="weight" at={`${at}.variants[${i}].shape.join.weight`} />
              <button
                className="mini"
                title="drop the joined shape"
                onClick={() =>
                  edit((d) => {
                    delete findLevel(d, id).level.variants[i].shape.join
                    prune(d)
                  })
                }
              >
                ×
              </button>
            </div>
          ),
      )}
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
        <Knob label="at" at={`${at}.colour.at`} />
        <Knob label="speed" at={`${at}.colour.speed`} />
        <Knob label="cell spread" at={`${at}.colour.cellSpread`} />
      </div>
    </Group>
  )
}

// each kind's form, by what it sets (shader.ts SHAPE_GLSL); the heart and the cool S have none
const FORM: Partial<Record<ShapeKind, string>> = {
  box: 'aspect',
  rhombus: 'aspect',
  triangle: 'base',
  trapezoid: 'top',
  parallelogram: 'lean',
  capsule: 'top',
  pie: 'opening',
  arc: 'opening',
  horseshoe: 'opening',
  vesica: 'width',
  moon: 'bite',
  cross: 'thickness',
  roundX: 'thickness',
  blobbyCross: 'blob',
  ellipse: 'aspect',
  cutDisk: 'cut',
  circleWave: 'depth',
  segment: 'thickness',
  stairs: 'steepness',
}

// A shape's controls: its kind, the star's points and m (the stairs' steps), a kind's form, its size, round, twist
// and corner; change edits the shape on a draft, then prunes what pointed at a knob it dropped.
function ShapeKnobs({ at, shape, change }: { at: Address; shape: Shape; change: (fn: (s: Shape) => void) => void }) {
  const kind = shape.kind ?? 'star'
  const form = FORM[kind]
  return (
    <>
      <Choice
        label="shape"
        value={kind}
        options={SHAPES}
        onChange={(k) =>
          change((s) => {
            if (k === 'star') delete s.kind
            else s.kind = k
            if (FORM[k]) s.form ??= { value: 0.5 }
            else delete s.form
          })
        }
      />
      {(kind === 'star' || kind === 'stairs') && (
        <Stepper
          label={kind === 'star' ? 'points' : 'steps'}
          value={shape.n}
          range={STAR_N}
          onChange={(n) => change((s) => (s.n = n))}
        />
      )}
      {kind === 'star' && <Knob label="m" at={`${at}.m`} />}
      {form && <Knob label={form} at={`${at}.form`} />}
      <Knob label="r" at={`${at}.r`} />
      <Knob label="round" at={`${at}.round`} />
      <Knob label="twist" at={`${at}.twist`} />
      <Extra
        label="corner"
        at={`${at}.corner`}
        has={!!shape.corner}
        set={(on) =>
          change((s) => {
            if (on) s.corner = { value: 0.05 }
            else delete s.corner
          })
        }
      />
    </>
  )
}

// What each lattice kind reads e2 as (shader.ts).
const E2_LABELS: Record<LatticeKind, [string, string]> = {
  oblique: ['shear', 'height'],
  brick: ['row shift', 'row height'],
  triangle: ['shear', 'height'],
  polar: ['stagger', 'ring gap'],
  logpolar: ['spiral', 'height'],
  fold: ['shift x', 'shift y'],
  voronoi: ['shear', 'height'],
}
// the pad's named spots, each with where its label sits: the left edge is every rectangle, the arc every
// rhombus, the right edge stretched hexes
const SPOTS: { name: string; at: [number, number]; anchor: 'start' | 'middle' | 'end'; dx: number; dy: number }[] = [
  { name: 'sq', at: [0, 1], anchor: 'start', dx: 5, dy: 3 },
  { name: 'rect', at: [0, 1.5], anchor: 'start', dx: 5, dy: 3 },
  {
    name: 'rhomb',
    at: [Math.cos((75 * Math.PI) / 180), Math.sin((75 * Math.PI) / 180)],
    anchor: 'middle',
    dx: 0,
    dy: 12,
  },
  { name: 'hex', at: [0.5, Math.sqrt(3) / 2], anchor: 'end', dx: -5, dy: 3 },
  { name: 'str hex', at: [0.5, Math.sqrt(3) * 0.75], anchor: 'end', dx: -5, dy: 3 },
]

// The lattice pad: e2 anywhere on the pad, drawn to the named spots and the rhombic arc from square
// (0, 1) to hex (½, √3/2) when the pointer comes near them (shift for free); the kinds that do not read
// e2 as the pad's vector get the bare pad.
function LatticePad({ at, kind }: { at: Address; kind: LatticeKind }) {
  const { scene, live, setKnob } = useCtl()
  const [sx, sy] = [`${at}.lattice.e2[0]`, `${at}.lattice.e2[1]`]
  const W = 96
  const H = 108
  const M = 7 // a margin, so a point on the pad's edge shows whole
  const [x0, x1] = hardRange(sx)
  const [y0, y1] = hardRange(sy)
  const toPx = (x: number, y: number) => [
    M + ((x - x0) / (x1 - x0)) * (W - 2 * M),
    H - M - ((y - y0) / (y1 - y0)) * (H - 2 * M),
  ]
  const pad = kind === 'oblique' || kind === 'triangle' || kind === 'voronoi'
  const set = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const [px, py] = [e.clientX - r.left, e.clientY - r.top]
    let x = x0 + ((px - M) / (W - 2 * M)) * (x1 - x0)
    let y = y0 + ((H - M - py) / (H - 2 * M)) * (y1 - y0)
    const dist = (vx: number, vy: number) => {
      const [qx, qy] = toPx(vx, vy)
      return Math.hypot(qx - px, qy - py)
    }
    if (pad && !e.shiftKey) {
      const a = clamp(Math.atan2(y, x), [Math.PI / 3, Math.PI / 2])
      const spot = SPOTS.find(({ at }) => dist(...at) < 6)
      if (spot) [x, y] = spot.at
      else if (dist(Math.cos(a), Math.sin(a)) < 4) [x, y] = [Math.cos(a), Math.sin(a)]
    }
    setKnob(sx, x)
    setKnob(sy, y)
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
      <title>
        {pad
          ? 'the lattice pad: shear across, height up; rectangles up the left edge, rhombi along the arc from square to hex, stretched hexes up the right edge (shift: no snapping)'
          : 'e2 as this lattice reads it, across and up'}
      </title>
      {pad && (
        <>
          <path className="arc" d={arcPath} />
          {SPOTS.map(({ name, at: [vx, vy], anchor, dx, dy }) => {
            const [qx, qy] = toPx(vx, vy)
            return (
              <g key={name}>
                <circle className="mark" cx={qx} cy={qy} r="2.5" />
                <text x={qx + dx} y={qy + dy} textAnchor={anchor}>
                  {name}
                </text>
              </g>
            )
          })}
        </>
      )}
      <circle className="base" cx={bx} cy={by} r="4" />
      <circle className="live" cx={lx} cy={ly} r="2.5" />
    </svg>
  )
}
