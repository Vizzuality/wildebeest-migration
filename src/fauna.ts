import { use } from 'react'
import { MAP } from './geo'

export interface FaunaBake {
  /** Where the centre of the Manada is through the year, `samplesPerMonth` points a month. */
  recorrido: [number, number][]
  /** The same for the Thomson's gazelles, who keep to the south and centre of the park. */
  gacelas: [number, number][]
  samplesPerMonth: number
  /** How far the Manada spreads each month, as a covariance (xx, xz, zz in km²). */
  forma: [number, number, number][]
  /** Main rivers with their Cruces cut out: lines the Manada may not step over. */
  barriers: [number, number][][]
  /**
   * Per cell of a grid of `nx` × `nz` cells `step` km apart from the map's corner, two bytes:
   * where the Manada can be at all (0–255), and which bank of the Mara it is on (0 or 255).
   */
  ground: { nx: number; nz: number; step: number; data: Uint8Array }
}

async function fetchFauna(): Promise<FaunaBake> {
  const [res, ground] = await Promise.all([fetch('/fauna/fauna.json'), fetch('/fauna/ground.bin')])
  if (!res.ok) throw new Error(`/fauna/fauna.json: ${res.status}`)
  if (!ground.ok) throw new Error(`/fauna/ground.bin: ${ground.status}`)
  const bake = (await res.json()) as Omit<FaunaBake, 'ground'> & { minX: number; minZ: number; ground: Omit<FaunaBake['ground'], 'data'> }
  if (bake.minX !== MAP.minX || bake.minZ !== MAP.minZ) throw new Error('fauna bake does not match MAP, run pnpm bake:fauna')
  return { ...bake, ground: { ...bake.ground, data: new Uint8Array(await ground.arrayBuffer()) } }
}

let pending: Promise<FaunaBake> | null = null

export function loadFauna() {
  pending ??= fetchFauna().catch((err) => {
    pending = null
    throw err
  })
  return pending
}

export function useFauna() {
  return use(loadFauna())
}
