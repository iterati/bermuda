// The looks: the built-in ones and the ones saved in this browser, each with its presets under it,
// plus saving, and files in and out.
import { useState } from 'react'
import { capturePreset } from '../motion'
import { parseScene, type Scene } from '../scene'
import { useCtl } from './controls'

type Props = {
  looks: Scene[]
  saved: Set<string>
  onLoad: (look: Scene, preset?: number) => void
  onSave: () => void
  onDelete: (name: string) => void
  onError: (message: string) => void
}

// a value downloaded as a JSON file named after name
export function download(name: string, value: unknown) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  a.download = `${name.replace(/[^\w-]+/g, '-')}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

export function Looks({ looks, saved, onLoad, onSave, onDelete, onError }: Props) {
  const { scene, edit } = useCtl()
  const [presetName, setPresetName] = useState('')
  return (
    <div className="panel-block">
      <div className="block-title">
        <span>Looks</span>
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
      </div>
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
      <ol className="looks">
        {looks.map((look, i) => {
          const current = look.name === scene.name
          const presets = current ? scene.presets : look.presets
          return (
            <li key={look.name} className={current ? 'current' : ''}>
              <div className="look">
                <button className="look-name" onClick={() => onLoad(look)} title={i < 10 ? `key ${(i + 1) % 10}` : ''}>
                  {i < 10 && <kbd>{(i + 1) % 10}</kbd>}
                  {look.name}
                </button>
                {saved.has(look.name) && (
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
                      {current && (
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
    </div>
  )
}
