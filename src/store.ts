import { create } from 'zustand'

interface State {
  month: number
  playing: boolean
  speed: number
  set: (patch: Partial<Omit<State, 'set'>>) => void
}

// ?mes=7.5&pausa lets you link straight to a moment of the year.
const params = new URLSearchParams(window.location.search)
const startMonth = Number(params.get('mes'))

export const useStore = create<State>((set) => ({
  month: Number.isFinite(startMonth) && params.has('mes') ? ((startMonth % 12) + 12) % 12 : 0.35,
  playing: !params.has('pausa'),
  speed: 1,
  set: (patch) => set(patch),
}))

/** Months advanced per second at speed 1: one year in 60 s. */
export const MONTHS_PER_SECOND = 0.2
