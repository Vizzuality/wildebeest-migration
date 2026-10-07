// Geographic model of the Serengeti–Mara ecosystem.
// World units are kilometres: x grows east, z grows south (north is -z).

export const LON0 = 34.85
export const LAT0 = -2.3
export const KM_PER_DEG = 111

// Sized so every labelled place sits clear of the Bruma at the edges.
export const MAP = { minX: -175, maxX: 125, minZ: -181, maxZ: 152 }

export type LonLat = [number, number]

export function project([lon, lat]: LonLat): [number, number] {
  return [(lon - LON0) * KM_PER_DEG, -(lat - LAT0) * KM_PER_DEG]
}

export function unproject(x: number, z: number): LonLat {
  return [x / KM_PER_DEG + LON0, -z / KM_PER_DEG + LAT0]
}

// Approximate monthly rainfall (mm), illustrative. South = Ndutu plains, north = Mara.
export const RAIN_SOUTH = [80, 85, 115, 125, 50, 6, 2, 5, 10, 25, 70, 85]
export const RAIN_NORTH = [85, 95, 135, 190, 115, 50, 40, 60, 65, 75, 110, 105]

// Caudal per river and month, Jan–Dec, as a stage: 1 crecida, ~0.6 bajo, ~0.3 Pozas, 0 seco.
// Illustrative. The Mara peaks in Apr–May and Dec and bottoms out in Feb before the long rains
// (Mara Bridge gauge), but never stops; the Grumeti and Mbalageti break into Pozas in the dry
// season; the sand rivers of the plains and Olduvai run dry.
export const CAUDAL: Record<string, number[]> = {
  Mara: [0.78, 0.7, 0.8, 0.95, 1.0, 0.86, 0.78, 0.76, 0.74, 0.74, 0.84, 0.92],
  Grumeti: [0.7, 0.65, 0.8, 0.95, 0.85, 0.5, 0.32, 0.28, 0.25, 0.3, 0.55, 0.7],
  Mbalageti: [0.68, 0.62, 0.8, 0.9, 0.7, 0.35, 0.25, 0.22, 0.22, 0.28, 0.5, 0.65],
  Orangi: [0.55, 0.5, 0.7, 0.8, 0.5, 0.15, 0, 0, 0, 0.05, 0.35, 0.5],
  Seronera: [0.55, 0.5, 0.7, 0.8, 0.5, 0.15, 0, 0, 0, 0.05, 0.35, 0.5],
  Sand: [0.55, 0.45, 0.65, 0.85, 0.7, 0.35, 0.15, 0.1, 0.1, 0.15, 0.45, 0.6],
  Talek: [0.55, 0.45, 0.65, 0.85, 0.7, 0.35, 0.15, 0.1, 0.1, 0.15, 0.45, 0.6],
  'Olare Orok': [0.55, 0.45, 0.65, 0.85, 0.7, 0.35, 0.15, 0.1, 0.1, 0.15, 0.45, 0.6],
  Oldupai: [0.35, 0.3, 0.5, 0.55, 0.2, 0, 0, 0, 0, 0, 0.15, 0.3],
}

// Kenya–Tanzania border: along the 1°S parallel across Lake Victoria, then a straight line
// from the shore towards Kilimanjaro.
export function borderLat(lon: number) {
  return -1.0 - Math.max(0, lon - 33.92) * 0.54
}

// River labels name their river so they can be snapped onto the real channel.
export const PLACES: { name: string; at: LonLat; kind?: 'country' | 'water' | 'river'; river?: string }[] = [
  { name: 'Ndutu', at: [34.98, -3.0] },
  { name: 'Seronera', at: [34.82, -2.43] },
  { name: 'Kopjes de Moru', at: [34.76, -2.72] },
  { name: 'Corredor occidental', at: [34.42, -2.3] },
  { name: 'Kogatende', at: [34.88, -1.64] },
  { name: 'Masái Mara', at: [35.12, -1.3] },
  { name: 'Lobo', at: [35.17, -1.98] },
  { name: 'Ngorongoro', at: [35.58, -3.18] },
  { name: 'Lago Victoria', at: [33.65, -1.15], kind: 'water' },
  { name: 'Lago Eyasi', at: [35.27, -3.4], kind: 'water' },
  { name: 'KENIA', at: [35.5, -1.32], kind: 'country' },
  { name: 'TANZANIA', at: [35.52, -2.3], kind: 'country' },
  { name: 'Río Mara', at: [34.55, -1.5], kind: 'river', river: 'Mara' },
  { name: 'Río Grumeti', at: [34.62, -2.05], kind: 'river', river: 'Grumeti' },
]
