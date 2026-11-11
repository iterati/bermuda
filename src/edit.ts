// Edits of a scene's structure, made on a draft (motion.ts update): adding, removing and moving levels,
// then pruning what pointed at a level that is gone.
import {
  allLevels,
  clamp,
  hardRange,
  knobsOf,
  resolve,
  SPILLS,
  type LatticeKind,
  type Level,
  type Scene,
} from './scene'

export function findLevel(scene: Scene, id: string): { level: Level; list: Level[] } {
  const found = allLevels(scene.levels).find(({ level }) => level.id === id)
  if (!found) throw new Error(`no level ${id}`)
  return found
}

export function newId(scene: Scene, base: string): string {
  const ids = new Set(allLevels(scene.levels).map(({ level }) => level.id))
  const stem = base.replace(/\d+$/, '') || 'l'
  let n = 1
  while (ids.has(`${stem}${n}`)) n++
  return `${stem}${n}`
}

// A copy of a level under the id given (newId), sub-chains dropped, placed after it: a linked level's copy
// joins its group.
export function duplicateLevel(scene: Scene, id: string, as: string) {
  const { level, list } = findLevel(scene, id)
  const copy: Level = structuredClone(level)
  copy.id = as
  for (const v of copy.variants) delete v.below
  list.splice(list.indexOf(level) + 1, 0, copy)
}

export function removeLevel(scene: Scene, id: string) {
  const { level, list } = findLevel(scene, id)
  if (list === scene.levels && list.length === 1) return
  for (const follower of list.filter((l) => l.link === id)) unlink(scene, follower.id)
  list.splice(list.indexOf(level), 1)
  for (const { level: l } of allLevels(scene.levels))
    for (const v of l.variants) if (v.below?.length === 0) delete v.below
  prune(scene)
}

export function moveLevel(scene: Scene, id: string, by: -1 | 1) {
  const { level, list } = findLevel(scene, id)
  const i = list.indexOf(level)
  if (i + by < 0 || i + by >= list.length) return
  // a swap that puts a linked level above its leader unlinks it first, with the values it showed
  const [upper, lower] = by < 0 ? [list[i - 1], level] : [level, list[i + 1]]
  if (lower.link === upper.id) unlink(scene, lower.id)
  const [moving] = list.splice(i, 1)
  list.splice(i + by, 0, moving)
}

export function addSubChain(scene: Scene, id: string, variant: number) {
  const { level } = findLevel(scene, id)
  const child: Level = structuredClone(level)
  child.id = newId(scene, id)
  delete child.link
  child.variants = [structuredClone(level.variants[variant])]
  delete child.variants[0].below
  level.variants[variant].below = [child]
}

// Change a level's lattice kind: voronoi gets its jitter and polar and logpolar their sectors, from the pad
// itself and six round; the other kinds drop them, with whatever pointed at the jitter.
export function setLattice(scene: Scene, id: string, kind: LatticeKind) {
  const { lattice } = findLevel(scene, id).level
  lattice.kind = kind
  if (kind !== 'voronoi') delete lattice.jitter
  else lattice.jitter ??= { value: 0 }
  if (kind !== 'polar' && kind !== 'logpolar') delete lattice.sectors
  else lattice.sectors ??= 6
  if (!SPILLS.includes(kind)) delete findLevel(scene, id).level.cell.spill
  prune(scene)
}

// The nearest aligned nesting of a level in the level it re-tiles: a scale s and turn R that put s R (1, 0)
// and s R e2 of the parent's pad on the level's own lattice, so its cells line up across the parent's
// (√2 at 45° for squares, √3 at 30° for hexes, 2 at 0° for any pad). None when the level has no parent,
// when the parent's cells do not repeat by its pad (only oblique and voronoi at jitter 0 do: triangle's
// halves and polar, logpolar, brick and fold sit apart otherwise), when the level's own cells are off its
// pad (a jittered voronoi), when the parent turns its cells two ways or mirrors them, or when the two pads have no
// nesting inside the scale's hard range.
export function alignedNesting(scene: Scene, id: string): { scale: number; turn: number } | undefined {
  const { level, list } = findLevel(scene, id)
  const i = list.indexOf(level)
  // the level before it in its list, or the level whose variant carries its sub-chain
  const above =
    i > 0
      ? list[i - 1]
      : allLevels(scene.levels).find(({ level: l }) => l.variants.some((v) => v.below === list))?.level
  // a linked parent plays its leader's lattice
  const parent = above?.link ? findLevel(scene, above.link).level : above
  if (!parent) return undefined
  const { lattice, cell } = parent
  if (lattice.kind !== 'oblique' && !(lattice.kind === 'voronoi' && lattice.jitter!.value === 0)) return undefined
  if (!['oblique', 'triangle', 'voronoi'].includes(level.lattice.kind)) return undefined
  if (level.lattice.kind === 'voronoi' && level.lattice.jitter!.value !== 0) return undefined
  // a parent's cell turn turns what the level re-tiles: one way for all its cells, or two ways, or by a
  // spread across its linked group, which no single turn lines up, nor a mirror's reflection
  if ((cell.by !== 'none' && cell.turn.value !== 0) || cell.turn.spread || cell.by === 'mirror') return undefined
  const cellTurn = cell.by === 'none' ? cell.turn.value : 0
  const [px, py] = lattice.e2.map((k) => k.value)
  const [cx, cy] = level.lattice.e2.map((k) => k.value)
  const { scale, turn } = level.affine
  const [lo, hi] = hardRange('levels[].affine.scale')
  const near = (x: number) => Math.abs(x - Math.round(x)) < 1e-4
  let best: { scale: number; turn: number; cost: number } | undefined
  for (let a = -8; a <= 8; a++)
    for (let b = -8; b <= 8; b++) {
      // v = s R (1, 0), a lattice vector of the level's pad; then s R e2 is v times e2 as complex numbers
      const [vx, vy] = [a + b * cx, b * cy]
      const s = Math.hypot(vx, vy)
      if (s < lo || s > hi) continue
      const [wx, wy] = [vx * px - vy * py, vx * py + vy * px]
      if (!near(wy / cy) || !near(wx - (wy / cy) * cx)) continue
      const deg = (Math.atan2(vy, vx) * 180) / Math.PI - cellTurn
      let t = deg + 360 * Math.round((turn.value - deg) / 360)
      if (Math.abs(t) > 360) t -= 360 * Math.sign(t)
      const cost = Math.log(s / scale.value) ** 2 + (((t - turn.value) * Math.PI) / 180) ** 2
      if (!best || cost < best.cost) best = { scale: s, turn: t, cost }
    }
  return best && { scale: best.scale, turn: best.turn }
}

// Unlink every level whose link no longer points at an earlier unlinked level of the same list, and drop
// every modulator target, macro target, preset value and MIDI mapping whose knob or macro is gone.
export function prune(scene: Scene) {
  for (const { level, list } of allLevels(scene.levels)) {
    if (!level.link) continue
    const leader = list.slice(0, list.indexOf(level)).find((l) => l.id === level.link)
    if (leader && !leader.link) continue
    if (list.some((l) => l.id === level.link)) unlink(scene, level.id)
    else delete level.link
  }
  for (const m of scene.modulators) m.targets = m.targets.filter((t) => resolve(scene, t.knob))
  for (const m of scene.macros) m.targets = m.targets.filter((t) => resolve(scene, t.knob))
  for (const p of scene.presets)
    p.values = Object.fromEntries(Object.entries(p.values).filter(([address]) => resolve(scene, address)))
  if (scene.midi)
    scene.midi = scene.midi.filter((m) =>
      'knob' in m ? resolve(scene, m.knob) : scene.macros.some((x) => x.id === m.macro),
    )
}

// A linked level as it plays: its leader's structure and knobs under its own id and link, each variant
// keeping the linked level's own sub-chain at its index.
export function asLinked(level: Level, leader: Level): Level {
  const out: Level = { ...structuredClone(leader), id: level.id, link: level.link }
  out.variants.forEach((v, i) => {
    const below = level.variants[i]?.below
    if (below) v.below = below
    else delete v.below
  })
  return out
}

// Unlink a level: it keeps what it was showing, its leader's structure and values plus the group's spread.
export function unlink(scene: Scene, id: string) {
  const { level, list } = findLevel(scene, id)
  const group = list.filter((l) => l.id === level.link || l.link === level.link)
  const share = group.indexOf(level) / group.length
  const own = asLinked(
    level,
    list.find((l) => l.id === level.link)!,
  )
  delete own.link
  list[list.indexOf(level)] = own
  for (const { address, knob, level: at } of knobsOf(scene))
    if (at?.level === own) knob.value = clamp(knob.value + (knob.spread ?? 0) * share, hardRange(address))
}
