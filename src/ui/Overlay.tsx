import { useMemo } from 'react'
import { LOOP_LENGTH, MONTHS, STORY, calvesBorn, distanceTravelled, greenness, herdPos } from '../geo'
import { DENSITY, WILDEBEEST_TOTAL, useStore, type Density } from '../store'
import { YearDial } from './YearDial'

const fmt = new Intl.NumberFormat('es-ES')

/** Greenness under the herd vs. the average over the map, sampled across the year. */
function GreenSpark({ month }: { month: number }) {
  const { herd, avg } = useMemo(() => {
    const herd: number[] = []
    const avg: number[] = []
    for (let i = 0; i <= 96; i++) {
      const m = (i / 96) * 12
      herd.push(greenness(herdPos(m)[1], m))
      let s = 0
      for (let z = -120; z <= 120; z += 20) s += greenness(z, m)
      avg.push(s / 13)
    }
    return { herd, avg }
  }, [])
  const W = 180
  const H = 38
  const path = (arr: number[]) => arr.map((v, i) => `${i ? 'L' : 'M'}${(i / 96) * W},${H - v * H}`).join('')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="spark" aria-hidden>
      <path d={path(avg)} className="spark-avg" />
      <path d={path(herd)} className="spark-herd" />
      <line x1={(month / 12) * W} x2={(month / 12) * W} y1={0} y2={H} className="spark-now" />
    </svg>
  )
}

export function Overlay() {
  const month = useStore((s) => s.month)
  const s = useStore()
  const idx = Math.floor(month) % 12
  const story = STORY[idx]
  const [, hz] = herdPos(month)
  const green = greenness(hz, month)
  const km = distanceTravelled(month)
  const perFigure = Math.round(WILDEBEEST_TOTAL / DENSITY[s.density].adults)

  return (
    <div className="overlay">
      <header className="title">
        <div className="eyebrow">Serengeti · Masái Mara</div>
        <h1>La Gran Migración</h1>
        <p>Cada año, 1,3 millones de ñus dan la vuelta al ecosistema entre Tanzania y Kenia persiguiendo la lluvia y la hierba nueva.</p>
      </header>

      <section className="story" key={idx}>
        <div className="story-month">{MONTHS[idx]}</div>
        <div className="story-place">{story.place}</div>
        <p>{story.text}</p>
      </section>

      <section className="stats">
        <div className="stat">
          <span className="stat-label">Crías nacidas este año</span>
          <span className="stat-value">{fmt.format(Math.round(calvesBorn(month) / 1000) * 1000)}</span>
          <div className="meter"><i style={{ width: `${(calvesBorn(month) / 500_000) * 100}%` }} /></div>
        </div>
        <div className="stat">
          <span className="stat-label">Avance del centro de la manada</span>
          <span className="stat-value">{fmt.format(Math.round(km))} <small>km</small></span>
          <div className="meter"><i style={{ width: `${(km / LOOP_LENGTH) * 100}%` }} /></div>
        </div>
        <div className="stat">
          <span className="stat-label">Pasto verde bajo la manada</span>
          <span className="stat-value">{Math.round(green * 100)}<small>%</small></span>
          <GreenSpark month={month} />
          <span className="spark-key"><b className="k-herd" /> manada <b className="k-avg" /> media del territorio</span>
        </div>
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
        <button className={s.follow ? 'on' : ''} onClick={() => s.set({ follow: !s.follow })}>
          Seguir manada
        </button>
        <button className={s.showRoute ? 'on' : ''} onClick={() => s.set({ showRoute: !s.showRoute })}>
          Ruta
        </button>
        <label className="select">
          Densidad
          <select value={s.density} onChange={(e) => s.set({ density: e.target.value as Density })}>
            {(Object.keys(DENSITY) as Density[]).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      </nav>

      <footer className="foot">
        1 figura ≈ {perFigure} ñus · escala de animales y relieve exageradas · ruta y lluvias aproximadas
        <span className="hint">Arrastra para orbitar · rueda para zoom · espacio para pausar</span>
      </footer>
    </div>
  )
}
