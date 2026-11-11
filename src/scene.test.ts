import { describe, expect, it } from 'vitest'
import { LOOKS } from './looks'
import { capturePreset } from './motion'
import { kindOf, knobsOf, parseScene, resolve, type Scene } from './scene'

const broken = (fn: (s: Record<string, unknown> & Scene) => void) => {
  const s = structuredClone(LOOKS[0]) as Record<string, unknown> & Scene
  fn(s)
  return () => parseScene(JSON.stringify(s))
}

describe('a scene as JSON', () => {
  it.each(LOOKS.map((look) => [look.name, look] as const))('%s round-trips through the parse', (_, look) => {
    expect(parseScene(JSON.stringify(look))).toEqual(look)
  })

  it('round-trips with a captured preset and a loop', () => {
    const look = structuredClone(LOOKS[6])
    look.presets.push(capturePreset(look, 'all of it'))
    look.loop = { seconds: 60 }
    expect(parseScene(JSON.stringify(look))).toEqual(look)
  })

  it('names every knob by a path through level ids, sub-chains included', () => {
    const branching = LOOKS.find((l) => l.name.includes('Branching'))!
    const addresses = knobsOf(branching).map((k) => k.address)
    expect(addresses).toContain('levels[root].variants[1].below[sqA].affine.scale')
    expect(resolve(branching, 'levels[root].variants[1].below[sqA].affine.scale')).toBe(
      branching.levels[0].variants[1].below![0].affine.scale,
    )
    expect(kindOf('levels[root].variants[1].below[sqA].affine.offset[1]')).toBe('levels[].affine.offset[1]')
    for (const a of addresses) expect(resolve(branching, a)).toBeDefined()
  })
})

describe('the parse refuses a broken scene, naming its field', () => {
  it.each([
    ['a missing field', broken((s) => delete (s as Partial<Scene>).contour), /^contour: is missing/],
    ['an unknown field', broken((s) => (s.extra = 1)), /^extra: is not a field/],
    [
      'a value off its hard range',
      broken((s) => (s.levels[0].affine.scale.value = 99)),
      /^levels\[sq1\]\.affine\.scale\.value: 99 is outside/,
    ],
    [
      'a play range off the hard range',
      broken((s) => (s.frame.zoom.play = [0, 2])),
      /^frame\.zoom\.play\[0\]: 0 is outside/,
    ],
    ['a reversed play range', broken((s) => (s.frame.zoom.play = [2, 1])), /^frame\.zoom\.play: must run low to high/],
    ['a wrong kind', broken((s) => ((s.line as { kind: string }).kind = 'neon')), /^line\.kind: must be one of/],
    [
      'a lattice of a later milestone',
      broken((s) => ((s.levels[0].lattice as { kind: string }).kind = 'voronoi')),
      /^levels\[sq1\]\.lattice\.kind/,
    ],
    ['a level id used twice', broken((s) => (s.levels[1].id = 'sq1')), /^levels\[1\]\.id: sq1 is used twice/],
    [
      'a link to a later level',
      broken((s) => (s.levels[0].link = 'sq2')),
      /^levels\[sq1\]\.link: sq2 is not an earlier level/,
    ],
    [
      'a fractional star n',
      broken((s) => (s.levels[0].variants[0].shape.n = 5.5)),
      /^levels\[sq1\]\.variants\[0\]\.shape\.n: must be a whole number/,
    ],
    [
      'a target that names no knob',
      broken((s) => (s.modulators[0].targets[0].knob = 'levels[nope].weight')),
      /^modulators\[0\]\.targets\[0\]\.knob: levels\[nope\]\.weight names no knob/,
    ],
    [
      'a steps wave without steps',
      broken((s) => (s.modulators[0].wave = 'steps')),
      /^modulators\[0\]\.steps: is missing/,
    ],
    ['stops out of order', broken((s) => (s.palette.stops[1].at = 0)), /^palette\.stops\[1\]\.at: must be above/],
    ['a NaN', broken((s) => (s.post.gamma.value = NaN)), /^post\.gamma\.value: must be a finite number/],
  ])('%s', (_, parse, message) => {
    expect(parse).toThrow(message)
  })
})
