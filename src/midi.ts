// MIDI learn: a controller's control changes (CC), each mapped to a knob or a macro of the look and saved in
// its JSON (Scene.midi), or to the A/B fader, and its buttons (notes), each a trigger of the app (both kept as the
// app's Controls). A knob takes the control's 0 to 127
// over its play range, else its hard range; a macro over 0 to 1. The app's Controls also put up to 8 CCs on the
// Perform strip's slots, on every look: each drives what its slot of the page showing holds. The controller is kept
// showing the look: each encoder gets its knob's value back on its own CC, so its ring shows it, and each button's
// LED is lit by its note. Each control is its controller's: a mapping learned names its device (the MIDI input's
// name), hears only that controller and sends its value back only to it, so two controllers play at once; one saved
// before has no device and hears its channel and number on any, as it did.
import { setMacro, update } from './motion'
import {
  clamp,
  playRange,
  resolve,
  type Controls,
  type MidiTarget,
  type Scene,
  type Trigger,
  type TriggerTarget,
} from './scene'

// What the next control learns: a knob or macro of the look, the A/B fader, a button's trigger, or a slot of the
// strip (learning the strip arms each slot in turn).
export type Learning = MidiTarget | { fader: true } | TriggerTarget | { strip: number }
// value 0 to 1; device the name of the input it came from
export type Message = { kind: 'cc' | 'note'; channel: number; number: number; value: number; device: string }
// a control of a controller, as a message names it
export type Played = Pick<Message, 'channel' | 'number' | 'device'>
// a note a controller has sent
export type Pressed = { device: string; channel: number; note: number }

export const HAS_MIDI = 'requestMIDIAccess' in navigator
export const ECHO_MS = 33 // the fastest each control is sent its value, about 30 a second
export const HOLD_MS = 250 // a control a hand moves is not sent its value for this long after

// a control's key, on its device's controller or, with none, on any
export const keyOf = (kind: 'cc' | 'note', channel: number, number: number, device?: string) =>
  `${kind} ${channel}/${number}${device === undefined ? '' : `@${device}`}`
// the controller a key is on, or undefined for one on any
const deviceOf = (key: string) => (key.includes('@') ? key.slice(key.indexOf('@') + 1) : undefined)

// Hear every input of the access, inputs plugged in later too, and keep sending the controllers the messages
// read() gives, each to each output once it changes there. A key's with a device goes only to the output of that
// name, its controller's own port, plugged in; one with none to the outputs named as an input that has sent
// something (a controller's own port, never other gear or a through port that would play them back) but those with
// their own key on the control, which wins. Returns the hang-up.
export function attach(
  access: MIDIAccess,
  read: () => Map<string, number[]>,
  on: { message: (m: Message) => void; inputs: (names: string[]) => void },
) {
  // what each output was last sent on each key, and when its hand last moved it, by key and output
  const sent = new Map<string, string>()
  const moved = new Map<string, number>()
  const heard = new Set<string>()
  const onMessage = (e: MIDIMessageEvent) => {
    const data = e.data!
    if (data.length < 3) return
    const device = (e.target as MIDIInput).name!
    heard.add(device)
    const [status, number, value] = data
    const channel = (status & 0x0f) + 1
    const kind = (status & 0xf0) === 0xb0 ? 'cc' : (status & 0xe0) === 0x80 ? 'note' : undefined
    if (!kind) return
    // the control on its own controller's key and on any's, a mapping with no device's
    const keys = [keyOf(kind, channel, number, device), keyOf(kind, channel, number)].map((k) => `${k} > ${device}`)
    if (kind === 'cc') {
      // a turned encoder holds the value it sent
      for (const k of keys) {
        sent.set(k, String([...data]))
        moved.set(k, performance.now())
      }
      on.message({ kind, channel, number, value: value / 127, device })
      return
    }
    // a button pressed or let go may have set its own LED, so it is sent its state again; a press is a note on
    for (const k of keys) sent.delete(k)
    if ((status & 0xf0) === 0x90 && value > 0) on.message({ kind, channel, number, value: value / 127, device })
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
    const outputs = [...access.outputs.values()].filter((o) => o.state === 'connected')
    const shown = read()
    for (const [key, bytes] of shown) {
      const device = deviceOf(key)
      const to =
        device === undefined
          ? outputs.filter((o) => heard.has(o.name!) && !shown.has(`${key}@${o.name}`))
          : outputs.filter((o) => o.name === device)
      for (const output of to) {
        const at = `${key} > ${output.name}`
        if (sent.get(at) === String(bytes) || now - (moved.get(at) ?? -Infinity) < HOLD_MS) continue
        sent.set(at, String(bytes))
        output.send(bytes)
      }
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
          : 'strip' in t
            ? `strip ${t.strip}`
            : 'page' in t
              ? `page ${t.page}`
              : `mode ${t.mode}`

export const same = (a: Learning, b: Learning) => targetKey(a) === targetKey(b)

export const mappingOf = (scene: Scene, t: MidiTarget) => scene.midi?.find((m) => same(m, t))

type Control = { channel: number; control: number; pickup?: true; device?: string }

export const label = (m: Control | Trigger) => `ch${m.channel} ${'note' in m ? `note ${m.note}` : `cc${m.control}`}`
// the label with the controller it is on, if it names one
export const named = (m: Control | Trigger) => (m.device === undefined ? label(m) : `${label(m)} · ${m.device}`)

// Whether a mapping hears a control: its channel and number on its own controller, or on any when it has no device.
const hears = (x: { channel: number; device?: string }, number: number, m: Played) =>
  x.channel === m.channel && number === m.number && (x.device === undefined || x.device === m.device)
export const hearsControl = (x: Control, m: Played) => hears(x, x.control, m)
const hearsNote = (x: Trigger, m: Played) => hears(x, x.note, m)
// of the mappings that hear a control, the one its own controller learned, else one with no device
const first = <T extends { device?: string }>(on: T[]): T | undefined => on.find((x) => x.device !== undefined) ?? on[0]
export const controlOf = <T extends Control>(list: readonly T[] | undefined, m: Played) =>
  first((list ?? []).filter((x) => hearsControl(x, m)))
export const triggerOf = (buttons: readonly Trigger[], m: Played) => first(buttons.filter((x) => hearsNote(x, m)))

// Where a knob or macro sits, 0 to 1 over a control's range: a knob's play range, else its hard range; a macro's
// 0 to 1.
export function positionOf(scene: Scene, t: MidiTarget): number {
  if ('macro' in t) return scene.macros.find((m) => m.id === t.macro)!.value
  const knob = resolve(scene, t.knob)!
  const [lo, hi] = playRange(t.knob, knob)
  return clamp((knob.value - lo) / (hi - lo), [0, 1])
}

// A knob or macro set from a control's position, 0 to 1, as positionOf reads it (on a draft).
export function setTarget(draft: Scene, t: MidiTarget, v: number) {
  if ('macro' in t) return setMacro(draft, t.macro, v)
  const knob = resolve(draft, t.knob)!
  const [lo, hi] = playRange(t.knob, knob)
  knob.value = clamp(lo + (hi - lo) * v, [lo, hi])
}

// A pickup fader at its last position takes over from a value at a position, 0 to 1, once it comes within a step
// of it or passes it; until then it waits.
const near = (position: number, at: number | undefined) => at !== undefined && Math.abs(at - position) <= 1 / 127 + 1e-9
export const takes = (position: number, last: number | undefined, value: number) =>
  near(position, last) || near(position, value) || (last !== undefined && (last - position) * (value - position) < 0)
export const waiting = (map: Control, position: number, positions: ReadonlyMap<string, number>) =>
  !!map.pickup && !near(position, positions.get(keyOf('cc', map.channel, map.control, map.device)))

// whether a mapping is the controller's a message came from, or any controller's
const mine = (x: { device?: string }, m: Played) => x.device === undefined || x.device === m.device

// Map a control change to a target, on its controller, on a draft: the old mappings that hear the control and the
// target's on that controller go; another controller's mappings stay, so a target may take one control on each.
export function learn(draft: Scene, t: MidiTarget, m: Message) {
  draft.midi = [
    ...(draft.midi ?? []).filter((x) => !hearsControl(x, m) && !(same(x, t) && mine(x, m))),
    { channel: m.channel, control: m.number, device: m.device, ...t },
  ]
}

// The triggers with a note mapped to a target, on its controller: the old triggers that hear the note and the
// target's on that controller go, another controller's staying.
export const learnTrigger = (triggers: Trigger[], t: TriggerTarget, m: Message): Trigger[] => [
  ...triggers.filter((x) => !hearsNote(x, m) && !(same(x, t) && mine(x, m))),
  { channel: m.channel, note: m.number, device: m.device, ...t },
]

// The controls with a CC let go: off the A/B fader and the strip, wherever they hear it.
export function release(controls: Controls, m: Played): Controls {
  const other = (x: Control) => !hearsControl(x, m)
  const { fader, strip, ...rest } = controls
  return { ...rest, ...(fader && other(fader) ? { fader } : {}), ...(strip ? { strip: strip.filter(other) } : {}) }
}

// The controls with a CC learned onto a slot of the strip: the CC's old place and the slot's old CC go. The look
// lets it go too (unmapControl).
export function learnStrip(controls: Controls, index: number, m: Message): Controls {
  const kept = release(controls, m)
  return {
    ...kept,
    strip: [
      ...(kept.strip ?? []).filter((x) => x.index !== index),
      { channel: m.channel, control: m.number, index, device: m.device },
    ],
  }
}

// The look with no mapping that hears a control change's CC (on a draft).
export function unmapControl(draft: Scene, m: Message) {
  if (draft.midi) draft.midi = draft.midi.filter((x) => !hearsControl(x, m))
}

export function unmap(draft: Scene, t: MidiTarget) {
  if (draft.midi) draft.midi = draft.midi.filter((m) => !same(m, t))
}

// The scene with a control change on what it drives, or the scene itself when it drives nothing, or when it
// is a pickup fader that has not passed its target since its last position.
export function drive(scene: Scene, m: Message, last?: number): Scene {
  const map = controlOf(scene.midi, m)
  if (!map) return scene
  if (map.pickup && !takes(positionOf(scene, map), last, m.value)) return scene
  return update(scene, (d) => setTarget(d, map, m.value))
}

// The scene with a control change on the strip's slot its CC drives, of the page showing (slots), or the scene
// itself when that slot is empty; undefined when the CC is not the strip's. An encoder is endless, so a strip CC
// takes no pickup.
export function driveStrip(
  scene: Scene,
  controls: Controls,
  slots: (MidiTarget | undefined)[],
  m: Message,
): Scene | undefined {
  const cc = controlOf(controls.strip, m)
  if (!cc) return undefined
  const t = slots[cc.index]
  return t ? update(scene, (d) => setTarget(d, t, m.value)) : scene
}

// What the controller should show: each encoder its value on its own CC (a pickup fader cannot move, so none),
// the A/B fader's CC its place when that is no pickup fader, each strip CC its slot's place on the page showing
// (slots; 0 for an empty slot), over a look's mapping on the same CC, and each button's LED on (velocity 1) or off
// (0) by its note, keyed as attach() keys the controls, each on its own controller.
export function echoes(
  scene: Scene,
  controls: Controls,
  fader: number,
  lit: (t: Trigger) => boolean,
  slots: (MidiTarget | undefined)[],
): Map<string, number[]> {
  const out = new Map<string, number[]>()
  const cc = (m: Control, at: number) =>
    !m.pickup &&
    out.set(keyOf('cc', m.channel, m.control, m.device), [0xb0 | (m.channel - 1), m.control, Math.round(at * 127)])
  for (const m of scene.midi ?? []) cc(m, positionOf(scene, m))
  if (controls.fader) cc(controls.fader, fader)
  for (const s of controls.strip ?? []) {
    const t = slots[s.index]
    cc(s, t ? positionOf(scene, t) : 0)
  }
  for (const t of controls.buttons)
    out.set(keyOf('note', t.channel, t.note, t.device), [0x90 | (t.channel - 1), t.note, lit(t) ? 1 : 0])
  return out
}

// The pads to draw, a grid a controller: each controller plugged in (inputs), heard from or with a button learned on
// it, the plugged in first, each grid the notes it has sent and its learned buttons' notes, by channel and note;
// and last, when there are any, a grid of the buttons with no device, which any controller presses (never shown as
// unplugged).
export type Grid = { device?: string; plugged: boolean; pads: { channel: number; note: number }[] }
export function grids(inputs: readonly string[], heard: readonly Pressed[], buttons: readonly Trigger[]): Grid[] {
  const pads = (on: { channel: number; note: number }[]) =>
    [...new Map(on.map((x) => [`${x.channel}/${x.note}`, { channel: x.channel, note: x.note }])).values()].sort(
      (a, b) => a.channel - b.channel || a.note - b.note,
    )
  const devices = new Set([...inputs, ...heard.map((h) => h.device), ...buttons.flatMap((b) => b.device ?? [])])
  const out: Grid[] = [...devices].map((device) => ({
    device,
    plugged: inputs.includes(device),
    pads: pads([...heard, ...buttons].filter((x) => x.device === device)),
  }))
  const any = buttons.filter((b) => b.device === undefined)
  return any.length ? [...out, { plugged: true, pads: pads(any) }] : out
}
