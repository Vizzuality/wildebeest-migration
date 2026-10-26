import { FUENTES, type Fuente, useStore } from '../store'

const FUENTE_NAMES: Record<Fuente, string> = {
  datos: 'Datos',
  diseno: 'Diseño',
}

export function Tweaks() {
  const fuente = useStore((s) => s.fuente)
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
    </details>
  )
}
