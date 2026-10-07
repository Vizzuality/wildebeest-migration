import { MONTHS } from '../geo'
import { useStore } from '../store'
import { YearDial } from './YearDial'

export function Overlay() {
  const month = useStore((s) => s.month)
  const s = useStore()
  const idx = Math.floor(month) % 12

  return (
    <div className="overlay">
      <header className="title">
        <div className="eyebrow">Serengeti · Masái Mara</div>
        <h1>La Gran Migración</h1>
        <p>Cada año, 1,3 millones de ñus dan la vuelta al ecosistema entre Tanzania y Kenia persiguiendo la lluvia y la hierba nueva.</p>
      </header>

      <section className="story" key={idx}>
        <div className="story-month">{MONTHS[idx]}</div>
      </section>

      <YearDial />

      <nav className="controls">
        <div className="seg" role="group" aria-label="Velocidad">
          {[0.5, 1, 2, 4].map((v) => (
            <button key={v} className={s.speed === v ? 'on' : ''} onClick={() => s.set({ speed: v, playing: true })}>
              {v}×
            </button>
          ))}
        </div>
      </nav>

      <footer className="foot">
        <span>
          relieve exagerado · lluvias aproximadas · relieve:{' '}
          <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noreferrer">
            AWS Terrain Tiles
          </a>{' '}
          · ríos:{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            © OpenStreetMap contributors
          </a>
        </span>
        <span className="hint">Arrastra para orbitar · rueda para zoom · espacio para pausar</span>
      </footer>
    </div>
  )
}
