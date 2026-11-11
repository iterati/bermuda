// The chain as chips: background, frame, the levels with their sub-chains under the variants that carry them,
// then contour, line, palette and post. Click a chip to pick it.
import { duplicateLevel, newId } from '../edit'
import type { Level, Shape } from '../scene'
import { useCtl } from './controls'

const latticeName = (l: Level) => {
  const { kind, sectors } = l.lattice
  if (sectors !== undefined) return `${kind} ${sectors}`
  if (kind !== 'oblique') return kind
  const [s, h] = [l.lattice.e2[0].value, l.lattice.e2[1].value]
  if (s < 0.02 && Math.abs(h - 1) < 0.02) return 'square'
  if (Math.abs(s - 0.5) < 0.02 && Math.abs(h - Math.sqrt(3) / 2) < 0.02) return 'hex'
  return s < 0.02 ? 'rect' : 'rhombic'
}

// a star by its points, another kind by its name, a + for a joined shape
const shapeName = (s: Shape) => `${(s.kind ?? 'star') === 'star' ? `★${s.n}` : s.kind}${s.join ? '+' : ''}`

function Levels({ levels, picked, depth }: { levels: Level[]; picked: string; depth: number }) {
  const { pick } = useCtl()
  return levels.map((l) => (
    <div key={l.id}>
      <button
        className={`chip level${picked === l.id ? ' picked' : ''}${l.weight.value === 0 ? ' spacer' : ''}${l.link ? ' linked' : ''}`}
        style={{ marginLeft: depth * 14 }}
        onClick={() => pick(l.id)}
      >
        <b>{l.id}</b>
        <span className="dim">
          {l.link ? `→ ${l.link}` : `${latticeName(l)} · ${l.variants.map((v) => shapeName(v.shape)).join(' ')}`}
        </span>
      </button>
      {l.variants.map(
        (v, i) =>
          v.below && (
            <div key={i}>
              <div className="sub" style={{ marginLeft: depth * 14 + 10 }}>
                variant {i + 1} below
              </div>
              <Levels levels={v.below} picked={picked} depth={depth + 1} />
            </div>
          ),
      )}
    </div>
  ))
}

export function Chain({ picked }: { picked: string }) {
  const { scene, edit, pick } = useCtl()
  const chip = (id: string, label: string) => (
    <button className={`chip${picked === id ? ' picked' : ''}`} onClick={() => pick(id)}>
      {label}
    </button>
  )
  return (
    <div className="chain">
      {chip('background', 'Background')}
      {chip('frame', 'Frame')}
      <Levels levels={scene.levels} picked={picked} depth={0} />
      <button
        className="mini add-level"
        onClick={() => {
          const last = scene.levels[scene.levels.length - 1].id
          const id = newId(scene, last)
          edit((d) => duplicateLevel(d, last, id))
          pick(id)
        }}
      >
        + level
      </button>
      {chip('contour', 'Contour')}
      {chip('line', 'Line')}
      {chip('palette', 'Palette')}
      {chip('post', 'Composite · post')}
    </div>
  )
}
