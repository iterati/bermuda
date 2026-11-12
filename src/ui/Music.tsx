// The music block: a song file from this computer (played round), the microphone or a browser tab's sound; why a
// tab is heard no more, once its share ends; what is heard (the tempo and
// the beat, the tone, the drive and the feel it sets, the eight bands); and wiring the look to it.
import { wire, type From, type Heard, type Listening } from '../music'
import { BANDS } from '../scene'
import { useCtl } from './controls'

type Props = {
  music: Listening | null
  heard?: Heard
  ended?: string // why the tab heard last is heard no more
  onListen: (from: From) => void
  onStop: () => void
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

// a feature between its two ends
function Meter({ ends: [lo, hi], value, title }: { ends: [string, string]; value: number; title: string }) {
  return (
    <div className="meter" title={title}>
      <span className="dim">{lo}</span>
      <span className="meter-bar">
        <span style={{ left: `${value * 100}%` }} />
      </span>
      <span className="dim">{hi}</span>
    </div>
  )
}

export function Music({ music, heard, ended, onListen, onStop }: Props) {
  const { scene, edit } = useCtl()
  const song = music?.song
  const wired = [...scene.modulators, ...scene.macros].some((m) => m.listen)
  return (
    <div className="panel-block">
      <div className="block-title">
        <span>Music</span>
        <span className="actions">
          <label className="mini file" title="hear a song file from this computer, played round">
            song
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) onListen(file)
              }}
            />
          </label>
          <button className="mini" title="hear the room through the microphone" onClick={() => onListen('mic')}>
            mic
          </button>
          <button
            className="mini"
            title="listen to a tab: what another tab plays, such as a music video (pick the tab and tick Share tab audio)"
            onClick={() => onListen('tab')}
          >
            tab
          </button>
          {music && (
            <button className="mini" title="stop listening" onClick={onStop}>
              ×
            </button>
          )}
        </span>
      </div>
      {music ? (
        <div className="music-now">
          <span className="music-name" title={music.name}>
            {music.name}
          </span>
          {song && (
            <>
              <button
                className="mini"
                title={song.paused ? 'play the song' : 'pause the song'}
                onClick={() => {
                  void music.ctx.resume()
                  if (song.paused) void song.play()
                  else song.pause()
                }}
              >
                {song.paused ? '▶' : '❚❚'}
              </button>
              <input
                className="music-seek"
                type="range"
                min={0}
                max={song.duration || 0}
                step={0.1}
                value={song.currentTime}
                onKeyDown={(e) => e.stopPropagation()}
                onChange={(e) => (song.currentTime = e.target.valueAsNumber)}
              />
              <span className="dim">
                {clock(song.currentTime)} / {clock(song.duration || 0)}
              </span>
            </>
          )}
        </div>
      ) : ended ? (
        <div className="dim music-now music-ended">{ended}</div>
      ) : (
        <div className="dim music-now">
          a song, the mic or a tab sets the tempo, lands Play&apos;s changes on the beat and drives what listens to it
        </div>
      )}
      {heard && (
        <div className="music-heard">
          <div className="music-beat">
            <span className="beat-dot" style={{ opacity: 1 - (heard.beat - Math.floor(heard.beat)) }} />
            <b>{heard.locked ? `${Math.round(heard.bpm)} bpm` : 'finding the beat…'}</b>
            <span className="dim" title="the snap the drive sets, and the clock's rate against the tempo">
              {heard.snap > 0.5 ? 'choppy' : heard.snap > 0 ? 'snappy' : 'silky'} · clock ×{heard.rate.toFixed(2)}
            </span>
          </div>
          <Meter ends={['dark', 'light']} value={heard.features.tone} title="the tone: where the sound sits" />
          <Meter
            ends={['groove', 'drive']}
            value={heard.features.drive}
            title="a sensual groove or a beat to speed to: the tempo and how sharp its pulse is"
          />
          <div className="bands" title="the loudness in eight bands, low to high">
            {BANDS.map((b) => (
              <span key={b} title={b}>
                <span style={{ height: `${heard.features[b] * 100}%` }} />
              </span>
            ))}
            <span className="level" title="level">
              <span style={{ height: `${heard.features.level * 100}%` }} />
            </span>
          </div>
        </div>
      )}
      <button
        className="mini"
        title="a tone macro on the palette, a kick on the zoom each beat, the bass on the line width, the mids on the rings' drift and the presence on the first star's m; the modulators' listen picks what else listens"
        onClick={() => edit(wire)}
      >
        {wired ? 'wire this look again' : 'wire this look to the music'}
      </button>
    </div>
  )
}
