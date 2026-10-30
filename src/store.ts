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

// Strokes well past the Brochazo spacing, so rows of them run together into swathes.
export const TRAZO: Trazo = { largo: 2, grosor: 1.5, escala: 1, giro: 1, direccion: 0 }

/**
 * How the Mancha moves like mud: how much more of it a Brochazo needs to be taken than to be kept
 * (in the field the Mancha's edge sits at 0.9 of), so it sticks to the ground once it has it.
 */
export interface Barro {
  pegado: number
}

export const BARRO: Barro = { pegado: 0.3 }

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

// The designer's, picked in the Tweaks.
export const PALETA: Paleta = {
  suelo: ['#8dac5d', '#9fb16d', '#afba75', '#c5c780', '#f6f1c5', '#e7ddb1', '#dbcda0', '#d2c194', '#c2ac7e'],
  arboles: ['#264029', '#385535', '#4a6a40', '#5c7e4a', '#6c9255', '#80a563', '#9bb772', '#b4c981', '#c8d990'],
  agua: ['#2f45ac', '#3650bc', '#3e5dd5', '#426fd8', '#4a7ae9', '#5f87db', '#7295dc', '#80a2dd', '#8faee7'],
  // Ñu, cebra and gacela.
  especies: ['#592224', '#e19393', '#c9584d'],
}

interface State {
  month: number
  playing: boolean
  speed: number
  fuente: Fuente
  trazo: Trazo
  barro: Barro
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
  barro: BARRO,
  paleta: PALETA,
  set: (patch) => set(patch),
}))

/** Months advanced per second at speed 1: one year in 100 s. */
export const MONTHS_PER_SECOND = 0.12
