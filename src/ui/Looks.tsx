// The looks: the built-in ones in their folders, then Mine, the ones saved in this browser under a name no built-in
// has, each look with its presets under it, plus saving, and files in and out. Its play part is the looks and their
// presets to load, alone. Each folder opens and closes, the playing look's opening itself; the keys and MIDI slots
// count through the whole list, open or closed.
import { useState } from 'react'
import { FOLDERS, LOOKS } from '../looks'
import { capturePreset } from '../motion'
import { parseScene, type Scene } from '../scene'
import { useCtl } from './controls'
import { MapTag } from './Midi'

type Props = {
  looks: Scene[]
  saved: Set<string>
  onLoad: (look: Scene, preset?: number) => void
  onSave: () => void
  onDelete: (name: string) => void
  onError: (message: string) => void
  part?: 'play'
}

// a value downloaded as a JSON file named after name
export function download(name: string, value: unknown) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  a.download = `${name.replace(/[^\w-]+/g, '-')}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

const MINE = 'Mine'
// a look's name in its folder: without its family (Deco - Seigaiha is Seigaiha), but the Tapestries' whole
const short = (name: string) => (name.startsWith('Tapestry ') ? name : name.replace(/^[^-]+ - /, ''))
const counted = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`

export function Looks({ looks, saved, onLoad, onSave, onDelete, onError, part }: Props) {
  const { scene, edit } = useCtl()
  const [presetName, setPresetName] = useState('')
  const mine = looks.filter((l) => !LOOKS.some((b) => b.name === l.name))
  const folders = [
    ...FOLDERS.map((f) => ({ name: f.name, looks: looks.filter((l) => f.looks.some((b) => b.name === l.name)) })),
    ...(mine.length ? [{ name: MINE, looks: mine }] : []),
  ]
  const here = folders.find((f) => f.looks.some((l) => l.name === scene.name))?.name
  const [open, setOpen] = useState(() => new Set(here ? [here] : []))
  // the playing look's folder opens as it comes to play, or as it is saved into Mine
  const [playing, setPlaying] = useState({ name: scene.name, here })
  if (playing.name !== scene.name || playing.here !== here) {
    setPlaying({ name: scene.name, here })
    if (here) setOpen(new Set(open).add(here))
  }
  // the playing look's presets as it has them now
  const presetsOf = (look: Scene) => (look.name === scene.name ? scene.presets : look.presets)
  return (
    <div className="panel-block">
      <div className="block-title">
        <span>Looks</span>
        <span className="folding">
          <button className="mini" onClick={() => setOpen(new Set(folders.map((f) => f.name)))}>
            open all
          </button>
          <button className="mini" onClick={() => setOpen(new Set())}>
            close all
          </button>
        </span>
        {!part && (
          <span className="actions">
            <button className="mini" title="save this look in the browser (S)" onClick={onSave}>
              save look
            </button>
            <button
              className="mini"
              title="download this look as a JSON file"
              onClick={() => download(scene.name, scene)}
            >
              export
            </button>
            <label className="mini file">
              import
              <input
                type="file"
                accept=".json,application/json"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (!file) return
                  try {
                    onLoad(parseScene(await file.text()))
                  } catch (err) {
                    onError(`${file.name}: ${(err as Error).message}`)
                  }
                }}
              />
            </label>
          </span>
        )}
      </div>
      {!part && (
        <div className="preset-save">
          <input
            placeholder="preset name"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter' && presetName) {
                edit((d) => d.presets.push(capturePreset(d, presetName)))
                setPresetName('')
              }
            }}
          />
          <button
            className="mini"
            disabled={!presetName}
            title="keep every knob's value as a preset under this look"
            onClick={() => {
              edit((d) => d.presets.push(capturePreset(d, presetName)))
              setPresetName('')
            }}
          >
            + preset
          </button>
        </div>
      )}
      {folders.map((f) => {
        const shown = open.has(f.name)
        const presetCount = f.looks.reduce((n, look) => n + presetsOf(look).length, 0)
        return (
          <div key={f.name}>
            <button
              className={`folder${shown ? ' open' : ''}`}
              onClick={() => {
                const next = new Set(open)
                if (!next.delete(f.name)) next.add(f.name)
                setOpen(next)
              }}
            >
              <span className="folder-arrow">{shown ? '▾' : '▸'}</span>
              {f.name}
              <span className="folder-count">
                {counted(f.looks.length, 'look')}
                {presetCount > 0 && ` · ${counted(presetCount, 'preset')}`}
              </span>
            </button>
            {shown && (
              <ol className="looks">
                {f.looks.map((look) => {
                  const i = looks.indexOf(look)
                  const current = look.name === scene.name
                  const presets = presetsOf(look)
                  return (
                    <li key={look.name} className={current ? 'current' : ''}>
                      <div className="look">
                        <button
                          className="look-name"
                          data-learn={JSON.stringify({ slot: i })}
                          onClick={() => onLoad(look)}
                          title={i < 10 ? `key ${(i + 1) % 10}` : ''}
                        >
                          {i < 10 && <kbd>{(i + 1) % 10}</kbd>}
                          {f.name === MINE ? look.name : short(look.name)}
                          <MapTag target={{ slot: i }} />
                        </button>
                        {!part && saved.has(look.name) && (
                          <button className="mini" title="delete from the browser" onClick={() => onDelete(look.name)}>
                            ×
                          </button>
                        )}
                      </div>
                      {presets.length > 0 && (
                        <ul className="presets">
                          {presets.map((p, j) => (
                            <li key={j}>
                              <button className="link" onClick={() => onLoad(current ? scene : look, j)}>
                                {p.name}
                              </button>
                              {!part && current && (
                                <button className="mini" onClick={() => edit((d) => d.presets.splice(j, 1))}>
                                  ×
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
        )
      })}
    </div>
  )
}
