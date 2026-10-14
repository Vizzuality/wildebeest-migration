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
  /** Where the Manada can be at all (0–1), on a grid of `nx` × `nz` cells `step` km apart from the map's corner. */
  habitat: { nx: number; nz: number; step: number; data: Uint8Array }
}

async function fetchFauna(): Promise<FaunaBake> {
  const [res, range] = await Promise.all([fetch('/fauna/fauna.json'), fetch('/fauna/habitat.bin')])
  if (!res.ok) throw new Error(`/fauna/fauna.json: ${res.status}`)
  if (!range.ok) throw new Error(`/fauna/habitat.bin: ${range.status}`)
  const bake = (await res.json()) as Omit<FaunaBake, 'habitat'> & { minX: number; minZ: number; habitat: Omit<FaunaBake['habitat'], 'data'> }
  if (bake.minX !== MAP.minX || bake.minZ !== MAP.minZ) throw new Error('fauna bake does not match MAP, run pnpm bake:fauna')
  return { ...bake, habitat: { ...bake.habitat, data: new Uint8Array(await range.arrayBuffer()) } }
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
