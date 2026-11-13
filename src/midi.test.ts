import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prune, removeLevel } from './edit'
import { background, LOOKS } from './looks'
import {
  attach,
  drive,
  driveStrip,
  ECHO_MS,
  echoes,
  grids,
  HOLD_MS,
  hearsControl,
  keyOf,
  learn,
  learnStrip,
  learnTrigger,
  positionOf,
  release,
  takes,
  triggerOf,
  unmapControl,
  waiting,
  type Learning,
  type Message,
  type Pressed,
} from './midi'
import { setKnob, update } from './motion'
import {
  hardRange,
  parseScene,
  parseControls,
  resolve,
  strip,
  STRIP,
  type Controls,
  type Scene,
  type View,
} from './scene'

const squareToHex = () => structuredClone(LOOKS.find((l) => l.name === 'Remix - Square to hex')!)

// A fake MIDI access with one controller and a through port: send() delivers a message the way a plugged-in
// controller would, sent holds what the app sent the controller and through what it sent the through port.
function fakeController() {
  type Port = { name: string; state: string; onmidimessage: ((e: { data: Uint8Array; target: Port }) => void) | null }
  const input: Port = { name: 'Fake knobs', state: 'connected', onmidimessage: null }
  const loop: Port = { name: 'Midi Through', state: 'connected', onmidimessage: null }
  const sent: number[][] = []
  const through: number[][] = []
  const output = (name: string, into: number[][]) => ({ name, state: 'connected', send: (b: number[]) => into.push(b) })
  const access = {
    inputs: new Map([
      ['fake', input],
      ['through', loop],
    ]),
    outputs: new Map([
      ['fake', output('Fake knobs', sent)],
      ['through', output('Midi Through', through)],
    ]),
    onstatechange: null,
  }
  return {
    access: access as unknown as MIDIAccess,
    send: (...bytes: number[]) => input.onmidimessage?.({ data: new Uint8Array(bytes), target: input }),
    sent,
    through,
  }
}

// A fake MIDI access with the captain's two controllers plugged in at once, each an input and an output of its name:
// send.dj and send.xt deliver a message as each would, and sent.dj and sent.xt hold what the app sent each.
function fakePair() {
  type Port = { name: string; state: string; onmidimessage: ((e: { data: Uint8Array; target: Port }) => void) | null }
  const port = (name: string): Port => ({ name, state: 'connected', onmidimessage: null })
  const inputs = { dj: port('DJ2GO2'), xt: port('X-TOUCH MINI') }
  const sent = { dj: [] as number[][], xt: [] as number[][] }
  const output = (name: string, into: number[][]) => ({ name, state: 'connected', send: (b: number[]) => into.push(b) })
  const access = {
    inputs: new Map([
      ['dj', inputs.dj],
      ['xt', inputs.xt],
    ]),
    outputs: new Map([
      ['dj', output('DJ2GO2', sent.dj)],
      ['xt', output('X-TOUCH MINI', sent.xt)],
    ]),
    onstatechange: null,
  }
  const sender =
    (input: Port) =>
    (...bytes: number[]) =>
      input.onmidimessage?.({ data: new Uint8Array(bytes), target: input })
  return {
    access: access as unknown as MIDIAccess,
    send: { dj: sender(inputs.dj), xt: sender(inputs.xt) },
    sent,
  }
}

// The app's MIDI loop in small: a target learning takes the first control of its kind, a control drives what it
// maps to (the A/B fader's control first, then the strip's slot of the page showing on the chip picked), a button
// loads its slot, picks its mode or steps the strip's page, each note sent is kept for the pads, and the controller
// is sent the look.
// On another access (fakePair's), its own send and sent stand in for the ones returned.
function play(scene: Scene, chip = 'frame', other?: MIDIAccess) {
  const fake = fakeController()
  const { send, sent, through } = fake
  const access = other ?? fake.access
  const state = {
    scene,
    learning: null as Learning | null,
    controls: { buttons: [] } as Controls,
    fader: 0,
    mode: 'stage' as View,
    inputs: [] as string[],
    pressed: [] as Pressed[],
    chip,
    page: 0,
  }
  const pages = () => Math.max(1, Math.ceil(strip(state.scene, state.chip).length / STRIP))
  const slots = () => Array.from({ length: STRIP }, (_, i) => strip(state.scene, state.chip)[state.page * STRIP + i])
  const at = new Map<string, number>()
  const stop = attach(
    access,
    () =>
      echoes(
        state.scene,
        state.controls,
        state.fader,
        (t) =>
          'slot' in t ? LOOKS[t.slot]?.name === state.scene.name : 'page' in t ? pages() > 1 : t.mode === state.mode,
        slots(),
      ),
    {
      inputs: (names) => (state.inputs = names),
      message: (m: Message) => {
        const t = state.learning
        if (m.kind === 'note') {
          if (!state.pressed.some((x) => x.device === m.device && x.channel === m.channel && x.note === m.number))
            state.pressed.push({ device: m.device, channel: m.channel, note: m.number })
          if (t && ('slot' in t || 'mode' in t || 'page' in t)) {
            state.learning = null
            state.controls = { ...state.controls, buttons: learnTrigger(state.controls.buttons, t, m) }
            return
          }
          const trigger = triggerOf(state.controls.buttons, m)
          if (trigger && 'mode' in trigger) state.mode = trigger.mode
          else if (trigger && 'page' in trigger) state.page = (state.page + trigger.page + pages()) % pages()
          else if (trigger) state.scene = structuredClone(LOOKS[trigger.slot])
          return
        }
        const key = keyOf('cc', m.channel, m.number, m.device)
        const last = at.get(key)
        at.set(key, m.value)
        at.set(keyOf('cc', m.channel, m.number), m.value)
        const ab = state.controls.fader
        const onAb = ab && hearsControl(ab, m)
        if (t && 'fader' in t) {
          state.learning = null
          state.controls = {
            ...release(state.controls, m),
            fader: { channel: m.channel, control: m.number, pickup: true, device: m.device },
          }
        } else if (t && 'strip' in t) {
          if (state.controls.strip?.some((x) => hearsControl(x, m) && x.index < t.strip)) return
          state.learning = t.strip < STRIP - 1 ? { strip: t.strip + 1 } : null
          state.controls = learnStrip(state.controls, t.strip, m)
          state.scene = update(state.scene, (d) => unmapControl(d, m))
        } else if (t && ('knob' in t || 'macro' in t)) {
          state.learning = null
          state.controls = release(state.controls, m)
          state.scene = drive(
            update(state.scene, (d) => learn(d, t, m)),
            m,
          )
        } else if (onAb) {
          if (!ab.pickup || takes(state.fader, last, m.value)) state.fader = m.value
        } else state.scene = driveStrip(state.scene, state.controls, slots(), m) ?? drive(state.scene, m, last)
      },
    },
  )
  return { state, send, sent, through, stop, at }
}

describe('MIDI learn', () => {
  it('round-trips a look with knob, macro and fader mappings as JSON, and the buttons', () => {
    const look = squareToHex()
    look.midi = [
      { channel: 11, control: 1, knob: 'levels[nest1].affine.turn' },
      { channel: 16, control: 0, knob: 'palette.stops[1].lch[2]' },
      { channel: 11, control: 9, pickup: true, macro: 'lattice' },
    ]
    expect(parseScene(JSON.stringify(look))).toEqual(look)
    const controls: Controls = {
      buttons: [
        { channel: 11, note: 8, slot: 0 },
        { channel: 11, note: 9, mode: 'edit' },
        { channel: 11, note: 10, mode: 'decks' },
      ],
      fader: { channel: 11, control: 10, pickup: true },
    }
    expect(parseControls(JSON.stringify(controls))).toEqual(controls)
    expect(() => parseControls({ buttons: [{ channel: 11, note: 8 }] })).toThrow(
      /^buttons\[0\]: must name one slot, one mode or one page step/,
    )
  })

  it('maps a control to a knob, whose value lands inside its hard range at every position', () => {
    const address = 'levels[nest1].affine.turn'
    const { state, send } = play(squareToHex())
    expect(state.inputs).toEqual(['Fake knobs', 'Midi Through'])
    state.learning = { knob: address }
    send(0xba, 1, 64)
    expect(state.scene.midi).toEqual([{ channel: 11, control: 1, device: 'Fake knobs', knob: address }])
    const [lo, hi] = hardRange(address)
    for (const v of [0, 1, 64, 126, 127]) {
      send(0xba, 1, v)
      const value = resolve(state.scene, address)!.value
      expect(value).toBeGreaterThanOrEqual(lo)
      expect(value).toBeLessThanOrEqual(hi)
    }
    expect(resolve(state.scene, address)!.value).toBe(hi)
    send(0xba, 1, 0)
    expect(resolve(state.scene, address)!.value).toBe(lo)
    // the saved look keeps the mapping and every value the control left
    expect(parseScene(JSON.stringify(state.scene))).toEqual(state.scene)
  })

  it("drives a background's amount over 0 to 1", () => {
    const { state, send } = play({ ...squareToHex(), background: background('soak') })
    state.learning = { knob: 'background.amount' }
    send(0xb0, 7, 64)
    expect(state.scene.midi).toEqual([{ channel: 1, control: 7, device: 'Fake knobs', knob: 'background.amount' }])
    send(0xb0, 7, 0)
    expect(state.scene.background!.amount.value).toBe(0)
    send(0xb0, 7, 127)
    expect(state.scene.background!.amount.value).toBe(1)
    expect(parseScene(JSON.stringify(state.scene))).toEqual(state.scene)
  })

  it('keeps a knob with a play range to it, and lands its ends exactly', () => {
    const address = 'line.width'
    const scene = squareToHex()
    scene.line.width.play = [0.001, 0.2]
    const { state, send } = play(scene)
    state.learning = { knob: address }
    send(0xb3, 74, 127)
    expect(state.scene.midi).toEqual([{ channel: 4, control: 74, device: 'Fake knobs', knob: address }])
    expect(resolve(state.scene, address)!.value).toBe(0.2)
    send(0xb3, 74, 0)
    expect(resolve(state.scene, address)!.value).toBe(0.001)
  })

  it('maps a control to a macro, which moves its knobs', () => {
    const { state, send } = play(squareToHex())
    state.learning = { macro: 'lattice' }
    send(0xb0, 1, 127)
    expect(state.scene.macros[0].value).toBe(1)
    expect(resolve(state.scene, 'levels[base].lattice.e2[0]')!.value).toBe(0.5)
    send(0xb0, 1, 0)
    expect(state.scene.macros[0].value).toBe(0)
    expect(resolve(state.scene, 'levels[base].lattice.e2[0]')!.value).toBe(0)
  })

  it('moves a mapping when its control or its target learns again', () => {
    const { state, send } = play(squareToHex())
    state.learning = { knob: 'frame.zoom' }
    send(0xb0, 21, 10)
    state.learning = { knob: 'frame.turn' }
    send(0xb0, 21, 10)
    state.learning = { knob: 'frame.turn' }
    send(0xb0, 22, 10)
    expect(state.scene.midi).toEqual([{ channel: 1, control: 22, device: 'Fake knobs', knob: 'frame.turn' }])
  })

  it('learns only from the first control of a burst, and a knob only from a CC', () => {
    const { state, send } = play(squareToHex())
    state.learning = { knob: 'frame.zoom' }
    send(0x9a, 8, 127)
    expect(state.learning).toEqual({ knob: 'frame.zoom' })
    send(0xb0, 7, 10)
    send(0xb0, 39, 10)
    expect(state.scene.midi).toEqual([{ channel: 1, control: 7, device: 'Fake knobs', knob: 'frame.zoom' }])
  })

  it('drops a mapping whose knob or macro an edit took away', () => {
    const look = squareToHex()
    look.midi = [
      { channel: 1, control: 21, knob: 'levels[nest2].affine.turn' },
      { channel: 1, control: 22, knob: 'frame.zoom' },
      { channel: 1, control: 7, macro: 'lattice' },
    ]
    const next = update(look, (d) => {
      removeLevel(d, 'nest2')
      d.macros = []
      prune(d)
    })
    expect(next.midi).toEqual([{ channel: 1, control: 22, knob: 'frame.zoom' }])
  })

  it('leaves the look alone on a control that drives nothing, and on notes no button learned', () => {
    const scene = squareToHex()
    const { state, send } = play(scene)
    send(0xb0, 21, 100)
    send(0x90, 60, 100)
    expect(state.scene).toBe(scene)
  })
})

describe('a fader with pickup', () => {
  const faded = () => {
    const look = squareToHex()
    look.midi = [{ channel: 11, control: 9, pickup: true, knob: 'frame.zoom' }]
    return setKnob(look, 'frame.zoom', 0.1 + 7.9 * 0.5) // at the middle of its range
  }

  it('takes over only once it passes the value, and says it is waiting until then', () => {
    const { state, send, at } = play(faded())
    const map = state.scene.midi![0]
    expect(waiting(map, positionOf(state.scene, map), new Map())).toBe(true)
    send(0xba, 9, 10)
    send(0xba, 9, 40)
    expect(resolve(state.scene, 'frame.zoom')!.value).toBeCloseTo(4.05)
    expect(waiting(map, positionOf(state.scene, map), at)).toBe(true)
    // a fast move jumps past the middle: it takes over there
    send(0xba, 9, 80)
    expect(resolve(state.scene, 'frame.zoom')!.value).toBeCloseTo(0.1 + (7.9 * 80) / 127)
    expect(waiting(map, positionOf(state.scene, map), at)).toBe(false)
    send(0xba, 9, 20)
    expect(resolve(state.scene, 'frame.zoom')!.value).toBeCloseTo(0.1 + (7.9 * 20) / 127)
    // a look loaded under it moves the value: it waits again
    state.scene = setKnob(state.scene, 'frame.zoom', 6)
    send(0xba, 9, 25)
    expect(resolve(state.scene, 'frame.zoom')!.value).toBe(6)
  })

  it('stays picked up through fast moves at every position', () => {
    const { state, send } = play(faded())
    send(0xba, 9, 64)
    for (let v = 0; v <= 127; v += 3) {
      send(0xba, 9, v)
      expect(resolve(state.scene, 'frame.zoom')!.value).toBeCloseTo(0.1 + (7.9 * v) / 127)
    }
    for (let v = 127; v >= 0; v -= 5) {
      send(0xba, 9, v)
      expect(resolve(state.scene, 'frame.zoom')!.value).toBeCloseTo(0.1 + (7.9 * v) / 127)
    }
  })

  it('is never sent a value, as it cannot move', () => {
    expect(echoes(faded(), { buttons: [] }, 0, () => false, []).size).toBe(0)
  })

  it('learns onto the A/B fader, with pickup, ahead of any look mapping on its control', () => {
    const { state, send, at } = play(faded())
    state.fader = 0.5
    state.learning = { fader: true }
    send(0xba, 9, 0)
    expect(state.controls.fader).toEqual({ channel: 11, control: 9, pickup: true, device: 'Fake knobs' })
    expect(waiting(state.controls.fader!, state.fader, at)).toBe(true)
    send(0xba, 9, 50)
    expect(state.fader).toBe(0.5)
    send(0xba, 9, 70)
    expect(state.fader).toBe(70 / 127)
    send(0xba, 9, 127)
    expect(state.fader).toBe(1)
    // the look's mapping on the same control stays put while the A/B fader holds it
    expect(resolve(state.scene, 'frame.zoom')!.value).toBeCloseTo(4.05)
    // and a knob learning the control takes it from the A/B fader
    state.learning = { knob: 'frame.turn' }
    send(0xba, 9, 64)
    expect(state.controls.fader).toBeUndefined()
  })
})

describe('the controller shows the look', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const encoders = () => {
    const look = squareToHex()
    look.midi = [
      { channel: 11, control: 1, knob: 'frame.zoom' },
      { channel: 11, control: 2, macro: 'lattice' },
    ]
    return look
  }

  it("sends each encoder its knob's value on its own CC, once the controller is heard, and only when it changes", () => {
    const { state, send, sent, through, stop } = play(encoders())
    vi.advanceTimersByTime(ECHO_MS * 3)
    expect(sent).toEqual([])
    send(0xba, 64, 0) // any control of the controller, mapped or not
    vi.advanceTimersByTime(ECHO_MS)
    expect(sent).toEqual([
      [0xba, 1, Math.round(((1 - 0.1) / 7.9) * 127)],
      [0xba, 2, 64],
    ])
    vi.advanceTimersByTime(ECHO_MS * 3)
    expect(sent).toHaveLength(2)
    state.scene = setKnob(state.scene, 'frame.zoom', 8)
    vi.advanceTimersByTime(ECHO_MS)
    expect(sent.slice(2)).toEqual([[0xba, 1, 127]])
    // never to other ports, such as a through port that would play them back
    expect(through).toEqual([])
    stop()
  })

  it('sends the A/B fader its place on its CC only when an encoder, not a pickup fader, holds it', () => {
    const scene = squareToHex()
    const ab = { channel: 11, control: 2 }
    expect(echoes(scene, { buttons: [], fader: ab }, 0.5, () => false, [])).toEqual(
      new Map([['cc 11/2', [0xba, 2, 64]]]),
    )
    expect(echoes(scene, { buttons: [], fader: { ...ab, pickup: true } }, 0.5, () => false, []).size).toBe(0)
  })

  it('never sends an encoder back what its hand is turning', () => {
    const { send, sent, stop } = play(encoders())
    send(0xba, 64, 0)
    vi.advanceTimersByTime(ECHO_MS)
    sent.length = 0
    for (let v = 0; v < 100; v++) {
      send(0xba, 1, v)
      vi.advanceTimersByTime(5)
    }
    vi.advanceTimersByTime(HOLD_MS * 2)
    expect(sent).toEqual([])
    stop()
  })

  it('sends a knob moving on its own at most about 30 times a second', () => {
    const { state, send, sent, stop } = play(encoders())
    send(0xba, 64, 0)
    for (let i = 0; i < 200; i++) {
      state.scene = setKnob(state.scene, 'frame.zoom', 0.1 + (7.9 * i) / 200)
      vi.advanceTimersByTime(5)
    }
    expect(sent.filter(([, cc]) => cc === 1).length).toBeLessThanOrEqual(31)
    stop()
  })

  it("learns buttons as triggers, and lights each one's LED by its note while its slot or mode is on", () => {
    const { state, send, sent, stop } = play(encoders())
    state.learning = { slot: 0 }
    send(0x9a, 8, 127)
    state.learning = { mode: 'edit' }
    send(0x9a, 16, 127)
    expect(state.controls.buttons).toEqual([
      { channel: 11, note: 8, device: 'Fake knobs', slot: 0 },
      { channel: 11, note: 16, device: 'Fake knobs', mode: 'edit' },
    ])
    vi.advanceTimersByTime(ECHO_MS)
    expect(sent.filter(([status]) => status === 0x9a)).toEqual([
      [0x9a, 8, 0],
      [0x9a, 16, 0],
    ])
    sent.length = 0
    send(0x9a, 8, 127)
    send(0x9a, 16, 127)
    expect(state.scene.name).toBe(LOOKS[0].name)
    expect(state.mode).toBe('edit')
    vi.advanceTimersByTime(ECHO_MS)
    expect(sent.filter(([status]) => status === 0x9a)).toEqual([
      [0x9a, 8, 1],
      [0x9a, 16, 1],
    ])
    // a button pressed or let go that set its own LED is sent its state again, and a release triggers nothing
    sent.length = 0
    send(0x9a, 8, 127)
    vi.advanceTimersByTime(ECHO_MS)
    send(0x8a, 16, 0)
    vi.advanceTimersByTime(ECHO_MS)
    send(0x9a, 16, 0)
    vi.advanceTimersByTime(ECHO_MS)
    expect(sent).toEqual([
      [0x9a, 8, 1],
      [0x9a, 16, 1],
      [0x9a, 16, 1],
    ])
    expect(state.mode).toBe('edit')
    stop()
  })
})

describe('the Perform strip by MIDI', () => {
  const t1 = () => structuredClone(LOOKS.find((l) => l.name.startsWith('Tapestry 1 '))!)
  // eight encoders on channel 11, CC 1 to 8, on the strip's slots in turn
  const encoders = {
    buttons: [],
    strip: Array.from({ length: 8 }, (_, index) => ({ channel: 11, control: index + 1, index })),
  }
  const value = (s: Scene, address: string) => resolve(s, address)!.value
  const macro = (s: Scene, id: string) => s.macros.find((m) => m.id === id)!.value

  it("drives slot n of the page showing, and the new page's slot n after a page change", () => {
    const { state, send } = play(t1(), 'sq1')
    state.controls = encoders
    // page 1: Breathe, Size, Gain, tone, then scale, turn, shear and height
    send(0xba, 5, 127)
    expect(value(state.scene, 'levels[sq1].affine.scale')).toBe(2.25)
    send(0xba, 5, 0)
    expect(value(state.scene, 'levels[sq1].affine.scale')).toBe(1.25)
    // page 2: m, r, round and colour at, then four empty slots
    state.page = 1
    send(0xba, 1, 0)
    expect(value(state.scene, 'levels[sq1].variants[0].shape.m')).toBe(1.01)
    send(0xba, 2, 127)
    expect(value(state.scene, 'levels[sq1].variants[0].shape.r')).toBe(2)
    const before = state.scene
    send(0xba, 5, 64)
    expect(state.scene).toBe(before)
  })

  it('drives a macro slot over 0 to 1, moving its knobs', () => {
    const { state, send } = play(t1(), 'sq1')
    state.controls = encoders
    send(0xba, 1, 127)
    expect(macro(state.scene, 'breathe')).toBe(1)
    expect(value(state.scene, 'levels[sq1].affine.scale')).toBeCloseTo(1.75 * 1.25)
    send(0xba, 1, 0)
    expect(macro(state.scene, 'breathe')).toBe(0)
    expect(value(state.scene, 'levels[sq1].affine.scale')).toBeCloseTo(1.75 * 0.75)
  })

  it("learns 8 encoders in turn, slot 1 to 8, taking each from the look's mappings and the A/B fader", () => {
    const look = t1()
    look.midi = [{ channel: 11, control: 3, knob: 'frame.zoom' }]
    const { state, send } = play(look, 'sq1')
    state.controls = { buttons: [], fader: { channel: 11, control: 5, pickup: true } }
    state.learning = { strip: 0 }
    for (let cc = 1; cc <= 8; cc++) {
      expect(state.learning).toEqual({ strip: cc - 1 })
      // an encoder turned sends a burst: its second message learns nothing more
      send(0xba, cc, 60)
      send(0xba, cc, 61)
    }
    expect(state.learning).toBeNull()
    expect(state.controls).toEqual({
      buttons: [],
      strip: encoders.strip.map((x) => ({ ...x, device: 'Fake knobs' })),
    })
    expect(state.scene.midi).toEqual([])
    expect(parseControls(JSON.stringify(state.controls))).toEqual(state.controls)
  })

  it('wins over a look mapping on the same CC', () => {
    const look = t1()
    look.midi = [{ channel: 11, control: 1, knob: 'frame.zoom' }]
    const { state, send } = play(look, 'sq1')
    state.controls = encoders
    send(0xba, 1, 127)
    expect(macro(state.scene, 'breathe')).toBe(1)
    expect(value(state.scene, 'frame.zoom')).toBe(look.frame.zoom.value)
  })

  describe('on the controller', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
    })
    afterEach(() => {
      vi.useRealTimers()
    })
    const rings = (sent: number[][]) => new Map(sent.filter(([status]) => status === 0xba).map(([, cc, v]) => [cc, v]))

    it("sends each strip CC its slot's place, and the new places after a page change", () => {
      const { state, send, sent, stop } = play(t1(), 'sq1')
      state.controls = encoders
      send(0xba, 64, 0)
      vi.advanceTimersByTime(ECHO_MS)
      // the macros at 0.5, scale 1.75 in its play range 1.25 to 2.25, turn, shear and height at their places
      const place = (address: string) => {
        const [lo, hi] = hardRange(address)
        return Math.round(((value(state.scene, address) - lo) / (hi - lo)) * 127)
      }
      expect(rings(sent)).toEqual(
        new Map([
          [1, 64],
          [2, 64],
          [3, 64],
          [4, 64],
          [5, 64],
          [6, place('levels[sq1].affine.turn')],
          [7, place('levels[sq1].lattice.e2[0]')],
          [8, place('levels[sq1].lattice.e2[1]')],
        ]),
      )
      // a ring already showing its new place is not sent it again
      state.page = 1
      vi.advanceTimersByTime(ECHO_MS)
      expect(rings(sent)).toEqual(
        new Map([
          [1, place('levels[sq1].variants[0].shape.m')],
          [2, place('levels[sq1].variants[0].shape.r')],
          [3, place('levels[sq1].variants[0].shape.round')],
          [4, place('levels[sq1].colour.at')],
          [5, 0],
          [6, 0],
          [7, 0],
          [8, 0],
        ]),
      )
      stop()
    })

    it('steps the page by a learned button, its LED lit while the strip has more than one page', () => {
      const { state, send, sent, stop } = play(t1(), 'sq1')
      state.controls = encoders
      state.learning = { page: 1 }
      send(0x9a, 8, 127)
      state.learning = { page: -1 }
      send(0x9a, 9, 127)
      expect(state.controls.buttons).toEqual([
        { channel: 11, note: 8, device: 'Fake knobs', page: 1 },
        { channel: 11, note: 9, device: 'Fake knobs', page: -1 },
      ])
      send(0x9a, 8, 127)
      expect(state.page).toBe(1)
      // round from the last page to the first, and back
      send(0x9a, 8, 127)
      expect(state.page).toBe(0)
      send(0x9a, 9, 127)
      expect(state.page).toBe(1)
      vi.advanceTimersByTime(ECHO_MS)
      expect(sent.filter(([status]) => status === 0x9a)).toEqual([
        [0x9a, 8, 1],
        [0x9a, 9, 1],
      ])
      // the post chip's strip is the macros alone, one page
      sent.length = 0
      state.chip = 'post'
      state.page = 0
      vi.advanceTimersByTime(ECHO_MS)
      expect(sent.filter(([status]) => status === 0x9a)).toEqual([
        [0x9a, 8, 0],
        [0x9a, 9, 0],
      ])
      stop()
    })
  })
})

// The captain's rig: a Numark DJ2GO2 and a Behringer X-Touch Mini plugged in at once, each its own input and output.
describe('two controllers at once', () => {
  const at = (s: Scene, address: string) => positionOf(s, { knob: address })
  // a control learned on one controller: the target learning takes the next control moved
  const learned = (state: ReturnType<typeof play>['state'], t: Learning, send: () => void) => {
    state.learning = t
    send()
  }

  it('drives two different knobs by the same CC on each, and a learn on one leaves the other its mapping', () => {
    const { access, send } = fakePair()
    const { state } = play(squareToHex(), 'frame', access)
    expect(state.inputs).toEqual(['DJ2GO2', 'X-TOUCH MINI'])
    learned(state, { knob: 'frame.zoom' }, () => send.dj(0xb0, 1, 0))
    learned(state, { knob: 'frame.turn' }, () => send.xt(0xb0, 1, 0))
    expect(state.scene.midi).toEqual([
      { channel: 1, control: 1, device: 'DJ2GO2', knob: 'frame.zoom' },
      { channel: 1, control: 1, device: 'X-TOUCH MINI', knob: 'frame.turn' },
    ])
    send.dj(0xb0, 1, 127)
    expect([at(state.scene, 'frame.zoom'), at(state.scene, 'frame.turn')]).toEqual([1, 0])
    send.xt(0xb0, 1, 127)
    send.dj(0xb0, 1, 0)
    expect([at(state.scene, 'frame.zoom'), at(state.scene, 'frame.turn')]).toEqual([0, 1])
    // the A/B fader and the strip are each controller's own too
    learned(state, { fader: true }, () => send.xt(0xb0, 9, 0))
    learned(state, { strip: 0 }, () => send.dj(0xb0, 9, 0))
    expect(state.controls).toEqual({
      buttons: [],
      fader: { channel: 1, control: 9, pickup: true, device: 'X-TOUCH MINI' },
      strip: [{ channel: 1, control: 9, index: 0, device: 'DJ2GO2' }],
    })
    // a target learning again on one controller takes a control there too, the other's mapping of it staying
    learned(state, { knob: 'frame.zoom' }, () => send.xt(0xb0, 2, 0))
    expect(state.scene.midi).toEqual([
      { channel: 1, control: 1, device: 'DJ2GO2', knob: 'frame.zoom' },
      { channel: 1, control: 1, device: 'X-TOUCH MINI', knob: 'frame.turn' },
      { channel: 1, control: 2, device: 'X-TOUCH MINI', knob: 'frame.zoom' },
    ])
    send.dj(0xb0, 1, 127)
    expect(at(state.scene, 'frame.zoom')).toBe(1)
    send.xt(0xb0, 2, 0)
    expect(at(state.scene, 'frame.zoom')).toBe(0)
    // and again on the same one moves it there
    learned(state, { knob: 'frame.zoom' }, () => send.xt(0xb0, 3, 0))
    expect(state.scene.midi!.filter((x) => 'knob' in x && x.knob === 'frame.zoom')).toEqual([
      { channel: 1, control: 1, device: 'DJ2GO2', knob: 'frame.zoom' },
      { channel: 1, control: 3, device: 'X-TOUCH MINI', knob: 'frame.zoom' },
    ])
  })

  it("learns each controller's buttons on the same note apart, each pressing its own", () => {
    const { access, send } = fakePair()
    const { state } = play(squareToHex(), 'frame', access)
    learned(state, { slot: 2 }, () => send.dj(0x90, 8, 127))
    learned(state, { mode: 'edit' }, () => send.xt(0x90, 8, 127))
    expect(state.controls.buttons).toEqual([
      { channel: 1, note: 8, device: 'DJ2GO2', slot: 2 },
      { channel: 1, note: 8, device: 'X-TOUCH MINI', mode: 'edit' },
    ])
    send.xt(0x90, 8, 127)
    expect([state.mode, state.scene.name]).toEqual(['edit', squareToHex().name])
    send.dj(0x90, 8, 127)
    expect(state.scene.name).toBe(LOOKS[2].name)
  })

  it("hears a mapping with no device, an older look's, on either controller, until a learn gives it one", () => {
    const old = squareToHex()
    old.midi = [{ channel: 1, control: 5, knob: 'frame.zoom' }]
    const { access, send } = fakePair()
    const { state } = play(parseScene(JSON.stringify(old)), 'frame', access)
    state.controls = parseControls({ buttons: [{ channel: 1, note: 8, mode: 'decks' }] })
    send.dj(0xb0, 5, 127)
    expect(at(state.scene, 'frame.zoom')).toBe(1)
    send.xt(0xb0, 5, 0)
    expect(at(state.scene, 'frame.zoom')).toBe(0)
    send.dj(0x90, 8, 127)
    expect(state.mode).toBe('decks')
    state.mode = 'stage'
    send.xt(0x90, 8, 127)
    expect(state.mode).toBe('decks')
    // learned again, it is the X-Touch's alone
    learned(state, { knob: 'frame.zoom' }, () => send.xt(0xb0, 5, 64))
    expect(state.scene.midi).toEqual([{ channel: 1, control: 5, device: 'X-TOUCH MINI', knob: 'frame.zoom' }])
    send.dj(0xb0, 5, 127)
    expect(at(state.scene, 'frame.zoom')).toBeCloseTo(64 / 127)
  })

  describe('on the controllers', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it("sends each mapping's value and each button's LED back only to its own controller", () => {
      const look = squareToHex()
      look.midi = [
        { channel: 1, control: 1, device: 'DJ2GO2', knob: 'frame.zoom' },
        { channel: 1, control: 1, device: 'X-TOUCH MINI', knob: 'frame.turn' },
      ]
      const { access, send, sent } = fakePair()
      const { state, stop } = play(setKnob(setKnob(look, 'frame.zoom', 8), 'frame.turn', 0), 'frame', access)
      state.controls = { buttons: [{ channel: 1, note: 8, device: 'X-TOUCH MINI', mode: 'stage' }] }
      vi.advanceTimersByTime(ECHO_MS)
      // a controller's own mappings go to it before it is heard from
      expect(sent.dj).toEqual([[0xb0, 1, 127]])
      const turn = Math.round(at(state.scene, 'frame.turn') * 127)
      expect(sent.xt).toEqual([
        [0xb0, 1, turn],
        [0x90, 8, 1],
      ])
      // one with no device goes to every controller heard from, as before
      state.controls = { buttons: [{ channel: 2, note: 9, mode: 'stage' }] }
      sent.dj.length = sent.xt.length = 0
      send.dj(0xb1, 64, 0)
      send.xt(0xb1, 64, 0)
      vi.advanceTimersByTime(ECHO_MS)
      expect(sent.dj).toEqual([[0x91, 9, 1]])
      expect(sent.xt).toEqual([[0x91, 9, 1]])
      stop()
    })

    it("sends one with no device to each controller but one with its own mapping on the control, and the other's turn", () => {
      const look = squareToHex()
      look.midi = [
        { channel: 1, control: 5, knob: 'frame.zoom' },
        { channel: 1, control: 5, device: 'X-TOUCH MINI', knob: 'frame.turn' },
        { channel: 1, control: 6, macro: 'lattice' },
      ]
      const { access, send, sent } = fakePair()
      const { state, stop } = play(setKnob(setKnob(look, 'frame.zoom', 8), 'frame.turn', 0), 'frame', access)
      send.dj(0xb0, 64, 0)
      send.xt(0xb0, 64, 0)
      vi.advanceTimersByTime(ECHO_MS)
      const turn = Math.round(at(state.scene, 'frame.turn') * 127)
      expect(sent.dj).toEqual([
        [0xb0, 5, 127],
        [0xb0, 6, 64],
      ])
      expect(sent.xt).toEqual([
        [0xb0, 5, turn],
        [0xb0, 6, 64],
      ])
      // the DJ2GO2 turning the macro: the X-Touch's ring follows it, the DJ2GO2's hand holding its own
      sent.dj.length = sent.xt.length = 0
      send.dj(0xb0, 6, 127)
      vi.advanceTimersByTime(HOLD_MS * 2)
      expect(sent.dj).toEqual([])
      expect(sent.xt).toEqual([[0xb0, 6, 127]])
      stop()
    })
  })

  it("draws a grid a controller, each of exactly the notes it sent, the X-Touch's layer B too", () => {
    const { access, send } = fakePair()
    const { state } = play(squareToHex(), 'frame', access)
    expect(grids(state.inputs, state.pressed, state.controls.buttons)).toEqual([
      { device: 'DJ2GO2', plugged: true, pads: [] },
      { device: 'X-TOUCH MINI', plugged: true, pads: [] },
    ])
    // layer A's top row's first and the bottom's last, then layer B's, out of order, one twice, and a release
    for (const n of [8, 23, 47, 32, 8]) send.xt(0x90, n, 127)
    send.xt(0x80, 40, 0)
    // the DJ2GO2's pads on each deck's channel
    send.dj(0x94, 1, 127)
    send.dj(0x95, 1, 127)
    send.dj(0x94, 0, 127)
    learned(state, { slot: 0 }, () => send.dj(0x90, 11, 127))
    expect(grids(state.inputs, state.pressed, state.controls.buttons)).toEqual([
      {
        device: 'DJ2GO2',
        plugged: true,
        pads: [
          { channel: 1, note: 11 },
          { channel: 5, note: 0 },
          { channel: 5, note: 1 },
          { channel: 6, note: 1 },
        ],
      },
      {
        device: 'X-TOUCH MINI',
        plugged: true,
        pads: [8, 23, 32, 47].map((note) => ({ channel: 1, note })),
      },
    ])
    // a controller's learned buttons draw its grid unplugged too, and buttons with no device a grid of their own
    expect(
      grids(
        ['DJ2GO2'],
        [],
        [
          { channel: 1, note: 9, device: 'X-TOUCH MINI', slot: 1 },
          { channel: 1, note: 8, slot: 0 },
        ],
      ),
    ).toEqual([
      { device: 'DJ2GO2', plugged: true, pads: [] },
      { device: 'X-TOUCH MINI', plugged: false, pads: [{ channel: 1, note: 9 }] },
      { plugged: true, pads: [{ channel: 1, note: 8 }] },
    ])
  })

  it("keeps each mapping's device through the parsers, and refuses one that is not a name", () => {
    const look = squareToHex()
    look.midi = [
      { channel: 1, control: 1, device: 'DJ2GO2', knob: 'frame.zoom' },
      { channel: 1, control: 1, device: 'X-TOUCH MINI', pickup: true, macro: 'lattice' },
      { channel: 1, control: 2, knob: 'frame.turn' },
    ]
    expect(parseScene(JSON.stringify(look))).toEqual(look)
    const controls: Controls = {
      buttons: [
        { channel: 1, note: 8, device: 'DJ2GO2', slot: 0 },
        { channel: 1, note: 8, device: 'X-TOUCH MINI', mode: 'edit' },
      ],
      fader: { channel: 1, control: 9, pickup: true, device: 'X-TOUCH MINI' },
      strip: [{ channel: 1, control: 9, index: 0, device: 'DJ2GO2' }],
    }
    expect(parseControls(JSON.stringify(controls))).toEqual(controls)
    const midi = (device: unknown) => ({ ...look, midi: [{ channel: 1, control: 1, device, knob: 'frame.zoom' }] })
    expect(() => parseScene(midi(7))).toThrow(/^midi\[0\]\.device: must be a non-empty string/)
    expect(() => parseScene(midi(''))).toThrow(/^midi\[0\]\.device: must be a non-empty string/)
    expect(() => parseControls({ buttons: [{ channel: 1, note: 8, device: null, slot: 0 }] })).toThrow(
      /^buttons\[0\]\.device: must be a non-empty string/,
    )
    expect(() => parseControls({ buttons: [], fader: { channel: 1, control: 9, device: ['X'] } })).toThrow(
      /^fader\.device: must be a non-empty string/,
    )
    expect(() => parseControls({ buttons: [], strip: [{ channel: 1, control: 9, index: 0, device: {} }] })).toThrow(
      /^strip\[0\]\.device: must be a non-empty string/,
    )
    // a control once on its controller: twice on one is refused, as twice with no device is
    const twice = { channel: 1, control: 1, device: 'DJ2GO2' }
    expect(() =>
      parseScene({
        ...look,
        midi: [
          { ...twice, knob: 'frame.zoom' },
          { ...twice, knob: 'frame.turn' },
        ],
      }),
    ).toThrow(/^midi\[1\]: channel 1 number 1 of DJ2GO2 is mapped twice/)
  })
})
