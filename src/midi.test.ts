import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prune, removeLevel } from './edit'
import { background, LOOKS } from './looks'
import {
  attach,
  drive,
  ECHO_MS,
  echoes,
  HOLD_MS,
  keyOf,
  learn,
  learnTrigger,
  positionOf,
  takes,
  waiting,
  type Learning,
  type Message,
} from './midi'
import { setKnob, update } from './motion'
import { hardRange, parseScene, parseControls, resolve, type Controls, type Scene, type View } from './scene'

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

// The app's MIDI loop in small: a target learning takes the first control of its kind, a control drives what it
// maps to (the A/B fader's control first), a button loads its slot or picks its mode, and the controller is sent
// the look.
function play(scene: Scene) {
  const { access, send, sent, through } = fakeController()
  const state = {
    scene,
    learning: null as Learning | null,
    controls: { buttons: [] } as Controls,
    fader: 0,
    mode: 'stage' as View,
    inputs: [] as string[],
  }
  const at = new Map<string, number>()
  const stop = attach(
    access,
    () =>
      echoes(state.scene, state.controls, state.fader, (t) =>
        'slot' in t ? LOOKS[t.slot]?.name === state.scene.name : t.mode === state.mode,
      ),
    {
      inputs: (names) => (state.inputs = names),
      message: (m: Message) => {
        const t = state.learning
        if (m.kind === 'note') {
          if (t && ('slot' in t || 'mode' in t)) {
            state.learning = null
            state.controls = { ...state.controls, buttons: learnTrigger(state.controls.buttons, t, m) }
            return
          }
          const trigger = state.controls.buttons.find((x) => x.channel === m.channel && x.note === m.number)
          if (trigger && 'mode' in trigger) state.mode = trigger.mode
          else if (trigger) state.scene = structuredClone(LOOKS[trigger.slot])
          return
        }
        const key = keyOf('cc', m.channel, m.number)
        const last = at.get(key)
        at.set(key, m.value)
        const ab = state.controls.fader
        const onAb = ab && keyOf('cc', ab.channel, ab.control) === key
        if (t && 'fader' in t) {
          state.learning = null
          state.controls = { ...state.controls, fader: { channel: m.channel, control: m.number, pickup: true } }
        } else if (t && ('knob' in t || 'macro' in t)) {
          state.learning = null
          if (onAb) state.controls = { buttons: state.controls.buttons }
          state.scene = drive(
            update(state.scene, (d) => learn(d, t, m)),
            m,
          )
        } else if (onAb) {
          if (!ab.pickup || takes(state.fader, last, m.value)) state.fader = m.value
        } else state.scene = drive(state.scene, m, last)
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
      /^buttons\[0\]: must name one slot or one mode/,
    )
  })

  it('maps a control to a knob, whose value lands inside its hard range at every position', () => {
    const address = 'levels[nest1].affine.turn'
    const { state, send } = play(squareToHex())
    expect(state.inputs).toEqual(['Fake knobs', 'Midi Through'])
    state.learning = { knob: address }
    send(0xba, 1, 64)
    expect(state.scene.midi).toEqual([{ channel: 11, control: 1, knob: address }])
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
    expect(state.scene.midi).toEqual([{ channel: 1, control: 7, knob: 'background.amount' }])
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
    expect(state.scene.midi).toEqual([{ channel: 4, control: 74, knob: address }])
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
    expect(state.scene.midi).toEqual([{ channel: 1, control: 22, knob: 'frame.turn' }])
  })

  it('learns only from the first control of a burst, and a knob only from a CC', () => {
    const { state, send } = play(squareToHex())
    state.learning = { knob: 'frame.zoom' }
    send(0x9a, 8, 127)
    expect(state.learning).toEqual({ knob: 'frame.zoom' })
    send(0xb0, 7, 10)
    send(0xb0, 39, 10)
    expect(state.scene.midi).toEqual([{ channel: 1, control: 7, knob: 'frame.zoom' }])
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
    expect(echoes(faded(), { buttons: [] }, 0, () => false).size).toBe(0)
  })

  it('learns onto the A/B fader, with pickup, ahead of any look mapping on its control', () => {
    const { state, send, at } = play(faded())
    state.fader = 0.5
    state.learning = { fader: true }
    send(0xba, 9, 0)
    expect(state.controls.fader).toEqual({ channel: 11, control: 9, pickup: true })
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
    expect(echoes(scene, { buttons: [], fader: ab }, 0.5, () => false)).toEqual(new Map([['cc 11/2', [0xba, 2, 64]]]))
    expect(echoes(scene, { buttons: [], fader: { ...ab, pickup: true } }, 0.5, () => false).size).toBe(0)
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
      { channel: 11, note: 8, slot: 0 },
      { channel: 11, note: 16, mode: 'edit' },
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
