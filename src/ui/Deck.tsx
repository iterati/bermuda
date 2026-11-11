// A deck in the Decks view: its side's scene playing alone in its own preview (the Picture draws into the canvas),
// how much of it the mix shows, and a look or preset to cue onto it. Clicking the deck edits its side.
import type { Scene } from '../scene'
import type { Side } from './Picture'

type Props = {
  side: Side
  scene: Scene
  preset?: string // the preset in play, if one is
  share?: number // how far the fader has it in the mix, 0 to 1; none while a transition runs it
  editing: boolean
  looks: Scene[]
  canvas: (el: HTMLCanvasElement | null) => void
  onEdit: () => void
  onLoad: (look: Scene, preset?: number) => void
}

export function Deck({ side, scene, preset, share, editing, looks, canvas, onEdit, onLoad }: Props) {
  const key = side.toUpperCase()
  return (
    <section className={`panel deck${editing ? ' on' : ''}`} onClick={onEdit} title={`edit ${key} (key ${key})`}>
      <canvas ref={canvas} />
      <div className="deck-title">
        <kbd>{key}</kbd>
        <b>{scene.name}</b>
        {preset && <span className="dim">· {preset}</span>}
        <span className={`deck-state${share === 1 ? ' air' : ''}`}>
          {share === undefined
            ? 'in a transition'
            : share === 1
              ? 'on air'
              : share === 0
                ? 'cued'
                : `${Math.round(share * 100)}% in the mix`}
        </span>
      </div>
      <select
        value=""
        title={`load a look or one of its presets onto ${key}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          const [i, p] = e.target.value.split('/').map(Number)
          onLoad(looks[i], p)
        }}
      >
        <option value="" disabled>
          cue a look onto {key}…
        </option>
        {looks.flatMap((look, i) => [
          <option key={i} value={i}>
            {look.name}
          </option>,
          ...look.presets.map((p, j) => (
            <option key={`${i}/${j}`} value={`${i}/${j}`}>
              {'\u00a0\u00a0\u00a0'}· {p.name}
            </option>
          )),
        ])}
      </select>
    </section>
  )
}
