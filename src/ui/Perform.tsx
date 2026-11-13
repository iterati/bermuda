// The Perform strip, the Stage's own: 8 big knobs, the look's macros and then the picked chip's top knobs, a page
// of 8 at a time. Slot n is always place n, an empty one kept as an empty place, so a controller's encoder n is
// slot n on every page of every look.
import { useMemo } from 'react'
import { kindOf, knobKind, knobsOf, type Address, type MidiTarget } from '../scene'
import { useCtl } from './controls'
import { Knob } from './Knob'
import { MapTag } from './Midi'

type Props = {
  slots: (MidiTarget | undefined)[]
  page: number
  pages: number
  onPage: (by: 1 | -1) => void
  onMore: () => void
}

export function Perform({ slots, page, pages, onPage, onMore }: Props) {
  const { scene } = useCtl()
  const all = useMemo(() => knobsOf(scene), [scene])
  // a knob's kind's label, and its variant's number when its level has more than one
  const label = (address: Address) => {
    const { label } = knobKind(address)
    const variants = all.find((k) => k.address === address)!.level?.level.variants.length ?? 0
    if (!kindOf(address).startsWith('levels[].variants[]') || variants < 2) return label
    return `${label} ${Number(/.*variants\[(\d+)\]/.exec(address)![1]) + 1}`
  }
  return (
    <div className="perform">
      {slots.map((t, i) => (
        <div className="slot" key={i}>
          <MapTag target={{ strip: i }} />
          {t &&
            ('macro' in t ? (
              <Knob key={t.macro} label={scene.macros.find((m) => m.id === t.macro)!.name} macro={t.macro} />
            ) : (
              <Knob key={t.knob} label={label(t.knob)} at={t.knob} />
            ))}
        </div>
      ))}
      <div className="perform-side">
        {pages > 1 && (
          <span className="pager">
            <button
              className="mini"
              title="the page before (PgUp)"
              data-learn={JSON.stringify({ page: -1 })}
              onClick={() => onPage(-1)}
            >
              ◂<MapTag target={{ page: -1 }} />
            </button>
            <span>
              page {page + 1}/{pages}
            </span>
            <button
              className="mini"
              title="the next page (PgDn)"
              data-learn={JSON.stringify({ page: 1 })}
              onClick={() => onPage(1)}
            >
              ▸<MapTag target={{ page: 1 }} />
            </button>
          </span>
        )}
        <button className="mini" title="every knob of the picked chip" onClick={onMore}>
          more ▸
        </button>
      </div>
    </div>
  )
}
