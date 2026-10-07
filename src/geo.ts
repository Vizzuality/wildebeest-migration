// Geographic model of the Serengeti–Mara ecosystem.
// World units are kilometres: x grows east, z grows south (north is -z).

export const LON0 = 34.85
export const LAT0 = -2.3
const KM_PER_DEG = 111

export const MAP = { minX: -100, maxX: 100, minZ: -128, maxZ: 128 }

export type LonLat = [number, number]

export function project([lon, lat]: LonLat): [number, number] {
  return [(lon - LON0) * KM_PER_DEG, -(lat - LAT0) * KM_PER_DEG]
}

export function unproject(x: number, z: number): LonLat {
  return [x / KM_PER_DEG + LON0, -z / KM_PER_DEG + LAT0]
}

export const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]
export const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3).toUpperCase())

// Approximate herd centroid at mid-month, clockwise loop.
export const ROUTE: LonLat[] = [
  [35.05, -2.95], // Ene · llanuras del sur
  [35.08, -3.05], // Feb · Ndutu, partos
  [34.98, -2.95], // Mar
  [34.82, -2.65], // Abr · Moru / Seronera
  [34.6, -2.38], // May · corredor occidental
  [34.35, -2.15], // Jun · río Grumeti
  [34.6, -1.78], // Jul · hacia el norte
  [34.9, -1.6], // Ago · cruces del Mara
  [35.08, -1.38], // Sep · Masái Mara
  [35.17, -1.52], // Oct · retorno
  [35.2, -2.0], // Nov · Lobo
  [35.1, -2.55], // Dic · bajando al sur
]
export const ROUTE_XZ = ROUTE.map(project)

// Herd shape per month (km): sideways spread and isotropic dispersal.
export const SPREAD = [20, 22, 20, 14, 10, 8, 9, 8, 12, 10, 10, 14]
export const DISPERSE = [16, 18, 16, 7, 4, 3, 3, 3, 6, 4, 4, 8]

// Approximate monthly rainfall (mm), illustrative. South = Ndutu plains, north = Mara.
export const RAIN_SOUTH = [80, 85, 115, 125, 50, 6, 2, 5, 10, 25, 70, 85]
export const RAIN_NORTH = [85, 95, 135, 190, 115, 50, 40, 60, 65, 75, 110, 105]

export const RIVERS: { name: string; points: LonLat[] }[] = [
  {
    name: 'Mara',
    points: [
      [35.27, -1.12], [35.18, -1.24], [35.07, -1.38], [35.0, -1.47], [34.94, -1.56],
      [34.84, -1.6], [34.7, -1.57], [34.55, -1.54], [34.4, -1.6], [34.22, -1.56], [33.9, -1.5],
    ],
  },
  {
    name: 'Grumeti',
    points: [
      [35.02, -2.0], [34.88, -2.06], [34.72, -2.1], [34.56, -2.09], [34.42, -2.13],
      [34.26, -2.16], [34.1, -2.2], [33.9, -2.22],
    ],
  },
  {
    name: 'Mbalageti',
    points: [
      [34.9, -2.5], [34.74, -2.47], [34.58, -2.52], [34.42, -2.5], [34.24, -2.46], [34.05, -2.42],
    ],
  },
]

// Kenya–Tanzania border, straight line from Lake Victoria towards Kilimanjaro.
export function borderLat(lon: number) {
  return -1.0 - (lon - 33.92) * 0.54
}

export const PLACES: { name: string; at: LonLat; kind?: 'country' | 'water' | 'river' }[] = [
  { name: 'Ndutu', at: [34.98, -3.0] },
  { name: 'Seronera', at: [34.82, -2.43] },
  { name: 'Kopjes de Moru', at: [34.76, -2.72] },
  { name: 'Corredor occidental', at: [34.42, -2.3] },
  { name: 'Kogatende', at: [34.88, -1.64] },
  { name: 'Masái Mara', at: [35.12, -1.3] },
  { name: 'Lobo', at: [35.17, -1.98] },
  { name: 'Ngorongoro', at: [35.58, -3.18] },
  { name: 'Lago Victoria', at: [33.99, -2.32], kind: 'water' },
  { name: 'KENIA', at: [35.5, -1.32], kind: 'country' },
  { name: 'TANZANIA', at: [35.52, -2.3], kind: 'country' },
  { name: 'Río Mara', at: [34.55, -1.5], kind: 'river' },
  { name: 'Río Grumeti', at: [34.62, -2.05], kind: 'river' },
]

// River-crossing hotspots and the months they light up.
export const HOTSPOTS: { name: string; at: LonLat; months: [number, number] }[] = [
  { name: 'Cruce del Mara', at: [34.9, -1.58], months: [6.6, 9.8] },
  { name: 'Cruce del Grumeti', at: [34.4, -2.13], months: [4.8, 6.4] },
]

export interface MonthStory {
  place: string
  text: string
}

export const STORY: MonthStory[] = [
  {
    place: 'Llanuras del sur',
    text: 'Las lluvias cortas han reverdecido las llanuras de hierba corta. Más de 1,3 millones de ñus se dispersan para pastar sobre suelos volcánicos ricos en minerales.',
  },
  {
    place: 'Ndutu · temporada de partos',
    text: 'En apenas tres semanas nacen unas 500.000 crías, alrededor de 8.000 al día. Se ponen en pie a los pocos minutos: la sincronía satura a los depredadores.',
  },
  {
    place: 'Llanuras del sur',
    text: 'Las crías ganan fuerza. La manada sigue en el sur, aprovechando el pasto tierno antes de las lluvias largas.',
  },
  {
    place: 'Moru · Seronera',
    text: 'Con las lluvias largas, las llanuras del sur empiezan a agotarse. La manada se agrupa y avanza hacia el noroeste.',
  },
  {
    place: 'Corredor occidental',
    text: 'Columnas de decenas de kilómetros avanzan hacia el oeste. Es la época de celo: los machos defienden territorios efímeros mientras la manada camina.',
  },
  {
    place: 'Río Grumeti',
    text: 'Primer gran obstáculo: el Grumeti y sus cocodrilos del Nilo, que llevan meses esperando a la manada.',
  },
  {
    place: 'Rumbo al norte',
    text: 'El sur ya es paja dorada. La manada empuja hacia el norte, siguiendo las lluvias más regulares de la cuenca del Mara.',
  },
  {
    place: 'Cruces del Mara',
    text: 'El momento más dramático: miles de ñus se lanzan al río Mara cerca de Kogatende. Corrientes, cocodrilos y estampidas en las orillas.',
  },
  {
    place: 'Masái Mara',
    text: 'Ya en Kenia, la manada pasta la hierba alta del Mara, regada casi todo el año. Cruzan el río una y otra vez.',
  },
  {
    place: 'Masái Mara · retorno',
    text: 'El pasto del Mara se agota. Tormentas lejanas en el sur marcan el camino de vuelta.',
  },
  {
    place: 'Lobo · este del parque',
    text: 'Llegan las lluvias cortas. La manada desciende por el este del Serengeti, a través de los bosques de Lobo.',
  },
  {
    place: 'De vuelta al sur',
    text: 'Las llanuras del sur vuelven a estar verdes. El ciclo se cierra, y en unas semanas empieza otra vez.',
  },
]

// ── Shared math (mirrors the GLSL in shaders/herd.ts) ─────────────────────

function wrap(i: number) {
  return ((i % 12) + 12) % 12
}

function catmull(p0: number, p1: number, p2: number, p3: number, f: number) {
  return 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f)
}

/** Herd centroid at a fractional month (0 = start of January). */
export function herdPos(month: number): [number, number] {
  const t = month - 0.5
  const i1 = Math.floor(t)
  const f = t - i1
  const [a, b, c, d] = [i1 - 1, i1, i1 + 1, i1 + 2].map((i) => ROUTE_XZ[wrap(i)])
  return [catmull(a[0], b[0], c[0], d[0], f), catmull(a[1], b[1], c[1], d[1], f)]
}

export function periodicLerp(arr: number[], month: number) {
  const t = month - 0.5
  const i = Math.floor(t)
  const f = t - i
  return arr[wrap(i)] * (1 - f) + arr[wrap(i + 1)] * f
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** 0 on the southern plains, 1 in the Mara. */
export function northness(z: number) {
  return smoothstep(80, -110, z)
}

/** Grass greenness (0–1) at a place and month: rainfall with a ~3-week lag. */
export function greenness(z: number, month: number) {
  const m = month - 0.6
  const r = periodicLerp(RAIN_SOUTH, m) * (1 - northness(z)) + periodicLerp(RAIN_NORTH, m) * northness(z)
  return smoothstep(0, 110, r)
}

export const LOOP_SAMPLES = (() => {
  const pts: [number, number][] = []
  const n = 1200
  for (let i = 0; i <= n; i++) pts.push(herdPos((i / n) * 12))
  return pts
})()

export const LOOP_LENGTH = (() => {
  let len = 0
  for (let i = 1; i < LOOP_SAMPLES.length; i++) {
    len += Math.hypot(LOOP_SAMPLES[i][0] - LOOP_SAMPLES[i - 1][0], LOOP_SAMPLES[i][1] - LOOP_SAMPLES[i - 1][1])
  }
  return len
})()

export function distanceTravelled(month: number) {
  const n = LOOP_SAMPLES.length - 1
  const upto = Math.floor((month / 12) * n)
  let len = 0
  for (let i = 1; i <= upto; i++) {
    len += Math.hypot(LOOP_SAMPLES[i][0] - LOOP_SAMPLES[i - 1][0], LOOP_SAMPLES[i][1] - LOOP_SAMPLES[i - 1][1])
  }
  return len
}

export const CALVES_PER_YEAR = 500_000
export const BIRTH_START = 0.9
export const BIRTH_END = 1.8

export function calvesBorn(month: number) {
  return CALVES_PER_YEAR * smoothstep(BIRTH_START, BIRTH_END, month)
}
