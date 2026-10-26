import { BROCHAZO_KINDS, useStore } from '../store'

const BROCHAZO_NAMES: Record<(typeof BROCHAZO_KINDS)[number], string> = {
  pincel: 'Pincel',
  espatula: 'Espátula',
  signac: 'Signac',
  diseno: 'Diseño',
}

export function Tweaks() {
  const brochazo = useStore((s) => s.brochazo)
  const set = useStore((s) => s.set)

  return (
    <details className="tweaks" open>
      <summary>Tweaks</summary>
      <fieldset>
        <legend>Brochazo</legend>
        {BROCHAZO_KINDS.map((k) => (
          <button key={k} aria-pressed={brochazo === k} onClick={() => set({ brochazo: k })}>
            {BROCHAZO_NAMES[k]}
          </button>
        ))}
      </fieldset>
    </details>
  )
}
