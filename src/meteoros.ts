// How strong each Meteoro is at a moment of the year, from the weather where the Manada is.
// Pure, so the year's weather can be checked without drawing it.

/** A grid of cells `step` km apart from (minX, minZ), with twelve monthly values per cell. */
export interface Rejilla {
  nx: number
  nz: number
  step: number
  minX: number
  minZ: number
}

/** The weather where the Manada is. */
export interface Sitio {
  /** Mean rain (mm a month) where the Manada is at `month`, which may be ahead or behind now. */
  lluvia: (month: number) => number
  /** How dry the ground looks there now: 0 green, 1 straw. */
  seco: number
  /** How fast the Manada is going (km a month). */
  paso: number
  /** Share of the ground round the Manada that is burning now (0–1). */
  quema: number
}

/** Strength of each Meteoro, 0–1. How much each can hide is capped where it is drawn. */
export interface Meteoros {
  lluvia: number
  nubes: number
  polvo: number
  humo: number
  reverbero: number
}

/**
 * Each slot of the year (months) holds at most one Chubasco. At a year a minute a slot is 2.5 s,
 * so a Chubasco lasts long enough to read.
 */
const SLOT = 0.5
const SLOTS = Math.round(12 / SLOT)
/** Monthly rain (mm) from which Chubascos start to come, and above which nearly every slot has one. */
const RAIN_FROM = 25
const RAIN_FULL = 140
/** Clouds gather on less rain than it takes to shower, and this far either side of now (months). */
const CLOUD_FROM = 40
const CLOUD_FULL = 120
const CLOUD_REACH = [-0.6, -0.3, 0, 0.3, 0.6]
/** Monthly rain (mm) that lays the dust, and that cools the ground too much to shimmer. The Mara
 * gets ~60 mm even in September, and still shimmers and raises dust then. */
const DAMP_FROM = 50
const DAMP_FULL = 120
const COOL_FROM = 60
const COOL_FULL = 100
/** The Manada's pace (km a month) from which it raises dust, and at which it raises it all. */
const PACE_FROM = 5
const PACE_FULL = 60
/** Dust that hangs over dry ground with the Manada standing still. */
const STILL_DUST = 0.35
/** A Chubasco this strong already lays all the dust: any shower does. */
const SHOWER_DAMP = 0.1
/** Share of ground burning nearby from which there is smoke, and at which it is full. */
const SMOKE_FROM = 0.02
const SMOKE_FULL = 0.3
/** How straw the ground must be to shimmer, and to shimmer fully. */
const SHIMMER_FROM = 0.25
const SHIMMER_FULL = 0.6

export function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Three draws in 0–1 for a slot, the same every year. */
function draws(slot: number) {
  let h = ((((slot % SLOTS) + SLOTS) % SLOTS) + 1) * 0x9e3779b1
  const next = () => {
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
  return [next(), next(), next()]
}

/** How hard it is raining at this moment of the year (0–1): a Chubasco or nothing. */
export function chubasco(month: number, lluvia: Sitio['lluvia']) {
  const slot = Math.floor(month / SLOT)
  const chance = smoothstep(RAIN_FROM, RAIN_FULL, lluvia((slot + 0.5) * SLOT))
  const [come, when, strength] = draws(slot)
  if (come >= chance) return 0
  const length = SLOT * (0.5 + 0.4 * chance)
  const start = slot * SLOT + when * (SLOT - length)
  const x = (month - start) / length
  if (x <= 0 || x >= 1) return 0
  return Math.sin(Math.PI * x) ** 2 * (0.55 + 0.45 * strength)
}

/** `calma` is the viewer asking for less motion: no Reverbero, and gentler rain and dust. */
export function meteoros(month: number, sitio: Sitio, calma = false): Meteoros {
  const rain = chubasco(month, sitio.lluvia)
  const now = sitio.lluvia(month)
  const clouds = Math.max(...CLOUD_REACH.map((o) => smoothstep(CLOUD_FROM, CLOUD_FULL, sitio.lluvia(month + o))))
  const shower = smoothstep(0, SHOWER_DAMP, rain)
  const damp = Math.max(shower, smoothstep(DAMP_FROM, DAMP_FULL, now))
  const raised = STILL_DUST + (1 - STILL_DUST) * smoothstep(PACE_FROM, PACE_FULL, sitio.paso)
  const quiet = calma ? 0.5 : 1
  return {
    lluvia: rain * quiet,
    nubes: Math.min(1, 0.65 * clouds + 0.35 * rain),
    polvo: sitio.seco * raised * (1 - damp) * quiet,
    humo: smoothstep(SMOKE_FROM, SMOKE_FULL, sitio.quema) * (1 - rain),
    reverbero: calma ? 0 : smoothstep(SHIMMER_FROM, SHIMMER_FULL, sitio.seco) * (1 - Math.max(shower, smoothstep(COOL_FROM, COOL_FULL, now))),
  }
}

/**
 * A monthly value at (x, z), read bilinearly off the grid and eased between mid-months: twelve
 * values per cell, each the mean of its month.
 */
export function mensual(grid: Rejilla, data: ArrayLike<number>, x: number, z: number, month: number) {
  const fx = Math.min(grid.nx - 1.001, Math.max(0, (x - grid.minX) / grid.step))
  const fz = Math.min(grid.nz - 1.001, Math.max(0, (z - grid.minZ) / grid.step))
  const ix = Math.floor(fx)
  const iz = Math.floor(fz)
  const tx = fx - ix
  const tz = fz - iz
  const t = month - 0.5
  const a = ((Math.floor(t) % 12) + 12) % 12
  const b = (a + 1) % 12
  const w = t - Math.floor(t)
  const at = (cx: number, cz: number) => {
    const i = (cz * grid.nx + cx) * 12
    return data[i + a] * (1 - w) + data[i + b] * w
  }
  return (at(ix, iz) * (1 - tx) + at(ix + 1, iz) * tx) * (1 - tz) + (at(ix, iz + 1) * (1 - tx) + at(ix + 1, iz + 1) * tx) * tz
}

/** When in its month the fire front reaches a cell (0–1), so a patch doesn't all flare at once. */
function spreadOf(ix: number, iz: number) {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296
}

/**
 * Share of the ground within about `radius` km of (x, z) that is burning now, weighted towards
 * the middle. `quemas` holds each cell's usual month of Quema (1–12, 0 = none); the fire takes
 * its month to cross the patch, each cell flaring up and dying down as the front passes.
 */
export function quemaCerca(grid: Rejilla, quemas: ArrayLike<number>, x: number, z: number, month: number, radius: number) {
  const SAMPLES = 24
  const spacing = (2 * radius) / SAMPLES
  let burning = 0
  let total = 0
  for (let j = 0; j <= SAMPLES; j++)
    for (let i = 0; i <= SAMPLES; i++) {
      const dx = -radius + i * spacing
      const dz = -radius + j * spacing
      const d2 = (dx * dx + dz * dz) / (radius * radius)
      if (d2 > 1) continue
      const ix = Math.round((x + dx - grid.minX) / grid.step)
      const iz = Math.round((z + dz - grid.minZ) / grid.step)
      if (ix < 0 || iz < 0 || ix >= grid.nx || iz >= grid.nz) continue
      const w = Math.exp(-4 * d2)
      total += w
      const m = quemas[iz * grid.nx + ix]
      if (!m) continue
      const age = (((month - (m - 1) - spreadOf(ix, iz) * 0.9) % 12) + 12) % 12
      if (age < 1) burning += w * Math.sin(Math.PI * age)
    }
  return total ? burning / total : 0
}
