import { useStore } from '../store'

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

function date(month: number) {
  const m = Math.floor(month) % 12
  return `${Math.floor((month - Math.floor(month)) * DAYS[m]) + 1} ${MONTHS[m]}`
}

export function Timeline() {
  const month = useStore((s) => s.month)
  const playing = useStore((s) => s.playing)
  const set = useStore((s) => s.set)

  return (
    <div className="timeline">
      <button onClick={() => set({ playing: !playing })} aria-label={playing ? 'Pausa' : 'Reproducir'}>
        {playing ? '❚❚' : '▶'}
      </button>
      <span className="date">{date(month)}</span>
      <div className="track">
        <input type="range" min={0} max={12} step={0.01} value={month} onChange={(e) => set({ month: Number(e.target.value) % 12 })} aria-label="Mes" />
        <ol>
          {MONTHS.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ol>
      </div>
    </div>
  )
}
