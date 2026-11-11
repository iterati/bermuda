// Edits of a scene's structure, made on a draft (motion.ts update): adding, removing and moving levels,
// then pruning what pointed at a level that is gone.
import { allLevels, clamp, hardRange, knobsOf, resolve, type Level, type Scene } from './scene'

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

// A copy of a level under the id given (newId), sub-chains dropped and unlinked, placed after it.
export function duplicateLevel(scene: Scene, id: string, as: string) {
  const { level, list } = findLevel(scene, id)
  const copy: Level = structuredClone(level)
  copy.id = as
  delete copy.link
  for (const v of copy.variants) delete v.below
  list.splice(list.indexOf(level) + 1, 0, copy)
}

export function removeLevel(scene: Scene, id: string) {
  const { level, list } = findLevel(scene, id)
  if (list === scene.levels && list.length === 1) return
  list.splice(list.indexOf(level), 1)
  for (const { level: l } of allLevels(scene.levels))
    for (const v of l.variants) if (v.below?.length === 0) delete v.below
  prune(scene)
}

export function moveLevel(scene: Scene, id: string, by: -1 | 1) {
  const { level, list } = findLevel(scene, id)
  const i = list.indexOf(level)
  if (i + by < 0 || i + by >= list.length) return
  list.splice(i, 1)
  list.splice(i + by, 0, level)
  prune(scene)
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

// Drop links that no longer point at an earlier unlinked level of the same list, and every modulator target,
// macro target and preset value whose knob is gone.
export function prune(scene: Scene) {
  for (const { level, list } of allLevels(scene.levels)) {
    const leader = list.slice(0, list.indexOf(level)).find((l) => l.id === level.link)
    if (level.link && (!leader || leader.link)) delete level.link
  }
  for (const m of scene.modulators) m.targets = m.targets.filter((t) => resolve(scene, t.knob))
  for (const m of scene.macros) m.targets = m.targets.filter((t) => resolve(scene, t.knob))
  for (const p of scene.presets)
    p.values = Object.fromEntries(Object.entries(p.values).filter(([address]) => resolve(scene, address)))
}

// Unlink a level: it keeps the knobs it was showing, its leader's values plus the group's spread.
export function unlink(scene: Scene, id: string) {
  const { level, list } = findLevel(scene, id)
  const group = list.filter((l) => l.id === level.link || l.link === level.link)
  const share = group.indexOf(level) / group.length
  for (const { address, knob, level: at } of knobsOf(scene)) {
    if (at?.level !== level) continue
    const shared = resolve(scene, at.prefix.replace(/\[[^\]]+\]$/, `[${level.link}]`) + address.slice(at.prefix.length))
    if (shared) knob.value = clamp(shared.value + (shared.spread ?? 0) * share, hardRange(address))
  }
  delete level.link
}
