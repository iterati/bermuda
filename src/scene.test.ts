import { describe, expect, it } from 'vitest'
import { background, BANK, join, level, LOOKS, mod, scene, shape, star } from './looks'
import { capturePreset } from './motion'
import {
  BACKGROUNDS,
  CELLS,
  FORMLESS,
  KINDS,
  kindOf,
  knobsOf,
  LINES,
  parseBank,
  parseFader,
  parseScene,
  resolve,
  SHAPES,
  type Address,
  VARIATIONS,
  type Bank,
  type Fader,
  type Scene,
} from './scene'

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

  // every shape kind, alone and joined into a star, with corner, onion and spill, under a dotted line
  it.each(SHAPES.filter((k) => k !== 'star'))('round-trips a %s, alone and joined, dotted', (kind) => {
    const look = scene({
      name: kind,
      levels: [
        level('a', { shape: shape(kind, 0.4, 0.3, { n: 5, corner: 0.05, onion: 0.02 }), spill: 0.5 }),
        level('b', {
          shape: star(6, 3, 0.3, { join: join(shape(kind, 0.2, 0.7, { corner: 0.02 }), [0.1, -0.2], 0.1) }),
        }),
      ],
      line: 'dots',
      dots: { count: { value: 12, spread: 4 }, size: 0.3, crawl: -1 },
    })
    expect(parseScene(JSON.stringify(look))).toEqual(look)
    expect(resolve(look, 'levels[b].variants[0].shape.join.shape.form')?.value).toBe(
      FORMLESS.includes(kind) ? undefined : 0.7,
    )
    expect(kindOf('levels[b].variants[0].shape.join.offset[1]')).toBe('levels[].variants[].shape.join.offset[1]')
  })

  // every cell step and every variation, under an orbit trap
  it.each(CELLS)('round-trips a level by %s, every variation and an orbit trap', (by) => {
    const look = scene({
      name: by,
      levels: [level('a', { by, cellTurn: 20, cellPhase: 0.3, vary: VARIATIONS.map((kind, i) => [kind, i / 40]) })],
      trap: { weight: { value: 2, play: [1, 3] }, size: 0.2 },
    })
    expect(parseScene(JSON.stringify(look))).toEqual(look)
    expect(resolve(look, 'palette.trap.size')?.value).toBe(0.2)
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

describe('the knob kinds', () => {
  // whether the knob at address shows under the scene's settings
  const shows = (s: Scene, address: Address) =>
    KINDS[kindOf(address)].shows?.(
      s,
      knobsOf(s).find((k) => k.address === address)!,
    ) ?? true

  it.each(Object.entries(KINDS))('%s has a range, a label and one line of help', (_, kind) => {
    expect(kind.range[0]).toBeLessThan(kind.range[1])
    expect(kind.label).not.toBe('')
    expect(kind.help).not.toBe('')
    expect(kind.help).not.toMatch(/[\n—]/)
    expect(kind.help.length).toBeLessThanOrEqual(140)
  })

  it.each(LOOKS.map((look) => [look.name, look] as const))('every knob of %s has a kind', (_, look) => {
    for (const { address } of knobsOf(look)) expect(KINDS[kindOf(address)], address).toBeDefined()
  })

  it('flags the kinds a player reaches for as top', () => {
    expect(
      Object.keys(KINDS)
        .filter((k) => KINDS[k].top)
        .sort(),
    ).toEqual(
      [
        'levels[].affine.scale',
        'levels[].variants[].shape.r',
        'levels[].colour.at',
        'levels[].variants[].shape.m',
        'levels[].variants[].shape.form',
        'line.width',
        'levels[].affine.turn',
        'palette.hue',
        'levels[].lattice.e2[0]',
        'levels[].lattice.e2[1]',
        'frame.zoom',
        'contour.radialWeight',
        'levels[].variants[].shape.round',
        'background.at[0]',
        'background.amount',
      ].sort(),
    )
  })

  it.each(LINES)('shows falloff on a %s line unless it is hard', (kind) => {
    const s = scene({ name: kind, levels: [level('a')], line: kind, dots: { count: 8, size: 0.3, crawl: 1 } })
    expect(shows(s, 'line.falloff')).toBe(kind !== 'hard')
  })

  it('shows drift and ring phase only when the rings can show', () => {
    const ringed = (o: Parameters<typeof scene>[0]) => {
      const s = scene(o)
      return [shows(s, 'contour.drift'), shows(s, 'levels[a].cell.phase')]
    }
    const levels = [level('a')]
    expect(ringed({ name: 'none', levels, rings: 0 })).toEqual([false, false])
    expect(ringed({ name: 'one', levels, rings: 1 })).toEqual([true, true])
    expect(ringed({ name: 'spread', levels, rings: { value: 0, spread: 2 } })).toEqual([true, true])
    expect(ringed({ name: 'mod', levels, modulators: [mod('m', 'cos', 8, [['contour.rings', 1]])] })).toEqual([
      true,
      true,
    ])
    const macros = [{ id: 'x', name: 'x', value: 0, targets: [{ knob: 'contour.rings', from: 0, to: 2 }] }]
    expect(ringed({ name: 'macro', levels, macros })).toEqual([true, true])
  })

  it("shows a variant's share only when its level has more than one", () => {
    const one = scene({ name: 'one', levels: [level('a')] })
    expect(shows(one, 'levels[a].variants[0].share')).toBe(false)
    const tapestry = LOOKS.find((l) => l.name.startsWith('Tapestry 3'))!
    expect(tapestry.levels.find((l) => l.id === 'st1')!.variants).toHaveLength(4)
    expect(shows(tapestry, 'levels[st1].variants[2].share')).toBe(true)
  })

  it("shows m only on a star's, the joined shape's too", () => {
    const s = scene({
      name: 'm',
      levels: [
        level('a', { shape: star(6, 3, 0.3, { join: join(shape('box', 0.2, 0.5), [0.1, 0], 0.1) }) }),
        level('b', { shape: shape('box', 0.3, 0.5, { join: join(star(5, 2, 0.2), [0.1, 0], 0.1) }) }),
      ],
    })
    expect(shows(s, 'levels[a].variants[0].shape.m')).toBe(true)
    expect(shows(s, 'levels[a].variants[0].shape.join.shape.m')).toBe(false)
    expect(shows(s, 'levels[b].variants[0].shape.m')).toBe(false)
    expect(shows(s, 'levels[b].variants[0].shape.join.shape.m')).toBe(true)
  })

  it('shows the knobs each background kind uses', () => {
    const at = ['at[0]', 'at[1]', 'amount', 'turn', 'scale', 'edge', 'seep'].map((k) => `background.${k}`)
    const showing = (kind: (typeof BACKGROUNDS)[number]) =>
      at.filter((a) => shows({ ...LOOKS[0], background: background(kind) }, a))
    expect(showing('flat')).toEqual(['background.at[0]', 'background.amount'])
    expect(showing('gradient')).toEqual([
      'background.at[0]',
      'background.at[1]',
      'background.amount',
      'background.turn',
    ])
    expect(showing('soak')).toEqual(at.filter((a) => a !== 'background.turn'))
  })

  it('shows the dots knobs only on a dotted line, though they stay when the kind moves on', () => {
    const dots = { count: 8, size: 0.3, crawl: 1 }
    for (const at of ['line.dots.count', 'line.dots.size', 'line.dots.crawl']) {
      expect(shows(scene({ name: 'dots', levels: [level('a')], line: 'dots', dots }), at)).toBe(true)
      expect(shows(scene({ name: 'glow', levels: [level('a')], line: 'glow', dots }), at)).toBe(false)
    }
  })
})

describe('a background', () => {
  const tapestry1 = LOOKS.find((l) => l.name.startsWith('Tapestry 1 '))!

  it('is on no built-in look', () => {
    expect(LOOKS.filter((l) => l.background)).toEqual([])
  })

  it.each(BACKGROUNDS)('round-trips Tapestry 1 over a %s', (kind) => {
    const look = { ...structuredClone(tapestry1), background: background(kind) }
    expect(parseScene(JSON.stringify(look))).toEqual(look)
  })

  it('round-trips a modulator target, a macro target, a preset value and a MIDI mapping on its amount', () => {
    const look = { ...structuredClone(tapestry1), background: background('soak') }
    look.modulators.push(mod('bg', 'ramp', 8, [['background.amount', 0.2]]))
    look.macros.push({ id: 'm', name: 'm', value: 0, targets: [{ knob: 'background.amount', from: 0, to: 1 }] })
    look.presets.push({ name: 'dim', values: { 'background.amount': 0.1 } })
    look.midi = [{ channel: 1, control: 30, knob: 'background.amount' }]
    expect(parseScene(JSON.stringify(look))).toEqual(look)
  })

  it('has its 7 knobs in knobsOf when it is there, and none when it is not', () => {
    const bg = (s: Scene) => knobsOf(s).filter((k) => k.address.startsWith('background'))
    expect(bg({ ...tapestry1, background: background('flat') }).map((k) => k.address)).toEqual([
      'background.at[0]',
      'background.at[1]',
      'background.amount',
      'background.turn',
      'background.scale',
      'background.edge',
      'background.seep',
    ])
    expect(bg(tapestry1)).toEqual([])
  })

  const refused = (fn: (bg: Record<string, unknown>) => void) =>
    broken((s) => {
      s.background = background('soak')
      fn(s.background)
    })
  it.each([
    ['an unknown kind', refused((bg) => (bg.kind = 'image')), /^background\.kind: must be one of flat, gradient, soak/],
    ['a missing field', refused((bg) => delete bg.seep), /^background\.seep: is missing/],
    ['an unknown field', refused((bg) => (bg.drift = { value: 0 })), /^background\.drift: is not a field/],
    [
      'an amount off 0 to 1',
      refused((bg) => (bg.amount = { value: 1.5 })),
      /^background\.amount\.value: 1\.5 is outside 0 to 1/,
    ],
    [
      'a level called background',
      broken((s) => (s.levels[0].id = 'background')),
      /^levels\[0\]\.id: background names a fixed part/,
    ],
  ])('refuses %s, naming its field', (_, parse, message) => {
    expect(parse).toThrow(message)
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
      'an unknown cell step',
      broken((s) => ((s.levels[0].cell as { by: string }).by = 'weave')),
      /^levels\[sq1\]\.cell\.by: must be one of none, parity, hash, ring, mirror/,
    ],
    [
      'an unknown variation',
      broken((s) => ((s.levels[0].variations[0] as { kind: string }).kind = 'blur')),
      /^levels\[sq1\]\.variations\[0\]\.kind: must be one of linear/,
    ],
    [
      'an orbit trap without its size',
      broken((s) => ((s.palette as { trap?: unknown }).trap = { weight: { value: 1 } })),
      /^palette\.trap\.size: is missing/,
    ],
    [
      'an orbit trap off its range',
      broken((s) => (s.palette.trap = { weight: { value: 9 }, size: { value: 0 } })),
      /^palette\.trap\.weight\.value: 9 is outside -4 to 4/,
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
      'a shape of no kind',
      broken((s) => ((s.levels[0].variants[0].shape as { kind?: string }).kind = 'blob')),
      /^levels\[sq1\]\.variants\[0\]\.shape\.kind: must be one of star, box/,
    ],
    [
      'a kind without its form',
      broken((s) => (s.levels[0].variants[0].shape.kind = 'box')),
      /^levels\[sq1\]\.variants\[0\]\.shape\.form: is missing for a box/,
    ],
    [
      'a star with a form',
      broken((s) => (s.levels[0].variants[0].shape.form = { value: 0.5 })),
      /^levels\[sq1\]\.variants\[0\]\.shape\.form: is not a field of a star/,
    ],
    [
      'a heart with a form',
      broken((s) => Object.assign(s.levels[0].variants[0].shape, { kind: 'heart', form: { value: 0.5 } })),
      /^levels\[sq1\]\.variants\[0\]\.shape\.form: is not a field of a heart/,
    ],
    [
      'a join inside a join',
      broken((s) => {
        const inner = join(star(5, 2, 0.2), [0, 0], 0.1)
        s.levels[0].variants[0].shape.join = join({ ...star(5, 2, 0.2), join: inner }, [0, 0], 0.1)
      }),
      /^levels\[sq1\]\.variants\[0\]\.shape\.join\.shape\.join: is not a field/,
    ],
    [
      'an onion on a joined shape',
      broken((s) => (s.levels[0].variants[0].shape.join = join(star(5, 2, 0.2, { onion: 0.1 }), [0, 0], 0.1))),
      /^levels\[sq1\]\.variants\[0\]\.shape\.join\.shape\.onion: is not a field/,
    ],
    [
      'a join blend off its range',
      broken((s) => (s.levels[0].variants[0].shape.join = join(star(5, 2, 0.2), [0, 0], 0.9))),
      /^levels\[sq1\]\.variants\[0\]\.shape\.join\.blend\.value: 0\.9 is outside 0 to 0\.5/,
    ],
    [
      'a spill off its range',
      broken((s) => (s.levels[0].cell.spill = { value: 2 })),
      /^levels\[sq1\]\.cell\.spill\.value: 2 is outside 0 to 1/,
    ],
    [
      'a spill on a polar lattice',
      broken((s) => {
        Object.assign(s.levels[0].lattice, { kind: 'polar', sectors: 6 })
        s.levels[0].cell.spill = { value: 1 }
      }),
      /^levels\[sq1\]\.cell\.spill: is not for a polar lattice/,
    ],
    ['a dotted line without its dots', broken((s) => (s.line.kind = 'dots')), /^line\.dots: is missing for dotted/],
    [
      'a dot count off its range',
      broken((s) => (s.line.dots = { count: { value: 0 }, size: { value: 0 }, crawl: { value: 0 } })),
      /^line\.dots\.count\.value: 0 is outside 1 to 64/,
    ],
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
