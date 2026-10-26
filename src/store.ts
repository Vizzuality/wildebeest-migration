import { create } from 'zustand'

/** What the Lienzo shows: the Brochazos painted from the data, or the design's own raster. */
export const FUENTES = ['datos', 'diseno'] as const
export type Fuente = (typeof FUENTES)[number]

/**
 * How the Lienzo lays each Brochazo: half its length (km), its width against the design's dots, how
 * wide the brush's flow swirls (above 1, tighter), how far the flow turns, and its heading (degrees).
 */
export interface Trazo {
  largo: number
  grosor: number
  escala: number
  giro: number
  direccion: number
}

// Largo 1.05 is longer than half the Brochazo spacing, so a row of them joins up.
export const TRAZO: Trazo = { largo: 1.05, grosor: 1, escala: 1, giro: 1, direccion: 0 }

interface State {
  month: number
  playing: boolean
  speed: number
  fuente: Fuente
  trazo: Trazo
  set: (patch: Partial<Omit<State, 'set'>>) => void
}

// ?mes=7.5&pausa lets you link straight to a moment of the year, ?fuente=diseno to the design.
const params = new URLSearchParams(window.location.search)
const startMonth = Number(params.get('mes'))
const startFuente = FUENTES.find((k) => k === params.get('fuente')) ?? 'datos'

export const useStore = create<State>((set) => ({
  month: Number.isFinite(startMonth) && params.has('mes') ? ((startMonth % 12) + 12) % 12 : 0.35,
  playing: !params.has('pausa'),
  speed: 1,
  fuente: startFuente,
  trazo: TRAZO,
  set: (patch) => set(patch),
}))

/** Months advanced per second at speed 1: one year in 100 s. */
export const MONTHS_PER_SECOND = 0.12
