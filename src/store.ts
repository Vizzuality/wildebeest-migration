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

/**
 * The colours the Brochazos are painted in, as sRGB hex. Each ramp runs as the Mapa's colours do in
 * the design: the ground from green in the rains to straw in the dry season, the trees from dark to
 * light, the water from deep to pale. The species are the Mancha's.
 */
export interface Paleta {
  suelo: string[]
  arboles: string[]
  agua: string[]
  especies: string[]
}

// Measured against the design's raster with the Mapa in August, the month it shows.
export const PALETA: Paleta = {
  suelo: ['#74af63', '#b8d170', '#dce082', '#e8e389', '#f5e79d', '#f7e7a3', '#f7e5a1', '#f7e49d', '#f6e194'],
  arboles: ['#31703c', '#428b4d', '#57994c', '#6ea651', '#93bb62', '#c4d276', '#d9db80', '#eae18b', '#f6e8a0'],
  agua: ['#327ac2', '#327ac3', '#377ec5', '#3f91e8', '#4293e9', '#4294e9', '#4394e9', '#4c97e8', '#76b5ed'],
  // Ñu, cebra (provisional until the design gives the zebras a colour of their own) and gacela.
  especies: ['#7d3237', '#56606b', '#df7321'],
}

interface State {
  month: number
  playing: boolean
  speed: number
  fuente: Fuente
  trazo: Trazo
  paleta: Paleta
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
  paleta: PALETA,
  set: (patch) => set(patch),
}))

/** Months advanced per second at speed 1: one year in 100 s. */
export const MONTHS_PER_SECOND = 0.12
