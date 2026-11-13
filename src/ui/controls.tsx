// The controls of each chip of the chain: background, frame, a level, contour, line, palette, post.
// Stage shows the picked chip's; Edit shows every chip's at once.
import { createContext, useContext, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
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
import { dice } from '../motion'
import {
  BACKGROUNDS,
  canMove,
  CELLS,
  chipKnobs,
  clamp,
  FIELD_STEPS,
  fielded,
  FIELDS,
  folded,
  GRIDS,
  hardRange,
  LATTICES,
  knobsOf,
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
  type MidiTarget,
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
  // steps of a notch (scene.ts notch), up for more: the wheel's, and ↑ ↓'s one, ten with shift; the knob turned
  nudge: (t: MidiTarget, steps: number) => void
  set: (t: MidiTarget, value: number) => void // a value typed, clamped to the hard range (a macro's 0 to 1); turned
  liveKnobs: ReadonlySet<Address> // the knobs live to the hand (scene.ts liveKnob), the stops of Tab's walk
  typing: MidiTarget | null // the knob or macro whose value is being typed
  type: Dispatch<SetStateAction<MidiTarget | null>>
  walk: (by: 1 | -1) => void // Tab's walk on to the next live knob on screen, or back to the one before
  pick: (chip: string) => void
  learning: Learning | null // what the next MIDI control or button maps to
  learn: (target: Learning | null) => void
  positions: ReadonlyMap<string, number> // each MIDI control's last position, 0 to 1, by midi.ts keyOf
  locked: boolean // a look saved in this browser, which the dice leave alone
  armed: Armed | null // the macro learning by example, and the scene as it was armed
  arm: (armed: Armed | null) => void
}
export type Armed = { id: string; before: Scene }
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

// A roll of the knobs at these addresses, each to anywhere inside its play range; a look saved in this browser is
// locked against it.
export function Dice({ at, what }: { at: Address[]; what: string }) {
  const { scene, edit, locked } = useCtl()
  const ranged = at.some((a) => resolve(scene, a)!.play)
  return (
    <button
      className="mini dice"
      disabled={locked || !ranged}
      title={
        locked
          ? 'a saved look is locked: rename it to roll'
          : ranged
            ? `roll ${what}: each knob with a play range to anywhere inside it`
            : 'no play ranges here: give a knob one with + play range'
      }
      onClick={() => edit((d) => dice(d, at, Math.random))}
    >
      ⚄
    </button>
  )
}

const Group = ({
  title,
  chip,
  children,
  actions,
}: {
  title: string
  chip: string
  children: ReactNode
  actions?: ReactNode
}) => {
  const { scene } = useCtl()
  return (
    <div className="group">
      <div className="group-title">
        <span>{title}</span>
        <Dice at={chipKnobs(scene, chip).map((k) => k.address)} what="this chip" />
        {actions}
      </div>
      <div className="group-body">{children}</div>
    </div>
  )
}

// A row: its title, its menus, pad and buttons (children), then its knobs; the knobs that fold (dead, or at rest
// and untouched) go into a +N at its end, which opens the row to show them. A focused knob never folds. A row with a
// play range ends in its dice, which roll its knobs, folded ones too.
function Row({ title, knobs, children }: { title?: string; knobs: [string, Address][]; children?: ReactNode }) {
  const { scene, focus } = useCtl()
  const [open, setOpen] = useState(false)
  // the scene holds still between frames, while the live one moves
  const all = useMemo(() => knobsOf(scene), [scene])
  const hidden = knobs.filter(
    ([, at]) =>
      at !== focus &&
      folded(
        scene,
        all.find((k) => k.address === at)!,
      ),
  )
  return (
    <div className="row">
      {title && <span className="row-title">{title}</span>}
      {children}
      {knobs
        .filter((k) => open || !hidden.includes(k))
        .map(([label, at]) => (
          <Knob key={at} label={label} at={at} />
        ))}
      {hidden.length > 0 && (
        <button
          className="mini fold"
          title={hidden.map(([label]) => label).join(' · ')}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? '−' : `+${hidden.length}`}
        </button>
      )}
      {knobs.some(([, at]) => resolve(scene, at)!.play) && <Dice at={knobs.map(([, at]) => at)} what="this row" />}
    </div>
  )
}

export function Section({ chip }: { chip: string }) {
  switch (chip) {
    case 'background':
      return <BackgroundSection />
    case 'frame':
      return (
        <Group title="Frame" chip="frame">
          <Row
            knobs={[
              ['origin x', 'frame.origin[0]'],
              ['origin y', 'frame.origin[1]'],
              ['zoom', 'frame.zoom'],
              ['turn', 'frame.turn'],
            ]}
          />
        </Group>
      )
    case 'contour':
      return (
        <Group title="Contour" chip="contour">
          <Row
            knobs={[
              ['rings', 'contour.rings'],
              ['drift', 'contour.drift'],
              ['radial wt', 'contour.radialWeight'],
            ]}
          />
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
    <Group title="Background" chip="background">
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
    <Group title="Line" chip="line">
      <Row
        knobs={[
          ['width', 'line.width'],
          ['falloff', 'line.falloff'],
          ...(scene.line.kind === 'dots'
            ? ([
                ['dots', 'line.dots.count'],
                ['dot size', 'line.dots.size'],
                ['crawl', 'line.dots.crawl'],
              ] as [string, Address][])
            : []),
        ]}
      >
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
      </Row>
    </Group>
  )
}

function PostSection() {
  const { scene, edit } = useCtl()
  return (
    <Group title="Composite and post" chip="post">
      <Row knobs={[['gamma', 'post.gamma']]}>
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
      </Row>
    </Group>
  )
}

function PaletteSection() {
  const { scene, live, edit } = useCtl()
  const { stops } = scene.palette
  return (
    <Group
      title="Palette"
      chip="palette"
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
      <Row
        knobs={[
          ['hue', 'palette.hue'],
          ['contrast', 'palette.contrast'],
          ['radius', 'palette.radius'],
          ['time', 'palette.time'],
        ]}
      />
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
      {scene.palette.field ? (
        <Row
          title="colour field"
          knobs={[
            ['depth', 'palette.field.depth'],
            ['centre x', 'palette.field.centre[0]'],
            ['centre y', 'palette.field.centre[1]'],
            ['angle', 'palette.field.angle'],
            ['scale', 'palette.field.scale'],
          ]}
        >
          {fielded(scene) && (
            <Choice
              label="kind"
              value={scene.palette.field.kind}
              options={FIELDS}
              onChange={(v) => edit((d) => (d.palette.field!.kind = v))}
            />
          )}
          {canMove(scene, 'palette.field.depth', true) && (
            <>
              {scene.palette.field.steps === undefined ? (
                <button
                  className="mini"
                  title="shift the colours in whole steps, so a two-tone metal pair hops to another pair and never blends to mud"
                  onClick={() => edit((d) => (d.palette.field!.steps = 4))}
                >
                  + steps
                </button>
              ) : (
                <span
                  className="pair"
                  title="the shift in whole steps of 1/steps round the palette; a stepped field holds still, moved only by a morph or a preset"
                >
                  <Stepper
                    label="steps"
                    value={scene.palette.field.steps}
                    range={FIELD_STEPS}
                    onChange={(n) => edit((d) => (d.palette.field!.steps = n))}
                  />
                  <button
                    className="mini"
                    title="drop the steps: a smooth shift"
                    onClick={() => edit((d) => delete d.palette.field!.steps)}
                  >
                    ×
                  </button>
                </span>
              )}
              <label
                className="check"
                title="read the field at the middle of each first-level cell, so a shape takes one colour"
              >
                <input
                  type="checkbox"
                  checked={!!scene.palette.field.atCells}
                  onChange={(e) =>
                    edit((d) => {
                      if (e.target.checked) d.palette.field!.atCells = true
                      else delete d.palette.field!.atCells
                    })
                  }
                />
                at cells
              </label>
            </>
          )}
          <button
            className="mini"
            title="drop the colour field"
            onClick={() =>
              edit((d) => {
                delete d.palette.field
                prune(d)
              })
            }
          >
            ×
          </button>
        </Row>
      ) : (
        <button
          className="mini"
          title="a colour field: the index starts from it by the radius, and its depth shifts every colour, radial round a centre, a linear sweep or a noise wash"
          onClick={() =>
            edit(
              (d) =>
                (d.palette.field = {
                  kind: 'radial',
                  angle: { value: 0 },
                  centre: [{ value: 0 }, { value: 0 }],
                  scale: { value: 1 },
                  depth: { value: 0.25 },
                }),
            )
          }
        >
          + colour field
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
      <Group title={`Level ${id}`} chip={id} actions={actions}>
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
    <Group title={`Level ${id}`} chip={id} actions={actions}>
      <Row
        knobs={[
          ['weight', `${at}.weight`],
          ['scale', `${at}.affine.scale`],
          ['turn', `${at}.affine.turn`],
          ['offset x', `${at}.affine.offset[0]`],
          ['offset y', `${at}.affine.offset[1]`],
        ]}
      />
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
      <Row
        title="lattice"
        knobs={[
          [E2_LABELS[kind][0], `${at}.lattice.e2[0]`],
          [E2_LABELS[kind][1], `${at}.lattice.e2[1]`],
          ...(kind === 'voronoi' ? ([['jitter', `${at}.lattice.jitter`]] as [string, Address][]) : []),
        ]}
      >
        <Choice label="kind" value={kind} options={LATTICES} onChange={(to) => edit((d) => setLattice(d, id, to))} />
        <LatticePad at={at} kind={kind} />
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
      </Row>
      <Row
        title="cell"
        knobs={[
          ['cell turn', `${at}.cell.turn`],
          ['ring phase', `${at}.cell.phase`],
        ]}
      >
        <Choice
          label="turn by"
          value={level.cell.by}
          options={CELLS}
          onChange={(by) => edit((d) => (findLevel(d, id).level.cell.by = by))}
        />
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
      </Row>
      {level.variants.map((v, i) => (
        <Row
          key={i}
          title={level.variants.length > 1 ? `variant ${i + 1}` : 'shape'}
          knobs={[['share', `${at}.variants[${i}].share`], ...shapeKnobs(`${at}.variants[${i}].shape`, v.shape)]}
        >
          <ShapeMenus
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
        </Row>
      ))}
      {level.variants.map(
        ({ shape }, i) =>
          shape.join && (
            <div className="row variant" key={`join${i}`}>
              <span className="row-title">{level.variants.length > 1 ? `join ${i + 1}` : 'join'}</span>
              <ShapeMenus
                at={`${at}.variants[${i}].shape.join.shape`}
                shape={shape.join.shape}
                change={(fn) =>
                  edit((d) => {
                    fn(findLevel(d, id).level.variants[i].shape.join!.shape)
                    prune(d)
                  })
                }
              />
              {shapeKnobs(`${at}.variants[${i}].shape.join.shape`, shape.join.shape).map(([label, a]) => (
                <Knob key={a} label={label} at={a} />
              ))}
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
      <Row
        title="colour"
        knobs={[
          ['at', `${at}.colour.at`],
          ['speed', `${at}.colour.speed`],
          ['cell spread', `${at}.colour.cellSpread`],
        ]}
      />
      {level.fill ? (
        <Row
          title="fill"
          knobs={[
            ['fill', `${at}.fill.amount`],
            ['line', `${at}.fill.line`],
            ['tone', `${at}.fill.tone`],
            ['bands', `${at}.fill.bands`],
            ['step', `${at}.fill.step`],
            ['metal', `${at}.fill.metal`],
            ['light', `${at}.fill.light`],
            ['shade', `${at}.fill.shade`],
            ['ramp', `${at}.fill.ramp`],
            ['alternate', `${at}.fill.alternate`],
          ]}
        >
          {level.cell.spill && (
            <label
              className="check"
              title="front order: where shapes overlap, the lowest row's paint lies in front, then the leftmost's"
            >
              <input
                type="checkbox"
                checked={!!level.fill.front}
                onChange={(e) =>
                  edit((d) => {
                    const { fill } = findLevel(d, id).level
                    if (e.target.checked) fill!.front = true
                    else delete fill!.front
                  })
                }
              />
              front
            </label>
          )}
          <button
            className="mini"
            title="drop the fill"
            onClick={() =>
              edit((d) => {
                delete findLevel(d, id).level.fill
                prune(d)
              })
            }
          >
            ×
          </button>
        </Row>
      ) : (
        <div className="row">
          <span className="row-title">fill</span>
          <button
            className="mini"
            title="paint this level's shapes under the lines: flat, in bands or two-tone metal"
            onClick={() =>
              edit(
                (d) =>
                  (findLevel(d, id).level.fill = {
                    amount: { value: 1 },
                    line: { value: 1 },
                    tone: { value: 0 },
                    bands: { value: 0 },
                    step: { value: 0 },
                    metal: { value: 0 },
                    light: { value: 135 },
                    shade: { value: 0.5 },
                    ramp: { value: 0 },
                    alternate: { value: 0 },
                  }),
              )
            }
          >
            + fill
          </button>
        </div>
      )}
      {level.halftone ? (
        <Row
          title="halftone"
          knobs={[
            ['halftone', `${at}.halftone.amount`],
            ['pitch', `${at}.halftone.pitch`],
            ['size', `${at}.halftone.size`],
            ['fade', `${at}.halftone.fade`],
            ['turn', `${at}.halftone.turn`],
            ['reach', `${at}.halftone.reach`],
          ]}
        >
          <Choice
            label="grid"
            value={level.halftone.grid}
            options={GRIDS}
            onChange={(grid) => edit((d) => (findLevel(d, id).level.halftone!.grid = grid))}
          />
          <button
            className="mini"
            title="drop the halftone"
            onClick={() =>
              edit((d) => {
                delete findLevel(d, id).level.halftone
                prune(d)
              })
            }
          >
            ×
          </button>
        </Row>
      ) : (
        <div className="row">
          <span className="row-title">halftone</span>
          <button
            className="mini"
            title="draw this level as dots, each sized by how much of it draws there: on its own lattice or a screen"
            onClick={() =>
              edit(
                (d) =>
                  (findLevel(d, id).level.halftone = {
                    amount: { value: 1 },
                    grid: 'lattice',
                    pitch: { value: 8 },
                    size: { value: 1 },
                    fade: { value: 0.6 },
                    turn: { value: 0 },
                    reach: { value: 0.05 },
                  }),
              )
            }
          >
            + halftone
          </button>
        </div>
      )}
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
  ziggurat: 'steepness',
}

// A shape's knobs: the star's m, a kind's form, its size, round and twist.
function shapeKnobs(at: Address, shape: Shape): [string, Address][] {
  const kind = shape.kind ?? 'star'
  const form = FORM[kind]
  return [
    ...(kind === 'star' ? ([['m', `${at}.m`]] as [string, Address][]) : []),
    ...(form ? ([[form, `${at}.form`]] as [string, Address][]) : []),
    ['r', `${at}.r`],
    ['round', `${at}.round`],
    ['twist', `${at}.twist`],
  ]
}

// A shape's menus: its kind, the star's points (the stairs' and the ziggurat's steps) and its corner; change edits
// the shape on a draft, then prunes what pointed at a knob it dropped.
function ShapeMenus({ at, shape, change }: { at: Address; shape: Shape; change: (fn: (s: Shape) => void) => void }) {
  const kind = shape.kind ?? 'star'
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
      {(kind === 'star' || kind === 'stairs' || kind === 'ziggurat') && (
        <Stepper
          label={kind === 'star' ? 'points' : 'steps'}
          value={shape.n}
          range={STAR_N}
          onChange={(n) => change((s) => (s.n = n))}
        />
      )}
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
