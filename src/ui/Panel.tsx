import { useStore } from '../store'
import { Timeline } from './Timeline'

/** The story beside the Mapa: the year, the Capítulo under way, the legend and play. */
export function Panel() {
  const playing = useStore((s) => s.playing)
  const set = useStore((s) => s.set)

  return (
    <aside className="panel">
      <Timeline />
      <div className="story">
        <p className="kicker">
          The big migration · A year in <u>Serengeti</u>
        </p>
        <article className="capitulo">
          <header>
            <h1>The crossing</h1>
            <p>Mara river · 01 August</p>
          </header>
          <p>
            The south has dried out. The herd presses against the banks of the Mara, then pours across into Kenya,
            again and again, towards the last green grass.
          </p>
        </article>
        <ul className="legend">
          <li>
            <span className="swatch">
              <img src="/ui/nu.svg" alt="" />
            </span>
            Wildebeests
          </li>
          <li>
            <span className="swatch">
              <img src="/ui/gacela.svg" alt="" />
            </span>
            Gazelles
          </li>
          <li>
            <span className="swatch">
              <img src="/ui/lluvia.svg" alt="" />
            </span>
            Rain where the herd is (0 - 90mm)
          </li>
        </ul>
        <button className="play" onClick={() => set({ playing: !playing })}>
          <svg width="8" height="12" viewBox="0 0 8 12" aria-hidden>
            {playing ? <path d="M0 0h3v12H0zM5 0h3v12H5z" /> : <path d="M0 0v12l8-6z" />}
          </svg>
          {playing ? 'Pause' : 'Play'}
        </button>
      </div>
    </aside>
  )
}
