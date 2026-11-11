import { describe, expect, it } from 'vitest'
import { BANK, LOOKS } from './looks'
import { capturePreset } from './motion'
import { kindOf, knobsOf, parseBank, parseFader, parseScene, resolve, type Bank, type Fader, type Scene } from './scene'

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

describe('a fader pair as JSON', () => {
  const pair = (): Fader => ({
    a: structuredClone(LOOKS[0]),
    b: { ...structuredClone(LOOKS[6]), loop: { seconds: 30 } },
    at: 0.3,
    edge: { seconds: 2, stagger: 0.4, deepFirst: true },
  })

  it('round-trips with its scenes and edge', () => {
    const f = pair()
    expect(parseFader(JSON.stringify(f))).toEqual(f)
  })

  it.each([
    ['a stagger off its range', (f: Fader) => (f.edge.stagger = 2), /^edge\.stagger: 2 is outside/],
    [
      'a direction that is not true or false',
      (f: Fader) => ((f.edge as { deepFirst: unknown }).deepFirst = 'yes'),
      /^edge\.deepFirst: must be true or false/,
    ],
    ['a missing edge', (f: Fader) => delete (f as Partial<Fader>).edge, /^edge: is missing/],
    [
      'a broken scene, named under its side',
      (f: Fader) => (f.b.levels[0].affine.scale.value = 99),
      /^b\.levels\[h1\]\.affine\.scale\.value: 99 is outside/,
    ],
  ])('refuses %s', (_, breakIt, message) => {
    const f = pair()
    breakIt(f)
    expect(() => parseFader(JSON.stringify(f))).toThrow(message)
  })
})

describe('a bank as JSON', () => {
  const bank = (): Bank => ({
    ...structuredClone(BANK),
    moods: [
      {
        id: 'dark',
        name: 'Dark to light',
        value: 0.25,
        targets: [{ knob: 'palette.contrast', from: 0.6, to: 1.4 }],
      },
    ],
  })

  it('round-trips with its entries, links, autopilot and moods', () => {
    const b = bank()
    expect(parseBank(JSON.stringify(b))).toEqual(b)
    expect(parseBank(JSON.stringify(BANK))).toEqual(BANK)
  })

  it.each([
    ['an entry twice', (b: Bank) => b.scenes.push(b.scenes[0]), /^scenes\[\d+\]: .* is in the bank twice/],
    ['a link to an entry not in it', (b: Bank) => (b.links[0][1] = 'nowhere'), /^links\[0\]\[1\]: nowhere is not in/],
    ['an entry linked to itself', (b: Bank) => (b.links[0][1] = b.links[0][0]), /^links\[0\]: links .* to itself/],
    [
      'a link made twice, either way round',
      (b: Bank) => b.links.push([b.links[0][1], b.links[0][0]]),
      /^links\[\d+\]: .* linked twice/,
    ],
    ['a busy off its range', (b: Bank) => (b.autopilot.busy = 2), /^autopilot\.busy: 2 is outside/],
    [
      'a missing change',
      (b: Bank) => delete (b.autopilot as Partial<Bank['autopilot']>).change,
      /^autopilot\.change: is missing/,
    ],
    ['a broken edge', (b: Bank) => (b.autopilot.edge.seconds = -1), /^autopilot\.edge\.seconds: -1 is outside/],
    [
      'a mood whose knob is no kind',
      (b: Bank) => (b.moods[0].targets[0].knob = 'palette.nope'),
      /^moods\[0\]\.targets\[0\]\.knob: palette\.nope names no knob kind/,
    ],
    [
      "a mood off its knob kind's range",
      (b: Bank) => (b.moods[0].targets[0].to = 9),
      /^moods\[0\]\.targets\[0\]\.to: 9 is outside/,
    ],
  ])('refuses %s', (_, breakIt, message) => {
    const b = bank()
    breakIt(b)
    expect(() => parseBank(JSON.stringify(b))).toThrow(message)
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
      'an unknown lattice',
      broken((s) => ((s.levels[0].lattice as { kind: string }).kind = 'penrose')),
      /^levels\[sq1\]\.lattice\.kind: must be one of/,
    ],
    [
      'a voronoi lattice without its jitter',
      broken((s) => (s.levels[0].lattice.kind = 'voronoi')),
      /^levels\[sq1\]\.lattice\.jitter: is missing for a voronoi lattice/,
    ],
    [
      'a jitter on another lattice',
      broken((s) => (s.levels[0].lattice.jitter = { value: 0.5 })),
      /^levels\[sq1\]\.lattice\.jitter: is voronoi only/,
    ],
    [
      'a jitter off its hard range',
      broken((s) => (s.levels[0].lattice = { ...s.levels[0].lattice, kind: 'voronoi', jitter: { value: 2 } })),
      /^levels\[sq1\]\.lattice\.jitter\.value: 2 is outside/,
    ],
    [
      'a polar lattice without its sectors',
      broken((s) => (s.levels[0].lattice.kind = 'polar')),
      /^levels\[sq1\]\.lattice\.sectors: is missing for a polar lattice/,
    ],
    [
      'a fractional sector count',
      broken((s) => (s.levels[0].lattice = { ...s.levels[0].lattice, kind: 'logpolar', sectors: 6.5 })),
      /^levels\[sq1\]\.lattice\.sectors: must be a whole number/,
    ],
    [
      'sectors on another lattice',
      broken((s) => (s.levels[0].lattice.sectors = 6)),
      /^levels\[sq1\]\.lattice\.sectors: is polar and logpolar only/,
    ],
    [
      'a cell step of a later milestone',
      broken((s) => (s.levels[0].cell.by = 'ring')),
      /^levels\[sq1\]\.cell\.by: must be one of none, parity, hash/,
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
    [
      'a beat wave without harmonics',
      broken((s) => (s.modulators[0].wave = 'beat')),
      /^modulators\[0\]\.harmonics: is missing/,
    ],
    [
      'a level named as a fixed part',
      broken((s) => (s.levels[0].id = 'line')),
      /^levels\[0\]\.id: line names a fixed part/,
    ],
    ['stops out of order', broken((s) => (s.palette.stops[1].at = 0)), /^palette\.stops\[1\]\.at: must be above/],
    ['a NaN', broken((s) => (s.post.gamma.value = NaN)), /^post\.gamma\.value: must be a finite number/],
    [
      'a MIDI mapping that names no knob',
      broken((s) => (s.midi = [{ channel: 1, control: 21, knob: 'levels[nope].weight' }])),
      /^midi\[0\]\.knob: levels\[nope\]\.weight names no knob/,
    ],
    [
      'a MIDI mapping to a macro the look lacks',
      broken((s) => (s.midi = [{ channel: 1, control: 21, macro: 'nope' }])),
      /^midi\[0\]\.macro: nope names no macro/,
    ],
    [
      'a MIDI mapping to a knob and a macro',
      broken((s) => (s.midi = [{ channel: 1, control: 21, knob: 'frame.zoom', macro: 'nope' } as never])),
      /^midi\[0\]: must name one knob or one macro/,
    ],
    [
      'a MIDI control mapped twice',
      broken(
        (s) =>
          (s.midi = [
            { channel: 2, control: 21, knob: 'frame.zoom' },
            { channel: 2, control: 21, knob: 'frame.turn' },
          ]),
      ),
      /^midi\[1\]: channel 2 number 21 is mapped twice/,
    ],
    [
      'a MIDI channel off 1 to 16',
      broken((s) => (s.midi = [{ channel: 0, control: 21, knob: 'frame.zoom' }])),
      /^midi\[0\]\.channel: 0 is outside 1 to 16/,
    ],
  ])('%s', (_, parse, message) => {
    expect(parse).toThrow(message)
  })
})
