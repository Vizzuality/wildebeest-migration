import { create } from 'zustand'

/** How the Brochazos are laid, to try one paint against another. */
export const BROCHAZO_KINDS = ['pincel', 'espatula', 'signac', 'diseno'] as const
export type BrochazoKind = (typeof BROCHAZO_KINDS)[number]

interface State {
  month: number
  playing: boolean
  speed: number
  brochazo: BrochazoKind
  set: (patch: Partial<Omit<State, 'set'>>) => void
}

// ?mes=7.5&pausa lets you link straight to a moment of the year, ?brochazo=espatula to a paint.
const params = new URLSearchParams(window.location.search)
const startMonth = Number(params.get('mes'))
const startBrochazo = BROCHAZO_KINDS.find((k) => k === params.get('brochazo')) ?? 'pincel'

export const useStore = create<State>((set) => ({
  month: Number.isFinite(startMonth) && params.has('mes') ? ((startMonth % 12) + 12) % 12 : 0.35,
  playing: !params.has('pausa'),
  speed: 1,
  brochazo: startBrochazo,
  set: (patch) => set(patch),
}))

/** Months advanced per second at speed 1: one year in 100 s. */
export const MONTHS_PER_SECOND = 0.12
