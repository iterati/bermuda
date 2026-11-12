// The bank: its entries as a graph round a ring, the links the autopilot walks, the autopilot's handles, and the
// bank as a file. Clicking an entry goes there; shift-clicking one links it to the entry playing, or
// unlinks it.
import { entryScene, neighbours, toggleLink } from '../play'
import { parseBank, type Bank as BankShape, type Scene } from '../scene'
import { Slider } from './Knob'
import { download } from './Looks'

type Props = {
  bank: BankShape
  looks: Scene[]
  current?: string // the entry playing
  next?: string // the entry Play goes to next: the one queued, else the autopilot's plan
  onBank: (bank: BankShape) => void
  onGo: (entry: string) => void
  onAdd: () => void
  onStep: () => void
  onError: (message: string) => void
}

const SIZE = 330
const R = 66

// 'Tapestry 7 - Hexes' -> 'T7 Hexes', 'Remix - Star ladder' -> 'Star ladder', 'Lattice - Truchet' -> 'Truchet', a
// preset entry by its preset
function label(entry: string): string {
  const preset = / \/ ([^/]+)$/.exec(entry)
  const text = preset
    ? `· ${preset[1]}`
    : entry.replace(/^Tapestry (\w+) - /, 'T$1 ').replace(/^(Remix|Lattice) - /, '')
  return text.length > 16 ? `${text.slice(0, 15)}…` : text
}

function Slide(props: {
  label: string
  title: string
  value: number
  min: number
  max: number
  step: number
  shown?: string
  onChange: (v: number) => void
}) {
  return (
    <label className="slide" title={props.title}>
      <span>{props.label}</span>
      <Slider min={props.min} max={props.max} step={props.step} value={props.value} onChange={props.onChange} />
      <b>{props.shown ?? props.value.toFixed(2)}</b>
    </label>
  )
}

export function Bank({ bank, looks, current, next, onBank, onGo, onAdd, onStep, onError }: Props) {
  const auto = bank.autopilot
  const setAuto = (part: Partial<BankShape['autopilot']>) => onBank({ ...bank, autopilot: { ...auto, ...part } })
  const n = bank.scenes.length
  const at = (i: number) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n
    return { a, x: SIZE / 2 + R * Math.cos(a), y: SIZE / 2 + R * Math.sin(a) }
  }
  const where = new Map(bank.scenes.map((s, i) => [s, at(i)]))
  const near = new Set(current ? neighbours(bank, current) : [])
  return (
    <div className="panel-block bank">
      <div className="block-title">
        <span>Bank</span>
        <span className="actions">
          <button className="mini" title="add what is playing to the bank" onClick={onAdd}>
            + add
          </button>
          <button
            className="mini"
            disabled={!current || !bank.scenes.includes(current)}
            title="take the entry playing out of the bank"
            onClick={() =>
              onBank({
                ...bank,
                scenes: bank.scenes.filter((s) => s !== current),
                links: bank.links.filter((l) => !l.includes(current!)),
              })
            }
          >
            − remove
          </button>
          <button className="mini" title="download the bank as a JSON file" onClick={() => download('bank', bank)}>
            export
          </button>
          <label className="mini file">
            import
            <input
              type="file"
              accept=".json,application/json"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                try {
                  const b = parseBank(await file.text())
                  const missing = b.scenes.filter((s) => !entryScene(looks, s))
                  if (missing.length) onError(`${file.name}: no look here for ${missing.join(', ')}`)
                  else onBank(b)
                } catch (err) {
                  onError(`${file.name}: ${(err as Error).message}`)
                }
              }}
            />
          </label>
        </span>
      </div>
      <svg className="graph" viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {bank.links.map(([a, b]) => {
          const [p, q] = [where.get(a)!, where.get(b)!]
          const lit = current === a || current === b
          const going = lit && next !== current && (next === a || next === b)
          return (
            <path
              key={`${a}|${b}`}
              className={going ? 'going' : lit ? 'lit' : ''}
              d={`M${p.x},${p.y} Q${SIZE / 2},${SIZE / 2} ${q.x},${q.y}`}
            />
          )
        })}
        {bank.scenes.map((s) => {
          const { a, x, y } = where.get(s)!
          const left = Math.cos(a) < -1e-6
          const turn = (a * 180) / Math.PI + (left ? 180 : 0)
          const cls = s === current ? 'current' : s === next ? 'next' : near.has(s) ? 'near' : ''
          return (
            <g
              key={s}
              className={`entry ${cls}`}
              onClick={(e) => {
                if (!e.shiftKey) return onGo(s)
                if (!current || !bank.scenes.includes(current) || current === s)
                  return onError('shift-click links an entry to the one playing: go to an entry of the bank first')
                onBank(toggleLink(bank, current, s))
              }}
            >
              <title>{s}</title>
              <circle cx={x} cy={y} r={s === current ? 6 : 4.5} />
              <text
                x={x + (left ? -9 : 9)}
                y={y}
                transform={`rotate(${turn} ${x} ${y})`}
                textAnchor={left ? 'end' : 'start'}
                dominantBaseline="middle"
              >
                {label(s)}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="dim hint">click goes there · shift-click links it to the one playing</div>
      <div className="auto">
        <label className="check" title="the autopilot walks the bank in Play (key O)">
          <input type="checkbox" checked={auto.on} onChange={(e) => setAuto({ on: e.target.checked })} />
          autopilot
        </label>
        <button className="mini" title="the autopilot's next move, now (key N)" onClick={onStep}>
          next ›
        </button>
        <Slide
          label="pace"
          title="clock units (beats) from one change to the next; at or under the transition's length it never rests"
          value={auto.every}
          min={1}
          max={64}
          step={1}
          shown={`${auto.every} beats`}
          onChange={(every) => setAuto({ every })}
        />
        <Slide
          label="busy"
          title="the share of a look's playable knobs and macros each move inside it sets afresh"
          value={auto.busy}
          min={0}
          max={1}
          step={0.01}
          onChange={(busy) => setAuto({ busy })}
        />
        <Slide
          label="change"
          title="the chance a move leaves the look for another entry, against playing inside it"
          value={auto.change}
          min={0}
          max={1}
          step={0.01}
          onChange={(change) => setAuto({ change })}
        />
        <Slide
          label="wander"
          title="the chance a move strays off the links to any entry of the bank"
          value={auto.wander}
          min={0}
          max={1}
          step={0.01}
          onChange={(wander) => setAuto({ wander })}
        />
        <Slide
          label="length"
          title="seconds each change of Play takes"
          value={auto.edge.seconds}
          min={0}
          max={10}
          step={0.1}
          shown={`${auto.edge.seconds.toFixed(1)} s`}
          onChange={(seconds) => setAuto({ edge: { ...auto.edge, seconds } })}
        />
        <Slide
          label="stagger"
          title="how far apart the depths morph in Play's changes: 0 all at once, 1 one after another"
          value={auto.edge.stagger}
          min={0}
          max={1}
          step={0.01}
          onChange={(stagger) => setAuto({ edge: { ...auto.edge, stagger } })}
        />
        <label className="check" title="Play's changes morph the deepest levels first">
          <input
            type="checkbox"
            checked={auto.edge.deepFirst}
            onChange={(e) => setAuto({ edge: { ...auto.edge, deepFirst: e.target.checked } })}
          />
          deep first
        </label>
      </div>
    </div>
  )
}
