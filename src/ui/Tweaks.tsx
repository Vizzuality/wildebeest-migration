import { FUENTES, type Fuente, TRAZO, type Trazo, useStore } from '../store'

const FUENTE_NAMES: Record<Fuente, string> = {
  datos: 'Datos',
  diseno: 'Diseño',
}

// Largo stops at 2.5 km: the Lienzo only looks two Brochazos out for strokes that reach a spot.
const TRAZO_SLIDERS: { key: keyof Trazo; name: string; min: number; max: number; step: number }[] = [
  { key: 'largo', name: 'Largo', min: 0.4, max: 2.5, step: 0.05 },
  { key: 'grosor', name: 'Grosor', min: 0.4, max: 1.8, step: 0.05 },
  { key: 'escala', name: 'Escala del flujo', min: 0.2, max: 5, step: 0.1 },
  { key: 'giro', name: 'Giro del flujo', min: 0, max: 2, step: 0.05 },
  { key: 'direccion', name: 'Dirección', min: -90, max: 90, step: 1 },
]

export function Tweaks() {
  const fuente = useStore((s) => s.fuente)
  const trazo = useStore((s) => s.trazo)
  const set = useStore((s) => s.set)

  return (
    <details className="tweaks" open>
      <summary>Tweaks</summary>
      <fieldset>
        <legend>Fuente</legend>
        {FUENTES.map((k) => (
          <button key={k} aria-pressed={fuente === k} onClick={() => set({ fuente: k })}>
            {FUENTE_NAMES[k]}
          </button>
        ))}
      </fieldset>
      {fuente === 'datos' && (
        <fieldset className="sliders">
          <legend>Trazos</legend>
          {TRAZO_SLIDERS.map(({ key, name, min, max, step }) => (
            <label key={key}>
              <span>{name}</span>
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={trazo[key]}
                onChange={(e) => set({ trazo: { ...trazo, [key]: Number(e.target.value) } })}
              />
              <output>{trazo[key]}</output>
            </label>
          ))}
          <button onClick={() => set({ trazo: TRAZO })}>Restablecer</button>
        </fieldset>
      )}
    </details>
  )
}
