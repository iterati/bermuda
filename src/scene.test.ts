import { describe, expect, it } from 'vitest'
import { background, BANK, fill, halftone, join, level, LOOKS, mod, scene, shape, star } from './looks'
import { capturePreset } from './motion'
import {
  BACKGROUNDS,
  CELLS,
  chipKnobs,
  fielded,
  FIELDS,
  folded,
  FEATURES,
  FORMLESS,
  GRIDS,
  hardRange,
  KINDS,
  kindOf,
  knobsOf,
  LINES,
  LISTENS,
  liveKnob,
  notch,
  parseBank,
  parseControls,
  parseFader,
  parseScene,
  resolve,
  SHAPES,
  strip,
  type Address,
  type Controls,
  VARIATIONS,
  type Bank,
  type Fader,
  type Fill,
  type Scene,
} from './scene'

// a colour field at its + colour field values
const field = (): NonNullable<Scene['palette']['field']> => ({
  kind: 'radial',
  angle: { value: 0 },
  centre: [{ value: 0 }, { value: 0 }],
  scale: { value: 1 },
  depth: { value: 0.25 },
})
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
    const look = structuredClone(LOOKS.find((l) => l.name.startsWith('Tapestry 7 '))!)
    look.presets.push(capturePreset(look, 'all of it'))
    look.loop = { seconds: 60 }
    expect(parseScene(JSON.stringify(look))).toEqual(look)
  })

  it('round-trips driven by music: a modulator on the beats and one on each feature, a macro on each', () => {
    const look = structuredClone(LOOKS[2])
    look.modulators = LISTENS.map((listen, i) =>
      mod(`m${i}`, 'steps', 4, [['frame.zoom', 0.1]], { steps: [0, 1], listen }),
    )
    look.macros = FEATURES.map((listen, i) => ({
      id: `x${i}`,
      name: listen,
      value: 0.5,
      listen,
      targets: [{ knob: 'palette.hue', from: -20, to: 20 }],
    }))
    const back = parseScene(JSON.stringify(look))
    expect(back).toEqual(look)
    expect(back.modulators.map((m) => m.listen)).toEqual([...LISTENS])
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

  // the cell steps and the variations after milestone 1's, under an orbit trap
  it.each(CELLS.slice(3))('round-trips a level by %s, every variation and an orbit trap', (by) => {
    const look = scene({
      name: by,
      levels: [
        level('a', { by, cellTurn: 20, cellPhase: 0.3, vary: VARIATIONS.slice(8).map((kind, i) => [kind, i / 40]) }),
      ],
      trap: { weight: { value: 2, play: [1, 3] }, size: 0.2 },
    })
    expect(parseScene(JSON.stringify(look))).toEqual(look)
    expect(resolve(look, 'palette.trap.size')?.value).toBe(0.2)
  })

  // flat with a ramp, bands, metal and outline over a fill, in front order on a spilled brick lattice
  it('round-trips a fill of each mode with front order, and a palette field of each kind with steps and at cells', () => {
    const modes = [
      fill({ ramp: 0.2 }),
      fill({ bands: { value: 8, play: [4, 12] }, step: 0.25, front: true }),
      fill({ bands: 10, step: 0.08, metal: 1, shade: 0.45, light: 115 }),
      fill({ line: 1, tone: 0.5, alternate: -0.3 }),
    ]
    for (const kind of FIELDS) {
      const look = scene({
        name: kind,
        levels: modes.map((f, i) =>
          level(`l${i}`, { lattice: 'brick', e2: [0.5, 0.5], spill: 1, shape: star(6, 2, 0.5), fill: f }),
        ),
        field: {
          kind,
          angle: { value: 25 },
          centre: [{ value: 1.2 }, { value: -0.4 }],
          scale: { value: 0.7 },
          depth: { value: 0.5, spread: 0.1 },
          steps: 4,
          atCells: true,
        },
        modulators: [mod('sun', 'cos', 32, [['levels[l2].fill.light', 40]])],
      })
      expect(parseScene(JSON.stringify(look))).toEqual(look)
      expect(resolve(look, 'levels[l1].fill.bands')?.value).toBe(8)
      expect(kindOf('palette.field.centre[1]')).toBe('palette.field.centre[1]')
    }
  })

  it("round-trips a halftone on each grid, and on a linked level's leader", () => {
    const look = scene({
      name: 'dots',
      levels: [
        ...GRIDS.map((grid, i) =>
          level(`h${i}`, { halftone: halftone({ grid, pitch: { value: 40, play: [20, 60] }, turn: 15, reach: 0.05 }) }),
        ),
        level('lead', { halftone: halftone({ amount: { value: 0, spread: 4 }, grid: 'hex', fade: 1 }) }),
        level('follow', {
          link: 'lead',
          halftone: halftone({ amount: { value: 0, spread: 4 }, grid: 'hex', fade: 1 }),
        }),
      ],
      modulators: [mod('press', 'cos', 16, [['levels[h0].halftone.size', 0.2]])],
    })
    expect(parseScene(JSON.stringify(look))).toEqual(look)
    expect(look.levels.map((l) => l.halftone!.grid)).toEqual([...GRIDS, 'hex', 'hex'])
    expect(resolve(look, 'levels[h1].halftone.pitch')?.value).toBe(40)
    expect(kindOf('levels[lead].halftone.turn')).toBe('levels[].halftone.turn')
  })

  it('names every knob by a path through level ids, sub-chains included', () => {
    const quilt = LOOKS.find((l) => l.name.includes('Patchwork'))!
    const addresses = knobsOf(quilt).map((k) => k.address)
    expect(addresses).toContain('levels[patch].variants[1].below[tris].affine.scale')
    expect(resolve(quilt, 'levels[patch].variants[1].below[tris].affine.scale')).toBe(
      quilt.levels[0].variants[1].below![0].affine.scale,
    )
    expect(kindOf('levels[patch].variants[1].below[tris].affine.offset[1]')).toBe('levels[].affine.offset[1]')
    for (const a of addresses) expect(resolve(quilt, a)).toBeDefined()
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

  it('every kind with a show rule says in one line why it is off', () => {
    const ruled = Object.entries(KINDS).filter(([, kind]) => kind.shows)
    expect(ruled.length).toBe(31)
    for (const [key, { off }] of ruled) {
      expect(off, key).toMatch(/^[a-z]/)
      expect(off, key).not.toMatch(/[\n—]/)
      expect(off!.length, key).toBeLessThanOrEqual(64)
    }
    // and a kind that is never dead has none
    expect(Object.entries(KINDS).filter(([, kind]) => !kind.shows && kind.off)).toEqual([])
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

  it("shows the fill's knobs once fill can rise, step once bands can, light and shade once metal can", () => {
    const at = ['amount', 'line', 'tone', 'bands', 'step', 'metal', 'light', 'shade', 'ramp', 'alternate']
    const showing = (o: Parameters<typeof fill>[0], more: Partial<Parameters<typeof scene>[0]> = {}) =>
      at.filter((k) =>
        shows(scene({ name: 'f', levels: [level('a', { fill: fill(o) })], ...more }), `levels[a].fill.${k}`),
      )
    expect(showing({ amount: 0 })).toEqual(['amount', 'line'])
    expect(showing({})).toEqual(['amount', 'line', 'tone', 'bands', 'metal', 'ramp', 'alternate'])
    expect(showing({ amount: { value: 0, spread: 1 }, bands: 4 })).toContain('step')
    expect(showing({ amount: { value: 0, play: [0, 1] }, metal: 1 })).toEqual(at.filter((k) => k !== 'step'))
    const driven = (knob: string) => [mod('m', 'cos', 8, [[`levels[a].fill.${knob}`, 1]])]
    expect(showing({ amount: 0 }, { modulators: driven('amount') })).toContain('tone')
    const macros = [{ id: 'x', name: 'x', value: 0, targets: [{ knob: 'levels[a].fill.metal', from: 0, to: 1 }] }]
    expect(showing({}, { macros })).toEqual(at.filter((k) => k !== 'step'))
    expect(showing({ bands: 0 }, { modulators: driven('bands') })).toContain('step')
  })

  it("shows the halftone's knobs once amount can rise, turn on screens only, and the screen's pitch and turn on the first screened level alone", () => {
    const at = ['amount', 'pitch', 'size', 'fade', 'turn', 'reach']
    const showing = (s: Scene, level: Address) => at.filter((k) => shows(s, `${level}.halftone.${k}`))
    const one = (o: Parameters<typeof halftone>[0], more: Partial<Parameters<typeof scene>[0]> = {}) =>
      showing(scene({ name: 'h', levels: [level('a', { halftone: halftone(o) })], ...more }), 'levels[a]')
    expect(one({ amount: 0 })).toEqual(['amount'])
    expect(one({})).toEqual(at.filter((k) => k !== 'turn'))
    expect(one({ grid: 'square' })).toEqual(at)
    expect(one({ amount: 0, grid: 'hex' })).toEqual(['amount'])
    expect(one({ amount: { value: 0, spread: 4 }, grid: 'hex' })).toEqual(at)
    expect(one({ amount: { value: 0, play: [0, 1] } })).toEqual(at.filter((k) => k !== 'turn'))
    const driven = [mod('m', 'cos', 8, [['levels[a].halftone.amount', 0.5]])]
    expect(one({ amount: 0 }, { modulators: driven })).toEqual(at.filter((k) => k !== 'turn'))
    const macros = [{ id: 'x', name: 'x', value: 0, targets: [{ knob: 'levels[a].halftone.amount', from: 0, to: 1 }] }]
    expect(one({ amount: 0, grid: 'square' }, { macros })).toEqual(at)
    // one screen a picture: the first screened level's, a sub-chain's after its parent, so a later one's pitch and
    // turn are dead, while a lattice level keeps its own pitch
    const below = level('c', { halftone: halftone({ grid: 'square' }) })
    const three = scene({
      name: 'three',
      levels: [
        level('a', { halftone: halftone(), variants: [{ share: 1, shape: star(6, 2, 0.4), below: [below] }] }),
        level('b', { halftone: halftone({ grid: 'hex' }) }),
      ],
    })
    const [a, c, b] = ['levels[a]', 'levels[a].variants[0].below[c]', 'levels[b]'].map((l) => showing(three, l))
    expect([a, c, b]).toEqual([at.filter((k) => k !== 'turn'), at, ['amount', 'size', 'fade', 'reach']])
    // the first screened level sets the screen at amount 0 too, so its pitch and turn show while a later one draws
    const first = scene({
      name: 'first',
      levels: [
        level('x', { halftone: halftone({ amount: 0, grid: 'hex' }) }),
        level('y', { halftone: halftone({ grid: 'square' }) }),
      ],
    })
    expect(['levels[x]', 'levels[y]'].map((l) => showing(first, l))).toEqual([
      ['amount', 'pitch', 'turn'],
      ['amount', 'size', 'fade', 'reach'],
    ])
  })

  it("shows the field's kind and centre once depth or radius can move, its angle on linear and its scale on noise", () => {
    const at = ['depth', 'centre[0]', 'centre[1]', 'angle', 'scale'].map((k) => `palette.field.${k}`)
    const showing = (kind: (typeof FIELDS)[number], depth: number, more: Partial<Parameters<typeof scene>[0]> = {}) => {
      const s = scene({
        name: kind,
        levels: [level('a')],
        radius: 0,
        field: {
          kind,
          angle: { value: 0 },
          centre: [{ value: 0 }, { value: 0 }],
          scale: { value: 1 },
          depth: { value: depth },
        },
        ...more,
      })
      return [fielded(s), ...at.filter((a) => shows(s, a))]
    }
    expect(showing('radial', 0)).toEqual([false, 'palette.field.depth'])
    expect(showing('radial', -0.25)).toEqual([true, ...at.slice(0, 3)])
    expect(showing('radial', 0, { radius: 0.4 })).toEqual([true, ...at.slice(0, 3)])
    expect(showing('linear', 0.25)).toEqual([true, ...at.slice(0, 4)])
    expect(showing('noise', 0.25)).toEqual([true, ...at.slice(0, 3), 'palette.field.scale'])
    expect(showing('noise', 0, { modulators: [mod('m', 'cos', 8, [['palette.field.depth', 0.2]])] })).toEqual([
      true,
      ...at.slice(0, 3),
      'palette.field.scale',
    ])
    expect(showing('linear', 0, { radius: { value: 0, play: [-0.5, 0] } })).toEqual([true, ...at.slice(0, 4)])
  })

  it('shows the dots knobs only on a dotted line, though they stay when the kind moves on', () => {
    const dots = { count: 8, size: 0.3, crawl: 1 }
    for (const at of ['line.dots.count', 'line.dots.size', 'line.dots.crawl']) {
      expect(shows(scene({ name: 'dots', levels: [level('a')], line: 'dots', dots }), at)).toBe(true)
      expect(shows(scene({ name: 'glow', levels: [level('a')], line: 'glow', dots }), at)).toBe(false)
    }
  })
})

describe('the Perform strip', () => {
  const t1 = LOOKS.find((l) => l.name.startsWith('Tapestry 1 '))!

  it("runs a look's macros in order, then the picked chip's top knobs that show", () => {
    const sq1 = [
      { macro: 'breathe' },
      { macro: 'size' },
      { macro: 'gain' },
      { macro: 'music-tone' },
      ...[
        'affine.scale',
        'affine.turn',
        'lattice.e2[0]',
        'lattice.e2[1]',
        'variants[0].shape.m',
        'variants[0].shape.r',
        'variants[0].shape.round',
        'colour.at',
      ].map((k) => ({ knob: `levels[sq1].${k}` })),
    ]
    expect(strip(t1, 'sq1')).toEqual(sq1)
    // a linked level plays its leader's knobs
    expect(strip(t1, 'sq2')).toEqual(sq1)
    expect(strip(t1, 'post')).toEqual(sq1.slice(0, 4))
  })

  it("leaves out a top knob its show rule says is dead, and takes a sub-chain level's own", () => {
    const quilt = LOOKS.find((l) => l.name === 'Patchwork quilt')!
    expect(chipKnobs(quilt, 'tris').every((k) => k.address.startsWith('levels[patch].variants[1].below[tris].'))).toBe(
      true,
    )
    // the triangles are stars, so their m shows; a box has none
    expect(strip(quilt, 'tris')).toContainEqual({ knob: 'levels[patch].variants[1].below[tris].variants[0].shape.m' })
    const boxed = structuredClone(t1)
    boxed.levels[0].variants[0].shape.kind = 'box'
    expect(strip(boxed, 'sq1')).not.toContainEqual({ knob: 'levels[sq1].variants[0].shape.m' })
  })
})

describe('folding', () => {
  const t1 = LOOKS.find((l) => l.name.startsWith('Tapestry 1 '))!
  const foldedOf = (s: Scene, chip: string) =>
    chipKnobs(s, chip)
      .filter((k) => folded(s, k))
      .map((k) => k.address)

  it("folds Tapestry 1's dead knobs and its untouched knobs at rest", () => {
    expect(foldedOf(t1, 'sq1')).toEqual(
      [
        'weight',
        'affine.offset[0]',
        'affine.offset[1]',
        'cell.turn',
        'cell.phase',
        'variants[0].share',
        'colour.cellSpread',
      ].map((k) => `levels[sq1].${k}`),
    )
    expect(foldedOf(t1, 'frame')).toEqual(['frame.origin[0]', 'frame.origin[1]', 'frame.turn'])
    expect(foldedOf(t1, 'palette')).toEqual(['palette.contrast', 'palette.radius'])
  })

  it('keeps a knob at rest that a modulator, a spread, a play range, a preset or a MIDI control touches', () => {
    const address = 'levels[sq1].weight'
    const at = (s: Scene) =>
      folded(
        s,
        knobsOf(s).find((k) => k.address === address)!,
      )
    expect(at(t1)).toBe(true)
    const touched: ((s: Scene) => void)[] = [
      (s) => s.modulators.push(mod('m', 'cos', 8, [[address, 0.2]])),
      (s) => s.macros.push({ id: 'x', name: 'x', value: 0, targets: [{ knob: address, from: 0, to: 1 }] }),
      (s) => (s.levels[0].weight.spread = 0.2),
      (s) => (s.levels[0].weight.play = [0.5, 1]),
      (s) => (s.levels[0].weight.glide = 2),
      (s) => s.presets.push({ name: 'p', values: { [address]: 0.5 } }),
      (s) => (s.midi = [{ channel: 1, control: 1, knob: address }]),
    ]
    for (const touch of touched) {
      const s = structuredClone(t1)
      touch(s)
      expect(at(s)).toBe(false)
    }
  })

  it("folds a hard line's falloff", () => {
    const falloff = (s: Scene) =>
      folded(
        s,
        knobsOf(s).find((k) => k.address === 'line.falloff')!,
      )
    expect(falloff(t1)).toBe(false)
    expect(falloff({ ...t1, line: { ...t1.line, kind: 'hard' } })).toBe(true)
  })
})

describe('the notch', () => {
  const t1 = LOOKS.find((l) => l.name.startsWith('Tapestry 1 '))!
  const turn = 'levels[sq1].affine.turn'

  it('a notch is 1/40 of the play range', () => {
    const s = structuredClone(t1)
    s.levels[0].affine.turn.play = [10, 90]
    expect(notch(s, { knob: turn })).toBe(2)
    // every knob a look plays inside a range
    for (const { address, knob } of knobsOf(t1).filter((k) => k.knob.play))
      expect(notch(t1, { knob: address })).toBeCloseTo((knob.play![1] - knob.play![0]) / 40, 12)
  })

  it('a notch is 1% of the hard range without a play range or with an empty one, and of 0 to 1 for a macro', () => {
    const [lo, hi] = hardRange(turn)
    const s = structuredClone(t1)
    delete s.levels[0].affine.turn.play
    expect(notch(s, { knob: turn })).toBeCloseTo((hi - lo) / 100, 12)
    s.levels[0].affine.turn.play = [30, 30]
    expect(notch(s, { knob: turn })).toBeCloseTo((hi - lo) / 100, 12)
    expect(notch(t1, { macro: t1.macros[0].id })).toBe(0.01)
  })
})

describe('a live knob', () => {
  const t1 = LOOKS.find((l) => l.name.startsWith('Tapestry 1 '))!
  const none = new Set<Address>()
  const liveOf = (s: Scene, chip: string, turned = none) =>
    knobsOf(s)
      .filter((k) => liveKnob(s, k, strip(s, chip), turned))
      .map((k) => k.address)
  const played = (s: Scene) =>
    knobsOf(s)
      .filter((k) => liveKnob(s, k, [], none))
      .map((k) => k.address)

  it("a knob is live when played, on the picked chip's strip, or turned since its look was put", () => {
    // Tapestry 1 plays 16 knobs, as the design round counted them; its first level's strip adds the top knobs it does
    // not play
    expect(played(t1)).toHaveLength(16)
    const onStrip = strip(t1, 'sq1').flatMap((t) => ('knob' in t ? [t.knob] : []))
    expect(liveOf(t1, 'sq1')).toEqual(
      knobsOf(t1)
        .filter((k) => played(t1).includes(k.address) || onStrip.includes(k.address))
        .map((k) => k.address),
    )
    expect(liveOf(t1, 'sq1')).toHaveLength(20)
    // a knob off the strip, unplayed, is live once turned
    const address = 'levels[sq1].weight'
    expect(liveOf(t1, 'post')).not.toContain(address)
    expect(liveOf(t1, 'post', new Set([address]))).toContain(address)
    // and once played, by any of the ways a look plays a knob
    const plays: ((s: Scene) => void)[] = [
      (s) => s.modulators.push(mod('m', 'cos', 8, [[address, 0.2]])),
      (s) => s.macros.push({ id: 'x', name: 'x', value: 0, targets: [{ knob: address, from: 0, to: 1 }] }),
      (s) => (s.levels[0].weight.spread = 0.2),
      (s) => (s.levels[0].weight.play = [0.5, 1]),
      (s) => (s.levels[0].weight.glide = 2),
      (s) => (s.midi = [{ channel: 1, control: 1, knob: address }]),
    ]
    for (const play of plays) {
      const s = structuredClone(t1)
      play(s)
      expect(liveOf(s, 'post')).toContain(address)
    }
  })

  it('a dead knob is never live, and an unplayed untouched one off the strip is not', () => {
    // Tapestry 1's 4 dead knobs, one of them its first level's share of its one variant
    const dead = knobsOf(t1).filter((k) => {
      const kind = KINDS[kindOf(k.address)]
      return kind.shows && !kind.shows(t1, k)
    })
    expect(dead).toHaveLength(4)
    const share = 'levels[sq1].variants[0].share'
    expect(dead.map((k) => k.address)).toContain(share)
    const s = structuredClone(t1)
    s.levels[0].variants[0].share.play = [0.2, 0.8]
    s.modulators.push(mod('m', 'cos', 8, [[share, 0.2]]))
    const all = new Set(knobsOf(s).map((k) => k.address))
    for (const k of dead) expect(liveOf(s, 'sq1', all), k.address).not.toContain(k.address)
    // the rest of the knobs, neither played nor turned nor on the strip of the picked chip, are not live
    expect(liveOf(t1, 'post')).toEqual(played(t1))
    expect(liveOf(t1, 'post')).not.toContain('levels[sq1].colour.cellSpread')
    expect(liveOf(t1, 'frame')).not.toContain('levels[sq1].variants[0].shape.round')
  })
})

describe("the app's MIDI as JSON", () => {
  it('round-trips the strip and the page buttons, and loads with no strip', () => {
    const controls: Controls = {
      buttons: [
        { channel: 1, note: 8, page: 1 },
        { channel: 1, note: 9, page: -1 },
        { channel: 1, note: 10, slot: 2 },
      ],
      fader: { channel: 1, control: 9, pickup: true },
      strip: Array.from({ length: 8 }, (_, index) => ({ channel: 11, control: index + 1, index })),
    }
    expect(parseControls(JSON.stringify(controls))).toEqual(controls)
    expect(parseControls({ buttons: [] })).toEqual({ buttons: [] })
  })

  it.each([
    ['a page step of 2', { buttons: [{ channel: 1, note: 8, page: 2 }] }, /^buttons\[0\]\.page: must be one of 1, -1/],
    [
      'a button with a slot and a page',
      { buttons: [{ channel: 1, note: 8, slot: 0, page: 1 }] },
      /^buttons\[0\]: must name one slot, one mode or one page step/,
    ],
    [
      'a slot index of 8',
      { buttons: [], strip: [{ channel: 1, control: 1, index: 8 }] },
      /^strip\[0\]\.index: 8 is outside 0 to 7/,
    ],
    [
      'a CC on two slots',
      {
        buttons: [],
        strip: [
          { channel: 1, control: 1, index: 0 },
          { channel: 1, control: 1, index: 1 },
        ],
      },
      /^strip\[1\]: channel 1 number 1 is mapped twice/,
    ],
    [
      'a CC on the A/B fader and a slot',
      { buttons: [], fader: { channel: 1, control: 1 }, strip: [{ channel: 1, control: 1, index: 0 }] },
      /^strip\[0\]: channel 1 number 1 is mapped twice/,
    ],
    [
      'a slot with two CCs',
      {
        buttons: [],
        strip: [
          { channel: 1, control: 1, index: 3 },
          { channel: 1, control: 2, index: 3 },
        ],
      },
      /^strip\[1\]\.index: slot 3 is mapped twice/,
    ],
  ])('refuses %s', (_, controls, message) => {
    expect(() => parseControls(controls)).toThrow(message)
  })
})

describe('a background', () => {
  const tapestry1 = LOOKS.find((l) => l.name.startsWith('Tapestry 1 '))!

  it('round-trips on every built-in look that has one', () => {
    const backed = LOOKS.filter((l) => l.background)
    expect(backed.map((l) => l.name)).toContain('Soak stain')
    for (const look of backed) expect(parseScene(JSON.stringify(look))).toEqual(look)
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
    b: { ...structuredClone(LOOKS.find((l) => l.name.startsWith('Tapestry 7 '))!), loop: { seconds: 30 } },
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
      'a modulator listening to what is not heard',
      broken((s) => ((s.modulators[0] as { listen?: string }).listen = 'treble')),
      /^modulators\[0\]\.listen: must be one of beats, level, tone, drive, sub/,
    ],
    [
      'a macro listening to the beats',
      broken((s) => (s.macros = [{ id: 'x', name: 'x', value: 0, listen: 'beats' as 'tone', targets: [] }])),
      /^macros\[0\]\.listen: must be one of level, tone, drive, sub/,
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
    [
      'a fill with too many bands',
      broken((s) => (s.levels[0].fill = fill({ bands: 49 }))),
      /^levels\[sq1\]\.fill\.bands\.value: 49 is outside 0 to 48/,
    ],
    [
      'a fill with front false',
      broken((s) => (s.levels[0].fill = { ...fill(), front: false as unknown as true })),
      /^levels\[sq1\]\.fill\.front: must be true when given/,
    ],
    [
      'a fill missing a knob',
      broken((s) => {
        s.levels[0].fill = fill()
        delete (s.levels[0].fill as Partial<Fill>).ramp
      }),
      /^levels\[sq1\]\.fill\.ramp: is missing/,
    ],
    [
      'a halftone on an unknown grid',
      broken((s) => (s.levels[0].halftone = { ...halftone(), grid: 'dots' as 'hex' })),
      /^levels\[sq1\]\.halftone\.grid: must be one of lattice, square, hex/,
    ],
    [
      'a halftone of pitch 0',
      broken((s) => (s.levels[0].halftone = halftone({ pitch: 0 }))),
      /^levels\[sq1\]\.halftone\.pitch\.value: 0 is outside 1 to 160/,
    ],
    [
      'a halftone of size 1.3',
      broken((s) => (s.levels[0].halftone = halftone({ size: 1.3 }))),
      /^levels\[sq1\]\.halftone\.size\.value: 1\.3 is outside 0 to 1\.2/,
    ],
    [
      'a colour field of an unknown kind',
      broken((s) => (s.palette.field = { ...field(), kind: 'spiral' as 'radial' })),
      /^palette\.field\.kind: must be one of radial, linear, noise/,
    ],
    [
      'a colour field in fractional steps',
      broken((s) => (s.palette.field = { ...field(), steps: 1.5 })),
      /^palette\.field\.steps: must be a whole number/,
    ],
    [
      'a colour field in too many steps',
      broken((s) => (s.palette.field = { ...field(), steps: 17 })),
      /^palette\.field\.steps: 17 is outside 1 to 16/,
    ],
    [
      'a colour field at cells false',
      broken((s) => (s.palette.field = { ...field(), atCells: false as unknown as true })),
      /^palette\.field\.atCells: must be true when given/,
    ],
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
