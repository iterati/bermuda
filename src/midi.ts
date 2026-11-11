// MIDI learn: a controller's control changes (CC), each mapped to a knob or a macro of the look and saved in
// its JSON (Scene.midi), or to the A/B fader, and its buttons (notes), each a trigger of the app (both kept as the
// app's Controls). A knob takes the control's 0 to 127
// over its play range, else its hard range; a macro over 0 to 1. The controller is kept showing the look: each
// encoder gets its knob's value back on its own CC, so its ring shows it, and each button's LED is lit by its note.
import { setMacro, update } from './motion'
import {
  clamp,
  playRange,
  resolve,
  type Controls,
  type Midi,
  type MidiTarget,
  type Scene,
  type Trigger,
  type TriggerTarget,
} from './scene'

// What the next control learns: a knob or macro of the look, the A/B fader, or a button's trigger.
export type Learning = MidiTarget | { fader: true } | TriggerTarget
export type Message = { kind: 'cc' | 'note'; channel: number; number: number; value: number } // value 0 to 1

export const HAS_MIDI = 'requestMIDIAccess' in navigator
export const ECHO_MS = 33 // the fastest each control is sent its value, about 30 a second
export const HOLD_MS = 250 // a control a hand moves is not sent its value for this long after

export const keyOf = (kind: 'cc' | 'note', channel: number, number: number) => `${kind} ${channel}/${number}`

// Hear every input of the access, inputs plugged in later too, and keep sending the controller the messages
// read() gives, each once it changes. They go only to the outputs named as an input that has sent something:
// a controller's own port, never other gear or a through port that would play them back. Returns the hang-up.
export function attach(
  access: MIDIAccess,
  read: () => Map<string, number[]>,
  on: { message: (m: Message) => void; inputs: (names: string[]) => void },
) {
  const sent = new Map<string, string>()
  const moved = new Map<string, number>()
  const heard = new Set<string>()
  const onMessage = (e: MIDIMessageEvent) => {
    const data = e.data!
    if (data.length < 3) return
    heard.add((e.target as MIDIInput).name!)
    const [status, number, value] = data
    const channel = (status & 0x0f) + 1
    const kind = (status & 0xf0) === 0xb0 ? 'cc' : (status & 0xe0) === 0x80 ? 'note' : undefined
    if (!kind) return
    const key = keyOf(kind, channel, number)
    if (kind === 'cc') {
      // a turned encoder holds the value it sent
      sent.set(key, String([...data]))
      moved.set(key, performance.now())
      on.message({ kind, channel, number, value: value / 127 })
      return
    }
    // a button pressed or let go may have set its own LED, so it is sent its state again; a press is a note on
    sent.delete(key)
    if ((status & 0xf0) === 0x90 && value > 0) on.message({ kind, channel, number, value: value / 127 })
  }
  const plug = () => {
    // setting onmidimessage opens the port
    access.inputs.forEach((input) => (input.onmidimessage = onMessage))
    // a controller plugged in shows nothing yet
    sent.clear()
    on.inputs([...access.inputs.values()].filter((i) => i.state === 'connected').map((i) => i.name!))
  }
  plug()
  access.onstatechange = plug
  const echo = setInterval(() => {
    const now = performance.now()
    const outputs = [...access.outputs.values()].filter((o) => o.state === 'connected' && heard.has(o.name!))
    if (!outputs.length) return
    for (const [key, bytes] of read()) {
      if (sent.get(key) === String(bytes) || now - (moved.get(key) ?? -Infinity) < HOLD_MS) continue
      sent.set(key, String(bytes))
      for (const output of outputs) output.send(bytes)
    }
  }, ECHO_MS)
  return () => {
    clearInterval(echo)
    access.onstatechange = null
    access.inputs.forEach((input) => (input.onmidimessage = null))
  }
}

const targetKey = (t: Learning) =>
  'knob' in t
    ? `knob ${t.knob}`
    : 'macro' in t
      ? `macro ${t.macro}`
      : 'fader' in t
        ? 'fader'
        : 'slot' in t
          ? `slot ${t.slot}`
          : `mode ${t.mode}`

export const same = (a: Learning, b: Learning) => targetKey(a) === targetKey(b)

export const mappingOf = (scene: Scene, t: MidiTarget) => scene.midi?.find((m) => same(m, t))

type Control = { channel: number; control: number; pickup?: true }

export const label = (m: Control | Trigger) => `ch${m.channel} ${'note' in m ? `note ${m.note}` : `cc${m.control}`}`

// Where a mapping's knob or macro sits, 0 to 1 over the control's range.
export function positionOf(scene: Scene, map: Midi): number {
  if ('macro' in map) return scene.macros.find((m) => m.id === map.macro)!.value
  const knob = resolve(scene, map.knob)!
  const [lo, hi] = playRange(map.knob, knob)
  return clamp((knob.value - lo) / (hi - lo), [0, 1])
}

// A pickup fader at its last position takes over from a value at a position, 0 to 1, once it comes within a step
// of it or passes it; until then it waits.
const near = (position: number, at: number | undefined) => at !== undefined && Math.abs(at - position) <= 1 / 127 + 1e-9
export const takes = (position: number, last: number | undefined, value: number) =>
  near(position, last) || near(position, value) || (last !== undefined && (last - position) * (value - position) < 0)
export const waiting = (map: Control, position: number, positions: ReadonlyMap<string, number>) =>
  !!map.pickup && !near(position, positions.get(keyOf('cc', map.channel, map.control)))

// Map a control change to a target, on a draft: the control's old mapping and the target's go.
export function learn(draft: Scene, t: MidiTarget, m: Message) {
  draft.midi = [
    ...(draft.midi ?? []).filter((x) => !(x.channel === m.channel && x.control === m.number) && !same(x, t)),
    { channel: m.channel, control: m.number, ...t },
  ]
}

// The triggers with a note mapped to a target: the note's old trigger and the target's go.
export const learnTrigger = (triggers: Trigger[], t: TriggerTarget, m: Message): Trigger[] => [
  ...triggers.filter((x) => !(x.channel === m.channel && x.note === m.number) && !same(x, t)),
  { channel: m.channel, note: m.number, ...t },
]

export function unmap(draft: Scene, t: MidiTarget) {
  if (draft.midi) draft.midi = draft.midi.filter((m) => !same(m, t))
}

// The scene with a control change on what it drives, or the scene itself when it drives nothing, or when it
// is a pickup fader that has not passed its target since its last position.
export function drive(scene: Scene, m: Message, last?: number): Scene {
  const map = scene.midi?.find((x) => x.channel === m.channel && x.control === m.number)
  if (!map) return scene
  if (map.pickup && !takes(positionOf(scene, map), last, m.value)) return scene
  return update(scene, (d) => {
    if ('macro' in map) return setMacro(d, map.macro, m.value)
    const knob = resolve(d, map.knob)!
    const [lo, hi] = playRange(map.knob, knob)
    knob.value = clamp(lo + (hi - lo) * m.value, [lo, hi])
  })
}

// What the controller should show: each encoder its value on its own CC (a pickup fader cannot move, so none),
// the A/B fader's CC its place when that is no pickup fader, and each button's LED on (velocity 1) or off (0) by
// its note, keyed as attach() keys the controls.
export function echoes(
  scene: Scene,
  controls: Controls,
  fader: number,
  lit: (t: Trigger) => boolean,
): Map<string, number[]> {
  const out = new Map<string, number[]>()
  const cc = (m: Control, at: number) =>
    !m.pickup && out.set(keyOf('cc', m.channel, m.control), [0xb0 | (m.channel - 1), m.control, Math.round(at * 127)])
  for (const m of scene.midi ?? []) cc(m, positionOf(scene, m))
  if (controls.fader) cc(controls.fader, fader)
  for (const t of controls.buttons)
    out.set(keyOf('note', t.channel, t.note), [0x90 | (t.channel - 1), t.note, lit(t) ? 1 : 0])
  return out
}
