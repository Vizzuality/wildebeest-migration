import { useState } from 'react'
import { FUENTES, type Fuente, PALETA, type Paleta, TRAZO, type Trazo, useStore } from '../store'

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

const RAMPAS: { key: keyof Paleta; name: string; from: string; to: string }[] = [
  { key: 'suelo', name: 'Suelo', from: 'lluvias', to: 'secas' },
  { key: 'arboles', name: 'Árboles', from: 'oscuro', to: 'claro' },
  { key: 'agua', name: 'Agua', from: 'honda', to: 'clara' },
  { key: 'especies', name: 'Especies', from: 'ñu', to: 'gacela' },
]

export function Tweaks() {
  const fuente = useStore((s) => s.fuente)
  const trazo = useStore((s) => s.trazo)
  const paleta = useStore((s) => s.paleta)
  const set = useStore((s) => s.set)
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(paleta, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <details className="tweaks">
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
      {fuente === 'datos' && (
        <fieldset className="sliders colores">
          <legend>Colores</legend>
          {RAMPAS.map(({ key, name, from, to }) => (
            <div key={key} role="group" aria-label={name}>
              <span>{name}</span>
              <div className="ramp">
                {paleta[key].map((hex, i) => (
                  <input
                    key={i}
                    type="color"
                    value={hex}
                    title={hex}
                    onChange={(e) => set({ paleta: { ...paleta, [key]: paleta[key].with(i, e.target.value) } })}
                  />
                ))}
              </div>
              <small>
                <span>{from}</span>
                <span>{to}</span>
              </small>
            </div>
          ))}
          <div className="actions">
            <button onClick={copy}>{copied ? 'Copiado' : 'Copiar'}</button>
            <button onClick={() => set({ paleta: PALETA })}>Restablecer</button>
          </div>
        </fieldset>
      )}
    </details>
  )
}
