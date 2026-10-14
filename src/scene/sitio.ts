import type { FaunaBake } from '../fauna'
import { MAP } from '../geo'
import type { Lluvia } from '../lluvia'
import { type Sitio, mensual, quemaCerca, smoothstep } from '../meteoros'
import { NDVI_DRY, NDVI_LUSH } from '../shaders/common'
import type { Heightfield } from '../terrain'
import { manadaAt, pasoAt } from './Fauna'

/** How far round the Manada a Quema's smoke reaches the viewer (km). */
const SMOKE_KM = 25
/** The ground the Manada stands on, not one cell of it: how far round the Verdor is averaged (km). */
const GROUND_KM = 15
/**
 * The weather is averaged over this much of the year either side of now (months). Point by point
 * the Verdor and the Quemas change from cell to cell, and as the Manada walks over them the dust
 * and smoke would flicker.
 */
const BLUR_MONTHS = [-0.2, -0.1, 0, 0.1, 0.2]
const BLUR_WEIGHTS = BLUR_MONTHS.map((o) => Math.exp(-((o / 0.12) ** 2)))
const BLUR_TOTAL = BLUR_WEIGHTS.reduce((a, b) => a + b, 0)

function groundOf(hf: Heightfield) {
  return { nx: hf.nx, nz: hf.nz, step: hf.step, minX: MAP.minX, minZ: MAP.minZ }
}

/** Mean NDVI over a disc round (x, z). */
function verdorAround(hf: Heightfield, x: number, z: number, month: number) {
  const ground = groundOf(hf)
  let sum = 0
  let n = 0
  for (let j = -2; j <= 2; j++)
    for (let i = -2; i <= 2; i++) {
      if (i * i + j * j > 5) continue
      sum += mensual(ground, hf.verdor, x + (i * GROUND_KM) / 2, z + (j * GROUND_KM) / 2, month)
      n++
    }
  return sum / n / 250
}

/** The weather where the ñus are at a moment of the year. */
export function sitioAt(raw: FaunaBake, hf: Heightfield, lluvia: Lluvia, month: number): Sitio {
  let ndvi = 0
  let quema = 0
  BLUR_MONTHS.forEach((o, k) => {
    const m = month + o
    const [x, z] = manadaAt(raw, hf.rivers, m)
    const w = BLUR_WEIGHTS[k] / BLUR_TOTAL
    ndvi += w * verdorAround(hf, x, z, m)
    quema += w * quemaCerca(groundOf(hf), hf.quemas, x, z, m, SMOKE_KM)
  })
  return {
    lluvia: (m) => {
      const [x, z] = manadaAt(raw, hf.rivers, m)
      return mensual(lluvia, lluvia.mm, x, z, m) / 10
    },
    seco: 1 - smoothstep(NDVI_DRY, NDVI_LUSH, ndvi),
    paso: pasoAt(raw, hf.rivers, month),
    quema,
  }
}
