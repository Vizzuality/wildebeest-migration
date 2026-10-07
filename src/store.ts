import { create } from 'zustand'

export type Density = 'baja' | 'media' | 'alta'
export const DENSITY: Record<Density, { adults: number; calves: number }> = {
  baja: { adults: 18_000, calves: 6_000 },
  media: { adults: 40_000, calves: 14_000 },
  alta: { adults: 90_000, calves: 30_000 },
}
export const WILDEBEEST_TOTAL = 1_300_000

interface State {
  month: number
  playing: boolean
  speed: number
  follow: boolean
  showRoute: boolean
  density: Density
  set: (patch: Partial<Omit<State, 'set'>>) => void
}

// ?mes=7.5&pausa lets you link straight to a moment of the year.
const params = new URLSearchParams(window.location.search)
const startMonth = Number(params.get('mes'))

export const useStore = create<State>((set) => ({
  month: Number.isFinite(startMonth) && params.has('mes') ? ((startMonth % 12) + 12) % 12 : 0.35,
  playing: !params.has('pausa'),
  speed: 1,
  follow: true,
  showRoute: true,
  density: 'media',
  set: (patch) => set(patch),
}))

/** Months advanced per second at speed 1 — one year in ~80 s. */
export const MONTHS_PER_SECOND = 0.15
